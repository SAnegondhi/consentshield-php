-- ADR-0033 Sprint 1.1 — patch for 20260426000001.
--
-- percentile_cont() returns double precision. round(double, int) does
-- not exist in Postgres — the base migration's round(a.median_latency_ms, 0)
-- raised 42883 'function round(double precision, integer) does not exist'
-- at call time. Fix: cast to numeric before round. The base migration
-- file has already been corrected in-place for future fresh applies;
-- this patch brings the already-applied remote up to date.

create or replace function admin.pipeline_delivery_health(
  p_window_hours int default 24
)
returns table (
  org_id              uuid,
  org_name            text,
  median_latency_ms   numeric,
  p95_latency_ms      numeric,
  failure_count       bigint,
  throughput          bigint,
  success_rate        numeric
)
language plpgsql
security definer
set search_path = public, admin, pg_catalog
as $$
declare
  v_since timestamptz;
begin
  perform admin.require_admin('support');

  if p_window_hours is null or p_window_hours < 1 or p_window_hours > 168 then
    raise exception 'p_window_hours must be between 1 and 168';
  end if;

  v_since := now() - (p_window_hours || ' hours')::interval;

  return query
  with events as (
    select al.org_id,
           al.event_type,
           nullif(al.payload->>'latency_ms','')::numeric as latency_ms
      from public.audit_log al
     where al.created_at >= v_since
       and al.event_type in ('consent_event_delivered','consent_event_delivery_failed')
  ),
  agg as (
    select e.org_id,
           percentile_cont(0.5)  within group (order by e.latency_ms) filter (
             where e.event_type = 'consent_event_delivered' and e.latency_ms is not null
           ) as median_latency_ms,
           percentile_cont(0.95) within group (order by e.latency_ms) filter (
             where e.event_type = 'consent_event_delivered' and e.latency_ms is not null
           ) as p95_latency_ms,
           count(*) filter (where e.event_type = 'consent_event_delivery_failed') as failure_count,
           count(*) filter (where e.event_type = 'consent_event_delivered')       as throughput
      from events e
     group by e.org_id
  )
  select a.org_id,
         coalesce(o.name, '(deleted)') as org_name,
         round(a.median_latency_ms::numeric, 0) as median_latency_ms,
         round(a.p95_latency_ms::numeric, 0)    as p95_latency_ms,
         a.failure_count,
         a.throughput,
         case
           when (a.throughput + a.failure_count) = 0 then null::numeric
           else round(
             100.0 * a.throughput::numeric / (a.throughput + a.failure_count)::numeric,
             2
           )
         end as success_rate
    from agg a
    left join public.organisations o on o.id = a.org_id
   order by a.throughput desc;
end;
$$;

grant execute on function admin.pipeline_delivery_health(int) to cs_admin;
