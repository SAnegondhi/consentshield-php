-- ADR-1018 Sprint 1.4 — probe cron + health_url updates + heartbeat check.
--
-- 1. Update 2 seeded status_subsystems rows to point at the new unauthenticated
--    /api/_health + /_health endpoints (Sprint 1.4 code additions).
-- 2. Schedule cron `status-probes-5min` to invoke run-status-probes via net.http_post.
--    The Edge Function is declared with verify_jwt = false in supabase/config.toml
--    (see 20260804000013 gotcha — Supabase HS256 rotation breaks Vault JWTs). The
--    Bearer is left for symmetry with other crons; the function ignores it.
-- 3. Schedule `status-probes-heartbeat-check` every 15 minutes — if no status_checks
--    row has been written in the last 30 minutes, insert an admin.ops_readiness_flags
--    row so the probe itself being wedged doesn't become silent.

-- ============================================================================
-- 1. Health-URL backfill (idempotent — only sets rows that are still null)
-- ============================================================================

update public.status_subsystems
   set health_url = 'https://app.consentshield.in/api/health',
       updated_at = now()
 where slug = 'verification_api'
   and (health_url is null or health_url = 'https://app.consentshield.in/api/v1/_ping');

update public.status_subsystems
   set health_url = 'https://app.consentshield.in/api/health',
       updated_at = now()
 where slug = 'dashboard'
   and (health_url is null or health_url = 'https://app.consentshield.in');

update public.status_subsystems
   set health_url = 'https://xlqiakmkdjycfiioslgs.supabase.co/functions/v1/health',
       updated_at = now()
 where slug = 'deletion_orchestration'
   and health_url is null;

-- notification_channels stays null until ADR-1005 Sprint 6.1 ships the adapters.

-- ============================================================================
-- 2. Probe cron — every 5 minutes
-- ============================================================================

do $$
begin
  perform cron.unschedule('status-probes-5min');
exception when others then null;
end $$;

select cron.schedule(
  'status-probes-5min',
  '*/5 * * * *',
  $$
  select net.http_post(
    url := 'https://xlqiakmkdjycfiioslgs.supabase.co/functions/v1/run-status-probes',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization',
      'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'cs_orchestrator_key' limit 1)
    ),
    body := '{}'::jsonb
  );
  $$
);

-- ============================================================================
-- 3. Heartbeat check — every 15 minutes
-- ============================================================================
--
-- If no status_checks row has been inserted in the last 30 minutes, the probe
-- cron has failed to run. We can't fix that from inside pg_cron, but we can
-- surface it on /admin/(operator)/readiness so an operator notices.
-- Idempotent: only inserts when no unresolved flag for this source already
-- exists (title uniqueness within pending/in_progress).

do $$
begin
  perform cron.unschedule('status-probes-heartbeat-check');
exception when others then null;
end $$;

select cron.schedule(
  'status-probes-heartbeat-check',
  '*/15 * * * *',
  $$
  with latest as (
    select max(checked_at) as last_at from public.status_checks
  )
  insert into admin.ops_readiness_flags (
    title, description, source_adr, blocker_type, severity, status
  )
  select
    'Status probes have not run for >30 minutes',
    'The status-probes-5min cron has not inserted a status_checks row in the '
      || 'last 30 minutes. Check pg_cron logs + run-status-probes Edge Function '
      || 'logs. Public /status + admin /status panel may show stale state.',
    'ADR-1018',
    'infra',
    'high',
    'pending'
  from latest
  where (last_at is null or last_at < now() - interval '30 minutes')
    and not exists (
      select 1
        from admin.ops_readiness_flags
       where source_adr = 'ADR-1018'
         and title = 'Status probes have not run for >30 minutes'
         and status in ('pending', 'in_progress')
    );
  $$
);
