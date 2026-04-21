-- ADR-1012 Sprint 1.1 follow-up — rpc_api_key_usage_self referenced a
-- non-existent `created_at` column on public.api_request_log. The table
-- actually uses `occurred_at` (migration 20260601000001). Caught by the
-- first integration test run.

create or replace function public.rpc_api_key_usage_self(
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
  v_days int := greatest(1, least(coalesce(p_days, 7), 30));
begin
  if p_key_id is null then
    raise exception 'key_id_missing' using errcode = '22023';
  end if;

  return query
    with series as (
      select (current_date - (gs)::int) as day
        from generate_series(0, v_days - 1) gs
    ),
    daily as (
      select date_trunc('day', occurred_at)::date as day,
             count(*)::bigint as request_count,
             percentile_cont(0.5) within group (order by latency_ms)::numeric as p50_ms,
             percentile_cont(0.95) within group (order by latency_ms)::numeric as p95_ms
        from public.api_request_log
       where key_id = p_key_id
         and occurred_at >= current_date - (v_days - 1)
       group by 1
    )
    select s.day,
           coalesce(d.request_count, 0) as request_count,
           coalesce(d.p50_ms, 0::numeric) as p50_ms,
           coalesce(d.p95_ms, 0::numeric) as p95_ms
      from series s
      left join daily d on d.day = s.day
     order by s.day desc;
end;
$$;
