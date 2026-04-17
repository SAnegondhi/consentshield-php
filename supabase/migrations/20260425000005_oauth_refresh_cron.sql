-- ADR-0039 Sprint 1.3 — schedule the oauth-token-refresh cron.

do $$ begin perform cron.unschedule('oauth-token-refresh-daily');
exception when others then null; end $$;

select cron.schedule(
  'oauth-token-refresh-daily',
  '45 3 * * *',
  $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets
            where name = 'supabase_url' limit 1)
           || '/functions/v1/oauth-token-refresh',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets
                                     where name = 'cs_orchestrator_key' limit 1),
      'Content-Type',  'application/json'
    ),
    body := '{}'::jsonb
  );
  $$
);
