-- ADR-0027 Sprint 3.1 prerequisite — add public.organisations.status + settings.
--
-- The admin RPCs admin.suspend_org / admin.restore_org /
-- admin.update_customer_setting mutate columns the admin-platform schema
-- doc §7 assumed "already exist" in public.organisations. They don't.
-- This migration adds them with safe defaults so existing rows are
-- unaffected and the admin RPCs in the following migration can reference
-- them.
--
-- Customer-side behaviour:
--   - `status` is read by the Cloudflare Worker's banner handler; when a
--     row is 'suspended', the Worker serves a no-op banner (Sprint 3.2
--     wiring; this migration only adds the column).
--   - `settings` is a jsonb merge-bucket for per-org flags too fine-
--     grained for a full admin.feature_flags entry.
--
-- Per docs/admin/architecture/consentshield-admin-schema.md §7 (amended
-- — see ADR-0027 Architecture Changes).

alter table public.organisations
  add column if not exists status text not null default 'active'
    check (status in ('active','suspended','archived'));

alter table public.organisations
  add column if not exists settings jsonb not null default '{}'::jsonb;

create index if not exists organisations_status_idx
  on public.organisations (status)
  where status <> 'active';

-- Verification:
--   select count(*) from information_schema.columns
--     where table_schema='public' and table_name='organisations'
--       and column_name in ('status','settings'); → 2
--   select count(*) from public.organisations where status <> 'active'; → 0
