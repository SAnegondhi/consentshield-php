-- ADR-0046 Phase 1 Sprint 1.1 — Significant Data Fiduciary (SDF) status
-- marker on organisations.
--
-- Minimum viable surface. Adds three columns that let an organisation
-- declare or be notified as an SDF per DPDP §10 + Draft Rules, plus a
-- single admin RPC for the operator console to set the status from
-- the /orgs detail page. Surface 2 (DPIA records) and Surface 3
-- (auditor engagements) ship in later phases.
--
-- Column semantics:
--   sdf_status ∈ {
--     'not_designated'  default; no obligations
--     'self_declared'   customer voluntarily claims SDF (rare pre-notification)
--     'notified'        Central Government notification received — audited
--     'exempt'          notification carved out this class; documented
--   }
--   sdf_notified_at    — when the notification was received (nullable)
--   sdf_notification_ref — Gazette reference or Ministry letter id (nullable,
--                          category/reference only — no PDF bytes, Rule 3)

alter table public.organisations
  add column if not exists sdf_status text not null default 'not_designated';

alter table public.organisations
  add column if not exists sdf_notified_at timestamptz;

alter table public.organisations
  add column if not exists sdf_notification_ref text;

alter table public.organisations
  drop constraint if exists organisations_sdf_status_check;

alter table public.organisations
  add constraint organisations_sdf_status_check
  check (sdf_status in ('not_designated', 'self_declared', 'notified', 'exempt'));

-- Partial index on designated orgs so the admin dashboard can list
-- "SDF-flagged organisations" cheaply.
create index if not exists organisations_sdf_designated_idx
  on public.organisations (sdf_status)
  where sdf_status <> 'not_designated';

comment on column public.organisations.sdf_status is
  'ADR-0046 Phase 1. Significant Data Fiduciary status per DPDP §10. '
  'Default not_designated; self_declared (voluntary), notified (gazetted), '
  'or exempt (class carve-out).';

comment on column public.organisations.sdf_notification_ref is
  'ADR-0046 Phase 1. Gazette notification reference / Ministry letter id. '
  'CATEGORY/REFERENCE ONLY — never store notification PDF bytes per Rule 3; '
  'the customer retains the artefact in their own storage.';

-- ═══════════════════════════════════════════════════════════
-- admin.set_sdf_status — operator RPC
-- ═══════════════════════════════════════════════════════════
--
-- Sets sdf_status on an organisation + the optional notification
-- metadata. platform_operator only. Audit-logged. Clears
-- sdf_notified_at + sdf_notification_ref when going back to
-- 'not_designated' so stale metadata doesn't linger.

create or replace function admin.set_sdf_status(
  p_org_id               uuid,
  p_sdf_status           text,
  p_sdf_notification_ref text,
  p_sdf_notified_at      timestamptz,
  p_reason               text
)
returns void
language plpgsql
security definer
set search_path = public, admin, pg_catalog
as $$
declare
  v_operator uuid := auth.uid();
  v_old      jsonb;
begin
  perform admin.require_admin('platform_operator');

  if p_sdf_status not in ('not_designated', 'self_declared', 'notified', 'exempt') then
    raise exception 'sdf_status must be not_designated, self_declared, notified, or exempt';
  end if;
  if length(coalesce(p_reason, '')) < 10 then
    raise exception 'reason required (≥10 chars)';
  end if;

  select jsonb_build_object(
           'sdf_status',           o.sdf_status,
           'sdf_notified_at',      o.sdf_notified_at,
           'sdf_notification_ref', o.sdf_notification_ref
         )
    into v_old
    from public.organisations o
   where o.id = p_org_id;
  if v_old is null then
    raise exception 'org not found';
  end if;

  update public.organisations
     set sdf_status           = p_sdf_status,
         sdf_notified_at      = case when p_sdf_status = 'not_designated' then null
                                     else p_sdf_notified_at end,
         sdf_notification_ref = case when p_sdf_status = 'not_designated' then null
                                     else p_sdf_notification_ref end,
         updated_at           = now()
   where id = p_org_id;

  insert into admin.admin_audit_log
    (admin_user_id, action, target_table, target_id, org_id, old_value, new_value, reason)
  values
    (v_operator, 'set_sdf_status', 'public.organisations', p_org_id, p_org_id,
     v_old,
     jsonb_build_object(
       'sdf_status',           p_sdf_status,
       'sdf_notified_at',      case when p_sdf_status = 'not_designated' then null
                                    else p_sdf_notified_at end,
       'sdf_notification_ref', case when p_sdf_status = 'not_designated' then null
                                    else p_sdf_notification_ref end
     ),
     p_reason);
end;
$$;

grant execute on function admin.set_sdf_status(uuid, text, text, timestamptz, text) to authenticated, cs_admin;

comment on function admin.set_sdf_status(uuid, text, text, timestamptz, text) is
  'ADR-0046 Phase 1. Operator-only RPC to declare, update, or clear SDF '
  'status on an organisation. platform_operator required. Audit-logged. '
  'Clears notification metadata when status reverts to not_designated.';

-- Verification:
--   select column_name from information_schema.columns
--    where table_schema='public' and table_name='organisations' and column_name like 'sdf%';
--    → sdf_status, sdf_notified_at, sdf_notification_ref (3 rows)
--
--   select proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace
--    where n.nspname='admin' and proname='set_sdf_status'; → 1 row
