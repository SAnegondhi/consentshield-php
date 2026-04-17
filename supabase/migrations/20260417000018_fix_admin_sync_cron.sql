-- ADR-0027 Sprint 3.2 — fix admin-sync-config-to-kv bearer token.
--
-- Sprint 3.1 scheduled the cron using vault secret name 'cron_secret'
-- per schema-doc §9. The vault only ever contained 'cs_orchestrator_key'
-- and 'supabase_url' — 'cron_secret' does not exist, so every 2-minute
-- invocation silently failed with a NULL header value.
--
-- All other customer-side crons (migrations 20260414000009,
-- 20260416000005/6, 20260416000009, 20260416000002) use
-- 'cs_orchestrator_key' as their bearer, so the admin cron converges
-- on the same name.

select cron.unschedule('admin-sync-config-to-kv');

select cron.schedule(
  'admin-sync-config-to-kv',
  '*/2 * * * *',
  $$
    select net.http_post(
      url := (select decrypted_secret
                from vault.decrypted_secrets
               where name = 'supabase_url' limit 1) || '/functions/v1/sync-admin-config-to-kv',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || (select decrypted_secret
                                         from vault.decrypted_secrets
                                        where name = 'cs_orchestrator_key' limit 1)
      )
    );
  $$
);

-- Verification:
--   select count(*) from cron.job where jobname='admin-sync-config-to-kv'; → 1
--   select command from cron.job where jobname='admin-sync-config-to-kv';
--     → must reference 'cs_orchestrator_key' not 'cron_secret'
