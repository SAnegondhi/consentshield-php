-- ADR-1025 Phase 4 Sprint 4.2 — storage usage snapshots + plan ceilings.
--
-- Captures per-org storage metrics (bytes + object count) from the CF R2
-- usage API once per month via pg_cron. Enables:
--   · Chargeback reporting for the admin panel.
--   · Over-ceiling alerts → ops readiness flags → sales outreach.
--   · Customer-visible usage display on the dashboard storage panel.
--
-- Cost estimation happens in the UI layer. The snapshot row is the raw
-- observable — bytes + count at a point in time. Dollar-figure derivation
-- belongs to the presentation layer (CF pricing moves; the snapshot shouldn't).

-- ═══════════════════════════════════════════════════════════
-- 1/5 · Plan ceilings
-- ═══════════════════════════════════════════════════════════

alter table public.plans
  add column if not exists storage_bytes_limit bigint;

-- Seed ceilings per plan. Numbers come from the pricing sheet:
--   trial_starter:  1  GiB        (1024^3)
--   starter:       10  GiB
--   growth:       100  GiB
--   pro:        1 000  GiB (1 TiB)
--   enterprise:   null (no ceiling — contract-based)
update public.plans set storage_bytes_limit = 1024::bigint * 1024 * 1024
  where plan_code = 'trial_starter';
update public.plans set storage_bytes_limit = 10::bigint  * 1024 * 1024 * 1024
  where plan_code = 'starter';
update public.plans set storage_bytes_limit = 100::bigint * 1024 * 1024 * 1024
  where plan_code = 'growth';
update public.plans set storage_bytes_limit = 1024::bigint * 1024 * 1024 * 1024
  where plan_code = 'pro';
-- enterprise stays null (no ceiling).

-- ═══════════════════════════════════════════════════════════
-- 2/5 · storage_usage_snapshots table
-- ═══════════════════════════════════════════════════════════

create table if not exists public.storage_usage_snapshots (
  id                  uuid primary key default gen_random_uuid(),
  org_id              uuid not null references public.organisations(id) on delete cascade,
  snapshot_date       date not null,

  -- Snapshot of the config at capture time. Important because
  -- export_configurations can change (provider swap via BYOK migration).
  storage_provider    text not null,
  bucket_name         text not null,

  -- Raw observables from the CF R2 usage API.
  payload_bytes       bigint not null default 0,
  metadata_bytes      bigint not null default 0,
  object_count        bigint not null default 0,

  -- Plan context at capture time. Helps chargeback reporting even if
  -- the org later upgrades/downgrades.
  plan_code           text,
  plan_ceiling_bytes  bigint,

  -- Generated field: is this row over its ceiling? plan_ceiling_bytes
  -- is nullable (enterprise); null ceiling → never over.
  over_ceiling        boolean generated always as (
                        plan_ceiling_bytes is not null
                        and (payload_bytes + metadata_bytes) > plan_ceiling_bytes
                      ) stored,

  error_text          text,  -- populated if the CF API call failed

  captured_at         timestamptz not null default now(),

  unique (org_id, snapshot_date)
);

create index if not exists storage_usage_snapshots_org_date_idx
  on public.storage_usage_snapshots (org_id, snapshot_date desc);
create index if not exists storage_usage_snapshots_over_idx
  on public.storage_usage_snapshots (snapshot_date desc)
  where over_ceiling = true;

comment on table public.storage_usage_snapshots is
  'ADR-1025 Phase 4 Sprint 4.2. Per-org monthly snapshots of R2 bucket '
  'usage (bytes + object count). Used for chargeback reporting + '
  'over-ceiling alerting. Raw observables only — cost derivation '
  'happens in the UI.';

-- ═══════════════════════════════════════════════════════════
-- 3/5 · RLS + grants
-- ═══════════════════════════════════════════════════════════

alter table public.storage_usage_snapshots enable row level security;

-- Customers can see their own org's snapshots (dashboard display).
create policy "org_select" on public.storage_usage_snapshots
  for select to authenticated
  using (org_id = public.current_org_id());

grant select, insert on public.storage_usage_snapshots to cs_orchestrator;

-- ═══════════════════════════════════════════════════════════
-- 4/5 · Dispatch function + monthly cron
-- ═══════════════════════════════════════════════════════════

create or replace function public.dispatch_storage_usage_snapshot()
returns bigint
language plpgsql
security definer
set search_path = public, pg_catalog, extensions
as $$
declare
  v_url text;
  v_secret text;
  v_request_id bigint;
begin
  select decrypted_secret into v_url
    from vault.decrypted_secrets
   where name = 'cs_storage_usage_url' limit 1;
  select decrypted_secret into v_secret
    from vault.decrypted_secrets
   where name = 'cs_provision_storage_secret' limit 1;
  if v_url is null or v_secret is null then return null; end if;

  select net.http_post(
    url := v_url,
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || v_secret,
      'Content-Type',  'application/json'
    ),
    body := jsonb_build_object()
  ) into v_request_id;
  return v_request_id;
