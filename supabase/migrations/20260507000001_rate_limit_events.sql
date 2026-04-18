-- ADR-0049 Phase 1 Sprint 1.1 — rate_limit_events ingestion.
--
-- Closes V2-S2. The Upstash Redis rate limiter (ADR-0010) is stateless;
-- once a bucket TTL expires the hit is gone. This table persists one
-- row per rejection so the admin Security Rate-limit tab can surface
-- patterns + IPs without requiring the operator to tail Upstash.
--
-- Shape matches public.worker_errors (operational, not a buffer):
--   * no delivered_at (these aren't delivered anywhere)
--   * 7-day retention via cleanup cron
--   * INSERT granted to anon + authenticated (public rights endpoints
--     run as anon; rights-dashboard callers run as authenticated)
--   * SELECT is via admin.security_rate_limit_triggers only — no
--     customer-facing read policy.

create table if not exists public.rate_limit_events (
  id              uuid        primary key default gen_random_uuid(),
  occurred_at     timestamptz not null default now(),
  endpoint        text        not null,
  ip_address      text        not null,
  org_id          uuid,
  hit_count       int         not null,
  window_seconds  int         not null,
  key_hash        text        not null
);

-- The common admin query groups by (ip_address, endpoint) over the last
-- N hours. Descending-on-occurred_at index supports that + the newest-
-- first sort in the UI.
create index if not exists rate_limit_events_ip_time_idx
  on public.rate_limit_events (ip_address, occurred_at desc);

create index if not exists rate_limit_events_occurred_at_idx
  on public.rate_limit_events (occurred_at desc);

alter table public.rate_limit_events enable row level security;

-- No customer SELECT policy. Admin reads via the SECURITY DEFINER RPC
-- below. Direct SELECT from authenticated/anon therefore returns zero
-- rows by default (RLS default-deny).

-- Server routes running as anon (public rights endpoints) or
-- authenticated (dashboard) write on every denied rate-limit check.
-- Append-only: REVOKE update + delete to prevent tampering.
grant insert on public.rate_limit_events to anon, authenticated;
revoke update, delete on public.rate_limit_events from anon, authenticated;

-- Admin read via RPC only.
grant select on public.rate_limit_events to cs_admin;

-- 7-day cleanup cron, matching worker_errors (20260416000008).
do $$
begin
  perform cron.unschedule('rate-limit-events-cleanup-daily');
exception when others then null;
end $$;

select cron.schedule(
  'rate-limit-events-cleanup-daily',
  '35 3 * * *',
  $$delete from public.rate_limit_events where occurred_at < now() - interval '7 days'$$
);

-- ═══════════════════════════════════════════════════════════
-- Rewrite admin.security_rate_limit_triggers
-- Signature unchanged from ADR-0033 Sprint 2.1 stub — UI consumes
-- (occurred_at, endpoint, ip, org_id, hit_count). Group by IP +
-- endpoint so repeated hits from the same source collapse into
-- one row with the latest timestamp + summed hit_count.
-- ═══════════════════════════════════════════════════════════

create or replace function admin.security_rate_limit_triggers(
  p_window_hours int default 24
)
returns table (
  occurred_at timestamptz,
  endpoint    text,
  ip          text,
  org_id      uuid,
  hit_count   int
)
language plpgsql
security definer
set search_path = public, admin, pg_catalog
as $$
begin
  perform admin.require_admin('support');
  if p_window_hours is null or p_window_hours < 1 or p_window_hours > 168 then
    raise exception 'p_window_hours must be between 1 and 168';
  end if;

  return query
  select max(rle.occurred_at)     as occurred_at,
         rle.endpoint,
         rle.ip_address            as ip,
         -- A single IP can hit multiple orgs; pick the most recent one
         -- as the representative on the group (max() by occurred_at).
         (array_agg(rle.org_id order by rle.occurred_at desc))[1] as org_id,
         sum(rle.hit_count)::int   as hit_count
    from public.rate_limit_events rle
   where rle.occurred_at >= now() - (p_window_hours || ' hours')::interval
   group by rle.endpoint, rle.ip_address
   order by max(rle.occurred_at) desc;
end;
$$;

comment on function admin.security_rate_limit_triggers(int) is
  'ADR-0049 Phase 1.1. Reads public.rate_limit_events grouped by '
  '(endpoint, ip_address) over p_window_hours. Replaces the ADR-0033 '
  'stub. support+.';

grant execute on function admin.security_rate_limit_triggers(int) to cs_admin;

-- Verification:
--   select count(*) from pg_class where relname = 'rate_limit_events'; → 1
--   select proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace
--    where n.nspname = 'admin' and proname = 'security_rate_limit_triggers'; → 1
--   select jobname from cron.job where jobname = 'rate-limit-events-cleanup-daily'; → 1
