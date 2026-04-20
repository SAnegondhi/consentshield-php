-- Migration: ADR-0053 Sprint 1.1 — admin.billing_gstr1_json.
--
-- Produces a GSTR-1 v3.2 JSON envelope for an issuer × month suitable for
-- upload into the GSTN Offline Utility. Scope rule mirrors the existing
-- GST statement CSV (ADR-0050 Sprint 3.1): operator → active issuer only;
-- owner → any issuer.
--
-- Sections emitted:
--   gstin        — issuer GSTIN
--   fp           — filing period (MMYYYY)
--   version      — GSTN schema version (GST3.2)
--   hash         — placeholder ('hash'), GSTN stamps real value on upload
--   b2b          — customers with GSTIN
--   b2cl         — no-GSTIN + inter-state + invoice total > ₹2.5L
--   b2cs         — aggregated no-GSTIN small (by rate × place-of-supply × supply-type)
--   hsn          — line-item totals aggregated by HSN/SAC code
--   doc_issue    — invoice serial number range for the period
--   cdnr/cdnur/nil — emitted as empty arrays (not used at current scale)

create or replace function admin.billing_gstr1_json(
  p_issuer_id     uuid,
  p_period_mmyyyy text
)
returns jsonb
language plpgsql
security definer
set search_path = admin, public, billing, pg_catalog
as $$
declare
  v_operator          uuid := auth.uid();
  v_role              text;
  v_month             int;
  v_year              int;
  v_period_start      date;
  v_period_end        date;
  v_issuer            record;
  v_active_id         uuid;
  v_is_owner          boolean;
  v_b2b               jsonb := '[]'::jsonb;
  v_b2cl              jsonb := '[]'::jsonb;
  v_b2cs              jsonb := '[]'::jsonb;
  v_hsn               jsonb := '[]'::jsonb;
  v_doc_issue         jsonb := '[]'::jsonb;
  v_min_inv           text;
  v_max_inv           text;
  v_inv_count         int;
  v_cancelled_count   int;
