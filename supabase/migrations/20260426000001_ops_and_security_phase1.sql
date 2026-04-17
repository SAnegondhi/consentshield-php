-- ADR-0033 Sprint 1.1 — Pipeline Operations admin RPCs.
--
-- Four admin-scoped SECURITY DEFINER functions backing the Pipeline
-- Operations panel (wireframe §7). Each wraps an existing data source:
--
--   pipeline_worker_errors_list       → public.worker_errors (ADR-0016 / 20260416000008)
--   pipeline_stuck_buffers_snapshot   → public.detect_stuck_buffers() (ADR-0011 / 0020)
--   pipeline_depa_expiry_queue        → consent_artefacts × organisations × depa_compliance_metrics
--   pipeline_delivery_health          → audit_log aggregates over the window
--
-- All four:
--   * Gate at entry with admin.require_admin('support') — any admin role
--     (support or platform_operator) can read ops data.
--   * SECURITY DEFINER to cross org RLS (admin = cross-org read surface).
--   * search_path pinned to public, admin, pg_catalog.
--   * EXECUTE granted only to cs_admin (not authenticated, not cs_orchestrator).
--   * Input parameters validated + clamped where a range is meaningful.
--
-- Security & Billing RPCs for this ADR ship in a Phase 2 migration
-- (20260427000001_ops_and_security_phase2.sql).

-- ═══════════════════════════════════════════════════════════
-- 1/4 · pipeline_worker_errors_list
-- Newest-first list of the last N worker_errors, with org name joined.
-- ═══════════════════════════════════════════════════════════
create or replace function admin.pipeline_worker_errors_list(
  p_limit int default 100
)
returns table (
  id             uuid,
  occurred_at    timestamptz,
  endpoint       text,
  status_code    integer,
  upstream_error text,
  org_id         uuid,
  org_name       text,
  property_id    uuid
)
language plpgsql
security definer
set search_path = public, admin, pg_catalog
as $$
begin
  perform admin.require_admin('support');

  if p_limit is null or p_limit < 1 or p_limit > 1000 then
    raise exception 'p_limit must be between 1 and 1000';
  end if;

  return query
  select w.id,
         w.created_at                        as occurred_at,
         w.endpoint,
         w.status_code,
         w.upstream_error,
         w.org_id,
         coalesce(o.name, '(deleted)')       as org_name,
         w.property_id
    from public.worker_errors w
    left join public.organisations o on o.id = w.org_id
   where w.created_at >= now() - interval '24 hours'
   order by w.created_at desc
   limit p_limit;
end;
$$;

comment on function admin.pipeline_worker_errors_list(int) is
  'ADR-0033 Sprint 1.1. Admin Pipeline Ops — Worker errors tab. '
  'Returns the last 24h of worker_errors with org name. '
  'Gated by admin.require_admin(''support''). Cross-org read via SECURITY DEFINER.';

grant execute on function admin.pipeline_worker_errors_list(int) to cs_admin;

-- ═══════════════════════════════════════════════════════════
-- 2/4 · pipeline_stuck_buffers_snapshot
-- Thin wrapper over public.detect_stuck_buffers() — adds human-friendly
-- oldest_age_seconds (the existing RPC returns oldest_created timestamps).
-- ═══════════════════════════════════════════════════════════
create or replace function admin.pipeline_stuck_buffers_snapshot()
returns table (
  buffer_table        text,
  stuck_count         bigint,
  oldest_created      timestamptz,
  oldest_age_seconds  bigint
)
language plpgsql
security definer
set search_path = public, admin, pg_catalog
as $$
begin
  perform admin.require_admin('support');

  return query
  select s.buffer_table,
         s.stuck_count,
         s.oldest_created,
         case
           when s.oldest_created is null then null::bigint
           else extract(epoch from (now() - s.oldest_created))::bigint
         end as oldest_age_seconds
    from public.detect_stuck_buffers() s;
end;
$$;

comment on function admin.pipeline_stuck_buffers_snapshot() is
  'ADR-0033 Sprint 1.1. Admin Pipeline Ops — Stuck buffers tab. '
  'Wraps detect_stuck_buffers() and adds oldest_age_seconds for the UI pill. '
  'Rule 11: >1h is a failure, >24h is a P0, amber at 30min (enforced client-side).';

grant execute on function admin.pipeline_stuck_buffers_snapshot() to cs_admin;