end;
$$;

revoke execute on function public.dispatch_storage_usage_snapshot() from public;
grant  execute on function public.dispatch_storage_usage_snapshot() to cs_orchestrator;

-- Monthly on the 1st, 04:00 IST (22:30 UTC on the last day of the prior month).
-- Cron: '30 22 L * *' uses the 'L' extension for last-day-of-month.
-- Most pg_cron installs don't support L; use day=1 at 04:00 IST (22:30 UTC prev day).
-- Keeping it simple: 1st of month at 04:00 IST = '30 22 1 * *' doesn't parse well;
-- use '0 23 1 * *' (UTC) which is 04:30 IST on the 1st.
do $$ begin perform cron.unschedule('storage-usage-snapshot-monthly');
            exception when others then null; end $$;

select cron.schedule(
  'storage-usage-snapshot-monthly',
  '0 23 1 * *',  -- 1st of each month, 23:00 UTC (04:30 IST on the 2nd)
  $$select public.dispatch_storage_usage_snapshot()$$
);

-- ═══════════════════════════════════════════════════════════
-- 5/5 · admin.storage_usage_snapshots_query
-- ═══════════════════════════════════════════════════════════

create or replace function admin.storage_usage_snapshots_query(
  p_start_date date,
  p_end_date   date,
  p_org_id     uuid default null
)
returns table (
  id                uuid,
  org_id            uuid,
  org_name          text,
  plan_code         text,
  snapshot_date     date,
  storage_provider  text,
  bucket_name       text,
  payload_bytes     bigint,
  metadata_bytes    bigint,
  object_count      bigint,
  plan_ceiling_bytes bigint,
  over_ceiling      boolean,
  captured_at       timestamptz,
  error_text        text
)
language plpgsql
security definer
set search_path = public, admin, pg_catalog
as $$
begin
  perform admin.require_admin('support');

  return query
  select
    s.id,
    s.org_id,
    o.name,
    s.plan_code,
    s.snapshot_date,
    s.storage_provider,
    s.bucket_name,
    s.payload_bytes,
    s.metadata_bytes,
    s.object_count,
    s.plan_ceiling_bytes,
    s.over_ceiling,
    s.captured_at,
    s.error_text
  from public.storage_usage_snapshots s
  join public.organisations o on o.id = s.org_id
  where s.snapshot_date >= p_start_date
    and s.snapshot_date <= p_end_date
    and (p_org_id is null or s.org_id = p_org_id)
  order by s.snapshot_date desc, o.name asc;
end;
$$;

grant execute on function admin.storage_usage_snapshots_query(date, date, uuid) to cs_admin;

comment on function admin.storage_usage_snapshots_query(date, date, uuid) is
  'ADR-1025 Sprint 4.2. Returns storage usage snapshots joined with '
  'org name for the admin chargeback/usage widget. Support-tier gated.';

-- ═══════════════════════════════════════════════════════════
-- Operator step (one-time):
--   select vault.create_secret(
--     'https://app.consentshield.in/api/internal/storage-usage-snapshot',
--     'cs_storage_usage_url'
--   );
-- ═══════════════════════════════════════════════════════════

-- Verification queries:
-- select plan_code, storage_bytes_limit from public.plans order by plan_code;
-- select jobname, schedule, active from cron.job where jobname = 'storage-usage-snapshot-monthly';
-- select pg_get_functiondef('admin.storage_usage_snapshots_query(date,date,uuid)'::regprocedure);