begin
  perform admin.require_admin('platform_operator');

  -- ── Validate period ──
  if p_period_mmyyyy is null or p_period_mmyyyy !~ '^(0[1-9]|1[0-2])[0-9]{4}$' then
    raise exception 'invalid_period: must be MMYYYY with month 01..12, got %', p_period_mmyyyy;
  end if;
  v_month := substring(p_period_mmyyyy from 1 for 2)::int;
  v_year  := substring(p_period_mmyyyy from 3 for 4)::int;
  v_period_start := make_date(v_year, v_month, 1);
  v_period_end   := (v_period_start + interval '1 month - 1 day')::date;

  -- ── Load issuer + enforce scope ──
  select id, gstin, legal_name, registered_state_code, is_active
    into v_issuer
    from billing.issuer_entities
   where id = p_issuer_id;
  if v_issuer.id is null then
    raise exception 'issuer_not_found: %', p_issuer_id;
  end if;

  select admin_role into v_role from admin.admin_users where id = v_operator;
  v_is_owner := v_role = 'platform_owner';

  if not v_is_owner then
    select id into v_active_id from billing.issuer_entities where is_active limit 1;
    if v_active_id is null or v_active_id <> p_issuer_id then
      raise exception 'operator_scope_violation: operators can only file GSTR-1 against the currently-active issuer';
    end if;
  end if;

  -- ══════════════════════════════════════════════════════════════════════
  -- B2B: customers with GSTIN
  -- ══════════════════════════════════════════════════════════════════════
  with b2b_src as (
    select
      a.billing_gstin                                              as ctin,
      i.invoice_number                                             as inum,
      to_char(i.issue_date, 'DD-MM-YYYY')                          as idt,
      round(i.total_paise::numeric / 100, 2)                       as val,
      a.billing_state_code                                         as pos,
      case
        when i.cgst_paise > 0 then 'Intra'
        else 'Inter'
      end                                                          as sply_type,
      jsonb_build_array(jsonb_build_object(
        'num', 1,
        'itm_det', jsonb_build_object(
          'txval', round(i.subtotal_paise::numeric / 100, 2),
          'rt',    case
                     when i.subtotal_paise > 0
                       then round(((i.cgst_paise + i.sgst_paise + i.igst_paise)::numeric
                            / i.subtotal_paise) * 100, 2)
                     else 0
                   end,
          'camt',  round(i.cgst_paise::numeric / 100, 2),
          'samt',  round(i.sgst_paise::numeric / 100, 2),
          'iamt',  round(i.igst_paise::numeric / 100, 2),
          'csamt', 0
        )
      ))                                                           as itms
    from public.invoices i
    join public.accounts a on a.id = i.account_id
   where i.issuer_entity_id = p_issuer_id
     and i.issue_date between v_period_start and v_period_end
     and i.status <> 'void'
     and a.billing_gstin is not null
     and length(a.billing_gstin) = 15
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'ctin', ctin,
    'inv',  jsonb_agg(jsonb_build_object(
      'inum',    inum,
      'idt',     idt,
      'val',     val,
      'pos',     pos,
      'rchrg',   'N',
      'inv_typ', 'R',
      'itms',    itms
    ))
  )), '[]'::jsonb)
    into v_b2b
    from b2b_src
   group by ctin;

  -- ══════════════════════════════════════════════════════════════════════
  -- B2CL: no GSTIN + inter-state + total > 2,50,000
  -- ══════════════════════════════════════════════════════════════════════
  with b2cl_src as (
    select
      a.billing_state_code                                          as pos,
      i.invoice_number                                              as inum,
      to_char(i.issue_date, 'DD-MM-YYYY')                           as idt,
      round(i.total_paise::numeric / 100, 2)                        as val,
      jsonb_build_array(jsonb_build_object(
        'num', 1,
        'itm_det', jsonb_build_object(
          'txval', round(i.subtotal_paise::numeric / 100, 2),
          'rt',    case
                     when i.subtotal_paise > 0
                       then round((i.igst_paise::numeric / i.subtotal_paise) * 100, 2)
                     else 0
                   end,
          'iamt',  round(i.igst_paise::numeric / 100, 2),
          'csamt', 0
        )
      ))                                                            as itms
    from public.invoices i
    join public.accounts a on a.id = i.account_id
   where i.issuer_entity_id = p_issuer_id
     and i.issue_date between v_period_start and v_period_end
     and i.status <> 'void'
     and (a.billing_gstin is null or length(a.billing_gstin) <> 15)
     and a.billing_state_code <> v_issuer.registered_state_code
     and i.total_paise > 25000000  -- ₹2,50,000 = 25,00,000 paise
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'pos', pos,
    'inv', jsonb_agg(jsonb_build_object(
      'inum', inum,
      'idt',  idt,
      'val',  val,
      'itms', itms
    ))
  )), '[]'::jsonb)
    into v_b2cl
    from b2cl_src
   group by pos;

  -- ══════════════════════════════════════════════════════════════════════
  -- B2CS: everything else (no-GSTIN, aggregated by rate × pos × supply-type)
  -- ══════════════════════════════════════════════════════════════════════
  with b2cs_src as (
    select
      case
        when a.billing_state_code = v_issuer.registered_state_code then 'INTRA'
        else 'INTER'
      end                                                          as sply_ty,
      a.billing_state_code                                         as pos,
      case
        when i.subtotal_paise > 0
          then round(((i.cgst_paise + i.sgst_paise + i.igst_paise)::numeric
               / i.subtotal_paise) * 100, 2)
        else 0
      end                                                          as rt,
      i.subtotal_paise,
      i.cgst_paise,
      i.sgst_paise,
      i.igst_paise
    from public.invoices i
    join public.accounts a on a.id = i.account_id
   where i.issuer_entity_id = p_issuer_id
     and i.issue_date between v_period_start and v_period_end
     and i.status <> 'void'
     and (a.billing_gstin is null or length(a.billing_gstin) <> 15)
     and not (
       a.billing_state_code <> v_issuer.registered_state_code
       and i.total_paise > 25000000
     )
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'sply_ty', sply_ty,
    'rt',      rt,
    'typ',     'OE',
    'pos',     pos,
    'txval',   round(sum(subtotal_paise)::numeric / 100, 2),
    'camt',    round(sum(cgst_paise)::numeric / 100, 2),
    'samt',    round(sum(sgst_paise)::numeric / 100, 2),
    'iamt',    round(sum(igst_paise)::numeric / 100, 2),
    'csamt',   0
  )), '[]'::jsonb)
    into v_b2cs
    from b2cs_src
   group by sply_ty, rt, pos;

  -- ══════════════════════════════════════════════════════════════════════
  -- HSN summary: aggregated across all line items by hsn_sac
  -- ══════════════════════════════════════════════════════════════════════
  with hsn_src as (
    select
      (li->>'hsn_sac')                                             as hsn_sc,
      (li->>'description')                                         as desc_text,
      sum((li->>'quantity')::numeric)                              as qty,
      sum((li->>'amount_paise')::bigint)                           as gross_paise,
      sum(
        case
          when i.subtotal_paise > 0
            then (((li->>'amount_paise')::bigint * i.cgst_paise)::numeric
                  / i.subtotal_paise)::bigint
          else 0
        end
      )                                                            as line_cgst,
      sum(
        case
          when i.subtotal_paise > 0
            then (((li->>'amount_paise')::bigint * i.sgst_paise)::numeric
                  / i.subtotal_paise)::bigint
          else 0
        end
      )                                                            as line_sgst,
      sum(
        case
          when i.subtotal_paise > 0
            then (((li->>'amount_paise')::bigint * i.igst_paise)::numeric
                  / i.subtotal_paise)::bigint
          else 0
        end
      )                                                            as line_igst
    from public.invoices i
    cross join lateral jsonb_array_elements(i.line_items) li
   where i.issuer_entity_id = p_issuer_id
     and i.issue_date between v_period_start and v_period_end
     and i.status <> 'void'
     and li->>'hsn_sac' is not null
   group by (li->>'hsn_sac'), (li->>'description')
  ), hsn_numbered as (
    select row_number() over (order by hsn_sc) as num, *
      from hsn_src
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'num',   num,
    'hsn_sc', hsn_sc,
    'desc',   coalesce(desc_text, ''),
    'uqc',    'OTH',
    'qty',    qty,
    'val',    round(gross_paise::numeric / 100, 2),
    'txval',  round(gross_paise::numeric / 100, 2),
    'iamt',   round(line_igst::numeric / 100, 2),
    'camt',   round(line_cgst::numeric / 100, 2),
    'samt',   round(line_sgst::numeric / 100, 2),
    'csamt',  0
  )), '[]'::jsonb)
    into v_hsn
    from hsn_numbered;

  -- ══════════════════════════════════════════════════════════════════════
  -- DOC_ISSUE: invoice serial number range for the period (type 1 = invoices)
  -- ══════════════════════════════════════════════════════════════════════
  select
    min(invoice_number),
    max(invoice_number),
    count(*) filter (where status <> 'void'),
    count(*) filter (where status = 'void')
    into v_min_inv, v_max_inv, v_inv_count, v_cancelled_count
    from public.invoices
   where issuer_entity_id = p_issuer_id
     and issue_date between v_period_start and v_period_end;

  if v_inv_count is not null and v_inv_count > 0 then
    v_doc_issue := jsonb_build_array(jsonb_build_object(
      'doc_num', 1,
      'doc_typ', 'Invoices for outward supply',
      'docs',    jsonb_build_array(jsonb_build_object(
        'num',    1,
        'from',   v_min_inv,
        'to',     v_max_inv,
        'totnum', v_inv_count + coalesce(v_cancelled_count, 0),
        'cancel', coalesce(v_cancelled_count, 0),
        'net_issue', v_inv_count
      ))
    ));
  end if;

  -- ══════════════════════════════════════════════════════════════════════
  -- Audit log
  -- ══════════════════════════════════════════════════════════════════════
  insert into admin.admin_audit_log
    (admin_user_id, action, target_table, target_id, org_id, old_value, new_value, reason)
  values
    (v_operator, 'billing_gstr1_json', 'billing.issuer_entities', p_issuer_id, null,
     null,
     jsonb_build_object(
       'issuer_id', p_issuer_id,
       'period',    p_period_mmyyyy,
       'caller_role', v_role,
       'inv_count', coalesce(v_inv_count, 0)
     ),
     'GSTR-1 JSON export');

  return jsonb_build_object(
    'gstin',     v_issuer.gstin,
    'fp',        p_period_mmyyyy,
    'version',   'GST3.2',
    'hash',      'hash',
    'b2b',       v_b2b,
    'b2cl',      v_b2cl,
    'b2cs',      v_b2cs,
    'cdnr',      '[]'::jsonb,
    'cdnur',     '[]'::jsonb,
    'exp',       '[]'::jsonb,
    'nil',       '{}'::jsonb,
    'hsn',       jsonb_build_object('data', v_hsn),
    'doc_issue', jsonb_build_object('doc_det', v_doc_issue)
  );
end;
$$;

revoke all on function admin.billing_gstr1_json(uuid, text) from public;
grant execute on function admin.billing_gstr1_json(uuid, text)
  to cs_admin, authenticated;

comment on function admin.billing_gstr1_json(uuid, text) is
  'ADR-0053 Sprint 1.1. Produces GSTR-1 v3.2 JSON for an issuer × MMYYYY period. Scope: operator → active issuer only; owner → any issuer. Sections: b2b / b2cl / b2cs / hsn / doc_issue.';
