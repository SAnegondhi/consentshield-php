-- ADR-0027 Sprint 3.1 — admin pg_cron jobs.
--
-- Schedules 4 jobs that keep the admin platform humming:
--
--   1. admin-create-next-audit-partition (0 6 25 * *)
--      — creates next month's admin_audit_log_YYYY_MM partition on the
--        25th of each month. 5-day buffer before the 1st when the new
--        partition's first INSERT would otherwise fail.
--
--   2. admin-expire-impersonation-sessions (*/5 * * * *)
--      — flips active sessions past their expires_at to status='expired'.
--        Edge Function that notifies customers on session end reads this
--        via the pg_notify the admin.end_impersonation RPC emits — the
--        expiry path uses a trigger (below) to achieve the same.
--
--   3. admin-refresh-platform-metrics (0 2 * * *)
--      — refreshes yesterday's metrics row nightly at 02:00 UTC.
--
--   4. admin-sync-config-to-kv (*/2 * * * *)
--      — kicks the sync-admin-config-to-kv Edge Function (Sprint 3.2)
--        every 2 minutes so KV stays within 2 minutes of DB state. Until
--        Sprint 3.2 lands, this fires against a 404 — harmless in dev.
--
-- Per docs/admin/architecture/consentshield-admin-schema.md §9.

-- 1. Monthly audit-log partition creator.
select cron.schedule(
  'admin-create-next-audit-partition',
  '0 6 25 * *',
  $$ select admin.create_next_audit_partition(); $$
);

-- 2. Impersonation-session expiry sweep. Also emits pg_notify for the
-- Edge Function that notifies customers (same channel the manual
-- end_impersonation RPC uses), so the downstream handler doesn't need
-- to care whether the session ended manually or by timeout.
select cron.schedule(
  'admin-expire-impersonation-sessions',
  '*/5 * * * *',
  $$
    with expired as (
      update admin.impersonation_sessions
         set status = 'expired',
             ended_at = now(),
             ended_reason = 'expired'
       where status = 'active' and expires_at < now()
      returning id, target_org_id
    )
    select pg_notify(
      'impersonation_ended',
      jsonb_build_object('session_id', id, 'org_id', target_org_id, 'expired', true)::text
    ) from expired;
  $$
);

-- 3. Platform metrics nightly refresh.
select cron.schedule(
  'admin-refresh-platform-metrics',
  '0 2 * * *',
  $$ select admin.refresh_platform_metrics(current_date - 1); $$
);

-- 4. Sync admin config (kill_switches + published sectoral_templates +
-- active tracker_signature_catalogue) to Cloudflare KV. The Edge
-- Function verifies the Authorization header against vault-stored
-- cron_secret; the URL is read from vault.decrypted_secrets.supabase_url
-- per the reference_supabase_platform_gotchas memory.
select cron.schedule(
  'admin-sync-config-to-kv',
  '*/2 * * * *',
  $$
    select net.http_post(
      url := (select decrypted_secret
                from vault.decrypted_secrets
               where name = 'supabase_url') || '/functions/v1/sync-admin-config-to-kv',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || (select decrypted_secret
                                         from vault.decrypted_secrets
                                        where name = 'cron_secret')
      )
    );
  $$
);

-- Verification:
--   select count(*) from cron.job where jobname like 'admin-%'; → 4
--   select jobname, schedule from cron.job where jobname like 'admin-%' order by jobname;
