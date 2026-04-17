-- ADR-0038 Sprint 1.2 — cron health snapshot + stuck-buffer + cron-health crons.
--
-- Two concerns:
--   1. cron_health_snapshot(p_lookback_hours) — SECURITY DEFINER wrapper
--      over cron.job_run_details so cs_orchestrator (which cannot SELECT
--      the cron schema directly) can read failure counts.
--   2. Re-schedules the orphaned stuck-buffer-detection-hourly cron that
--      was dropped in 20260416000004 because the Edge Function never
--      existed — the function is landed as part of this ADR.
--   3. Schedules cron-health-daily calling the new check-cron-health
--      Edge Function.
--
-- Both crons follow the Vault-backed URL + cs_orchestrator_key pattern
-- from 20260414000009.

-- ═══════════════════════════════════════════════════════════
-- cron_health_snapshot(p_lookback_hours)
-- Returns per-job total / failed counts from cron.job_run_details.
-- SECURITY DEFINER so cs_orchestrator can read; inputs validated.
-- ═══════════════════════════════════════════════════════════
create or replace function public.cron_health_snapshot(
  p_lookback_hours int default 24
)
returns table (
  jobname          text,
  total_runs       bigint,
  failed_runs      bigint,
  last_failure_at  timestamptz
)
language plpgsql
security definer
set search_path = public, cron
as $$
begin
  if p_lookback_hours is null or p_lookback_hours < 1 or p_lookback_hours > 168 then
    raise exception 'p_lookback_hours must be between 1 and 168';
  end if;

  return query
  with window_runs as (
    select j.jobname, d.status, d.start_time
      from cron.job j
      join cron.job_run_details d on d.jobid = j.jobid
     where d.start_time >= now() - (p_lookback_hours || ' hours')::interval
  )
  select w.jobname::text,
         count(*)::bigint                                              as total_runs,
         count(*) filter (where w.status != 'succeeded')::bigint       as failed_runs,
         max(case when w.status != 'succeeded' then w.start_time end)  as last_failure_at
    from window_runs w
   group by w.jobname
   order by failed_runs desc, total_runs desc;
end;
$$;

comment on function public.cron_health_snapshot(int) is
  'ADR-0038. SECURITY DEFINER wrapper over cron.job_run_details that '
  'exposes per-job success/failure counts to cs_orchestrator (which has '
  'no grant on the cron schema). Lookback clamped to [1,168] hours. '
  'Called by the check-cron-health Edge Function on its daily schedule.';

grant execute on function public.cron_health_snapshot(int)
  to authenticated, cs_orchestrator;

-- ═══════════════════════════════════════════════════════════
-- pg_cron: stuck-buffer-detection-hourly
-- ═══════════════════════════════════════════════════════════
do $$ begin perform cron.unschedule('stuck-buffer-detection-hourly');
exception when others then null; end $$;

select cron.schedule(
  'stuck-buffer-detection-hourly',
  '7 * * * *',
  $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets
            where name = 'supabase_url' limit 1)
           || '/functions/v1/check-stuck-buffers',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets
                                     where name = 'cs_orchestrator_key' limit 1),
      'Content-Type',  'application/json'
    ),
    body := '{}'::jsonb
  );
  $$
);

-- ═══════════════════════════════════════════════════════════
-- pg_cron: cron-health-daily at 02:15 UTC (07:45 IST).
-- Runs a few minutes before expiry-alerts-daily so its alert (if any)
-- flags the preceding day's problems.
-- ═══════════════════════════════════════════════════════════
do $$ begin perform cron.unschedule('cron-health-daily');
exception when others then null; end $$;

select cron.schedule(
  'cron-health-daily',
  '15 2 * * *',
  $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets
            where name = 'supabase_url' limit 1)
           || '/functions/v1/check-cron-health',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets
                                     where name = 'cs_orchestrator_key' limit 1),
      'Content-Type',  'application/json'
    ),
    body := '{}'::jsonb
  );
  $$
);

-- Verification:
--
--   -- RPC exists:
--   select proname from pg_proc
--    where proname = 'cron_health_snapshot' and pronamespace = 'public'::regnamespace;
--    → 1 row
--
--   -- Sample output:
--   select * from public.cron_health_snapshot(24);
--    → rows for each job that ran in the last 24h with total + failed counts.
--
--   -- Crons scheduled:
--   select jobname, schedule, active from cron.job
--    where jobname in ('stuck-buffer-detection-hourly', 'cron-health-daily');
--    → 2 rows, both active.