-- ═══════════════════════════════════════════════════════════
-- 3/4 · pipeline_depa_expiry_queue
-- Per-org counts of artefacts expiring in the short/medium window, plus
-- the last expiry alert timestamp from audit_log (event_type='artefact_expiry_alerted').
-- ═══════════════════════════════════════════════════════════
create or replace function admin.pipeline_depa_expiry_queue()
returns table (
  org_id                     uuid,
  org_name                   text,
  expiring_lt_7d             bigint,
  expiring_lt_30d            bigint,
  expired_awaiting_enforce   bigint,
  last_expiry_alert_at       timestamptz
)
language plpgsql
security definer
set search_path = public, admin, pg_catalog
as $$
begin
  perform admin.require_admin('support');

  return query
  with org_counts as (
    select o.id as org_id,
           o.name as org_name,
           count(*) filter (
             where a.status = 'active'
               and a.expires_at >  now()
               and a.expires_at <  now() + interval '7 days'
           ) as expiring_lt_7d,
           count(*) filter (
             where a.status = 'active'
               and a.expires_at >  now()
               and a.expires_at <  now() + interval '30 days'
           ) as expiring_lt_30d,
           count(*) filter (
             where a.status = 'active'
               and a.expires_at <= now()
           ) as expired_awaiting_enforce
      from public.organisations o
      left join public.consent_artefacts a on a.org_id = o.id
     group by o.id, o.name
  ),
  last_alert as (
    select al.org_id,
           max(al.created_at) as last_expiry_alert_at
      from public.audit_log al
     where al.event_type = 'artefact_expiry_alerted'
       and al.created_at >= now() - interval '7 days'
     group by al.org_id
  )
  select oc.org_id,
         oc.org_name,
         oc.expiring_lt_7d,
         oc.expiring_lt_30d,
         oc.expired_awaiting_enforce,
         la.last_expiry_alert_at
    from org_counts oc
    left join last_alert la on la.org_id = oc.org_id
   where oc.expiring_lt_30d > 0
      or oc.expired_awaiting_enforce > 0
   order by oc.expiring_lt_7d desc, oc.expiring_lt_30d desc;
end;
$$;

comment on function admin.pipeline_depa_expiry_queue() is
  'ADR-0033 Sprint 1.1. Admin Pipeline Ops — DEPA expiry queue tab. '
  'Per-org counts of artefacts expiring in 7d/30d plus already-expired-awaiting-enforcement, '
  'joined with the last expiry alert timestamp from audit_log.';

grant execute on function admin.pipeline_depa_expiry_queue() to cs_admin;

-- ═══════════════════════════════════════════════════════════
-- 4/4 · pipeline_delivery_health
-- Per-org delivery latency + success rate + throughput over a window.
-- Sources: audit_log events 'consent_event_delivered' / 'consent_event_delivery_failed'.
-- Latency is best-effort: audit_log.payload->>'latency_ms' when present,
-- else null (the UI tile falls back to '—'). Success rate and throughput
-- are always computable.
-- ═══════════════════════════════════════════════════════════
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

comment on function admin.pipeline_delivery_health(int) is
  'ADR-0033 Sprint 1.1. Admin Pipeline Ops — Delivery health tab. '
  'Per-org median+p95 latency, failure count, throughput, success rate over a '
  '[1,168] hour window. Latency is best-effort from audit_log.payload.latency_ms '
  '— null when upstream writers do not populate it (UI shows "—"). '
  'Success rate = delivered / (delivered + failed).';

grant execute on function admin.pipeline_delivery_health(int) to cs_admin;

-- Verification:
--
--   select proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--    where n.nspname = 'admin' and proname like 'pipeline_%';
--    → 4 rows: pipeline_worker_errors_list, pipeline_stuck_buffers_snapshot,
--              pipeline_depa_expiry_queue, pipeline_delivery_health.
--
--   -- As cs_admin (via JWT with app_metadata.is_admin = true):
--   select * from admin.pipeline_stuck_buffers_snapshot();
--   select * from admin.pipeline_worker_errors_list(10);
--   select * from admin.pipeline_depa_expiry_queue();
--   select * from admin.pipeline_delivery_health(24);
--
--   -- As an ordinary authenticated user (no admin claim):
--   select admin.pipeline_stuck_buffers_snapshot();
--    → raises 'admin claim required' (SQLSTATE 42501).
