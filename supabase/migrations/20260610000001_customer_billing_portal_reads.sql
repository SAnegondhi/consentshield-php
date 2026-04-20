-- Migration: ADR-0054 Sprint 1.1 — Customer billing portal (read path).
--
-- Adds three SECURITY DEFINER RPCs callable by `authenticated` so account-level
-- users can see their own invoices, read their billing profile, and download
-- invoice PDFs:
--
--   public.list_account_invoices()            → invoice rows scoped to caller
--   public.get_account_billing_profile()      → billing profile JSON
--   public.get_account_invoice_pdf_key(uuid)  → resolves pdf_r2_key scoped to caller
--
-- No direct GRANT SELECT on public.invoices is added — all customer-side reads
-- are RPC-mediated (consistent with the admin-side pattern and with ADR-0050's
-- explicit "customer read policy lands in ADR-0054" deferral).
--
-- Caller guard: every RPC requires current_account_role() in
-- ('account_owner', 'account_viewer'). Org-level roles (org_admin / admin /
-- viewer) raise. Admin identities never reach these RPCs in production (admin
-- proxy rejects non-is_admin=false sessions for the customer app).

-- ============================================================================
-- 1. public.list_account_invoices()
-- ============================================================================
create or replace function public.list_account_invoices()
returns table (
  id                  uuid,
  invoice_number      text,
  fy_year             text,
  fy_sequence         integer,
  issue_date          date,
  period_start        date,
  period_end          date,
  total_paise         bigint,
  subtotal_paise      bigint,
  cgst_paise          bigint,
  sgst_paise          bigint,
  igst_paise          bigint,
  status              text,
  pdf_r2_key          text,
  pdf_sha256          text,
  issuer_legal_name   text,
  account_legal_name  text,
  razorpay_invoice_id text,
  paid_at             timestamptz,
  issued_at           timestamptz,
  voided_at           timestamptz,
  voided_reason       text
)
language plpgsql
security definer
set search_path = public, billing, pg_catalog
as $$
declare
  v_account_id uuid;
  v_role       text;
begin
  v_role := public.current_account_role();
  if v_role is null or v_role not in ('account_owner', 'account_viewer') then
    raise exception 'access_denied' using errcode = '42501';
  end if;

  v_account_id := public.current_account_id();
  if v_account_id is null then
    raise exception 'no_account_context' using errcode = '42501';
  end if;

  return query
  select i.id, i.invoice_number, i.fy_year, i.fy_sequence, i.issue_date,
         i.period_start, i.period_end,
         i.total_paise, i.subtotal_paise,
         i.cgst_paise, i.sgst_paise, i.igst_paise,
         i.status, i.pdf_r2_key, i.pdf_sha256,
         ie.legal_name       as issuer_legal_name,
         a.billing_legal_name as account_legal_name,
         i.razorpay_invoice_id,
         i.paid_at, i.issued_at, i.voided_at, i.voided_reason
    from public.invoices i
    join billing.issuer_entities ie on ie.id = i.issuer_entity_id
    join public.accounts a          on a.id = i.account_id
   where i.account_id = v_account_id
   order by i.issue_date desc, i.fy_sequence desc;
end;
$$;

revoke execute on function public.list_account_invoices() from public;
grant execute on function public.list_account_invoices() to authenticated;

-- ============================================================================
-- 2. public.get_account_billing_profile()
-- ============================================================================
create or replace function public.get_account_billing_profile()
returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_account_id uuid;
  v_role       text;
  v_result     jsonb;
begin
  v_role := public.current_account_role();
  if v_role is null or v_role not in ('account_owner', 'account_viewer') then
    raise exception 'access_denied' using errcode = '42501';
  end if;

  v_account_id := public.current_account_id();
  if v_account_id is null then
    raise exception 'no_account_context' using errcode = '42501';
  end if;

  select jsonb_build_object(
    'account_id',                  a.id,
    'name',                        a.name,
    'plan_code',                   a.plan_code,
    'status',                      a.status,
    'billing_legal_name',          a.billing_legal_name,
    'billing_gstin',               a.billing_gstin,
    'billing_state_code',          a.billing_state_code,
    'billing_address',             a.billing_address,
    'billing_email',               a.billing_email,
    'billing_profile_updated_at',  a.billing_profile_updated_at,
    'role',                        v_role
  ) into v_result
    from public.accounts a
   where a.id = v_account_id;

  if v_result is null then
    raise exception 'account_not_found' using errcode = '42501';
  end if;

  return v_result;
end;
$$;

revoke execute on function public.get_account_billing_profile() from public;
grant execute on function public.get_account_billing_profile() to authenticated;

-- ============================================================================
-- 3. public.get_account_invoice_pdf_key(uuid)
--
-- Resolves the R2 key for a single invoice id, scoped to the caller's
-- account. The customer-side download route calls this, then presigns a
-- short-TTL GET URL server-side and 302-redirects the user.
-- ============================================================================
create or replace function public.get_account_invoice_pdf_key(p_invoice_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_account_id     uuid;
  v_role           text;
  v_pdf_r2_key     text;
  v_invoice_number text;
  v_status         text;
begin
  v_role := public.current_account_role();
  if v_role is null or v_role not in ('account_owner', 'account_viewer') then
    raise exception 'access_denied' using errcode = '42501';
  end if;

  v_account_id := public.current_account_id();
  if v_account_id is null then
    raise exception 'no_account_context' using errcode = '42501';
  end if;

  select pdf_r2_key, invoice_number, status
    into v_pdf_r2_key, v_invoice_number, v_status
    from public.invoices
   where id = p_invoice_id
     and account_id = v_account_id;

  if v_invoice_number is null then
    -- No matching row OR not scoped to caller's account — same raise either way
    -- (do not leak existence of invoices belonging to other accounts).
    raise exception 'invoice_not_found' using errcode = '42501';
  end if;

  if v_status = 'void' then
    raise exception 'invoice_void' using errcode = '42501';
  end if;

  if v_pdf_r2_key is null then
    raise exception 'invoice_pdf_unavailable' using errcode = '42501';
  end if;

  return jsonb_build_object(
    'pdf_r2_key',     v_pdf_r2_key,
    'invoice_number', v_invoice_number,
    'status',         v_status
  );
end;
$$;

revoke execute on function public.get_account_invoice_pdf_key(uuid) from public;
grant execute on function public.get_account_invoice_pdf_key(uuid) to authenticated;

-- ============================================================================
-- Verification (manual)
-- ============================================================================
-- select proname from pg_proc where pronamespace = 'public'::regnamespace
--   and proname in ('list_account_invoices','get_account_billing_profile','get_account_invoice_pdf_key');
-- select has_function_privilege('authenticated','public.list_account_invoices()','execute');
