-- ADR-1012 Sprint 1.1 — introspection RPCs for /v1/keys/self and /v1/usage.
--
-- Both are cs_api-friendly variants of existing dashboard-side functions.
-- The middleware verified the Bearer; by the time these RPCs run, the
-- route handler passes context.key_id (never a caller-supplied value), so
-- the RPCs themselves have no extra authz — the guarantee is upstream.
--
-- Neither endpoint has a scope gate: any valid Bearer can introspect its
-- own metadata (same pattern as /v1/_ping).

-- ============================================================================
-- 1. rpc_api_key_self — metadata for the presenting Bearer
-- ============================================================================
--
-- Returns a safe subset of api_keys: never returns key_hash / previous_key_hash
-- / revoked_by (would leak operator identity). revoked_at is included but
-- always null in practice — a revoked key is rejected at the middleware layer
-- (410 Gone) before this RPC runs.

create or replace function public.rpc_api_key_self(p_key_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, pg_catalog
as $$
declare
  v_row record;
begin
  if p_key_id is null then
    raise exception 'key_id_missing' using errcode = '22023';
  end if;

  select id, account_id, org_id, name, key_prefix, scopes, rate_tier,
         created_at, last_rotated_at, expires_at, revoked_at
    into v_row
    from public.api_keys
   where id = p_key_id;

  if not found then
    raise exception 'api_key_not_found' using errcode = 'P0001';
  end if;

  return jsonb_build_object(
    'key_id',          v_row.id,
    'account_id',      v_row.account_id,
    'org_id',          v_row.org_id,
    'name',            v_row.name,
    'key_prefix',      v_row.key_prefix,
    'scopes',          to_jsonb(coalesce(v_row.scopes, '{}'::text[])),
    'rate_tier',       v_row.rate_tier,
    'created_at',      v_row.created_at,
    'last_rotated_at', v_row.last_rotated_at,
    'expires_at',      v_row.expires_at,
    'revoked_at',      v_row.revoked_at
  );
end;
$$;

revoke all on function public.rpc_api_key_self(uuid) from public;
revoke execute on function public.rpc_api_key_self(uuid) from anon, authenticated;
grant execute on function public.rpc_api_key_self(uuid) to cs_api;

comment on function public.rpc_api_key_self(uuid) is
  'ADR-1012 Sprint 1.1 — /v1/keys/self. Returns the public metadata of the '
  'api_keys row identified by p_key_id. No extra authz: the middleware has '
  'already verified the Bearer = p_key_id before this RPC runs.';

-- ============================================================================
-- 2. rpc_api_key_usage_self — 7-day usage roll-up for the presenting Bearer
-- ============================================================================
--
-- Mirror of rpc_api_key_usage (20260601000001) without the
-- account-membership authz (that one is for the dashboard). Caller identity
-- is implicit: the middleware has already verified p_key_id = Bearer.key_id.

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
      select date_trunc('day', created_at)::date as day,
             count(*)::bigint as request_count,
             percentile_cont(0.5) within group (order by latency_ms)::numeric as p50_ms,
             percentile_cont(0.95) within group (order by latency_ms)::numeric as p95_ms
        from public.api_request_log
       where key_id = p_key_id
         and created_at >= current_date - (v_days - 1)
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

revoke all on function public.rpc_api_key_usage_self(uuid, int) from public;
revoke execute on function public.rpc_api_key_usage_self(uuid, int) from anon, authenticated;
grant execute on function public.rpc_api_key_usage_self(uuid, int) to cs_api;

comment on function public.rpc_api_key_usage_self(uuid, int) is
  'ADR-1012 Sprint 1.1 — /v1/usage. Per-day usage roll-up (request_count, '
  'p50_ms, p95_ms) for p_key_id over the last p_days days (clamped 1..30). '
  'Zero-filled for days with no activity. No authz — middleware guarantees '
  'p_key_id = Bearer.key_id.';
