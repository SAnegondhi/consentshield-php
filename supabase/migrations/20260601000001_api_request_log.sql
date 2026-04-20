-- ADR-1001 Sprint 2.4 — rate-tier plan columns + request-log RPCs
--
-- public.api_request_log already exists (20260520000001_api_keys_v2.sql) with
-- daily partitions, RLS, and retention cron. This migration adds:
--
--   1. api_rate_limit_per_hour + api_burst columns on public.plans
--   2. rpc_api_request_log_insert — SECURITY DEFINER INSERT callable by service_role
--   3. rpc_api_key_usage          — 7-day aggregation for the usage dashboard
--
-- Column names in api_request_log (from 20260520000001):
--   route, status, latency_ms, response_bytes, user_agent

-- ── 1. Rate-tier columns on public.plans ─────────────────────────────────────
-- Mirrored in app/src/lib/api/rate-limits.ts — keep in sync.

alter table public.plans
  add column if not exists api_rate_limit_per_hour int not null default 100,
  add column if not exists api_burst               int not null default 20;

update public.plans set api_rate_limit_per_hour = 100,    api_burst = 20
  where plan_code in ('trial', 'trial_starter', 'starter', 'sandbox');
update public.plans set api_rate_limit_per_hour = 1000,   api_burst = 100
  where plan_code = 'growth';
update public.plans set api_rate_limit_per_hour = 10000,  api_burst = 500
  where plan_code = 'pro';
update public.plans set api_rate_limit_per_hour = 100000, api_burst = 2000
  where plan_code = 'enterprise';

-- ── 2. INSERT RPC ─────────────────────────────────────────────────────────────
-- Route handlers call this via the service-role client. Non-sensitive data only.

create or replace function public.rpc_api_request_log_insert(
  p_key_id    uuid,
  p_org_id    uuid,
  p_account_id uuid,
  p_route     text,
  p_method    text,
  p_status    int,
  p_latency   int
) returns void
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
begin
  insert into public.api_request_log
    (key_id, org_id, account_id, route, method, status, latency_ms)
  values
    (p_key_id, p_org_id, p_account_id, p_route, p_method, p_status, p_latency);
exception when others then
  null; -- Logging must never break the API response.
end;
$$;

grant execute on function public.rpc_api_request_log_insert(uuid, uuid, uuid, text, text, int, int)
  to service_role;

-- ── 3. Usage RPC ──────────────────────────────────────────────────────────────

create or replace function public.rpc_api_key_usage(
  p_key_id uuid,
  p_days   int default 7
) returns table (
  day           date,
  request_count bigint,
  p50_ms        numeric,
  p95_ms        numeric
)
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_uid uuid := public.current_uid();
begin
  if not exists (
    select 1
      from public.api_keys k
      join public.account_memberships am on am.account_id = k.account_id
     where k.id       = p_key_id
       and am.user_id = v_uid
       and am.status  = 'active'
       and am.role    in ('account_owner', 'account_viewer')
  ) then
    raise exception 'not authorised' using errcode = '42501';
  end if;

  return query
    select
      date_trunc('day', r.occurred_at)::date                                          as day,
      count(*)                                                                         as request_count,
      round(percentile_cont(0.5) within group (order by r.latency_ms)::numeric, 0)   as p50_ms,
      round(percentile_cont(0.95) within group (order by r.latency_ms)::numeric, 0)  as p95_ms
    from public.api_request_log r
   where r.key_id      = p_key_id
     and r.occurred_at >= now() - (p_days || ' days')::interval
   group by date_trunc('day', r.occurred_at)
   order by day;
end;
$$;

grant execute on function public.rpc_api_key_usage(uuid, int) to authenticated;
