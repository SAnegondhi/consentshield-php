-- ADR-0011 Sprint 1.1 — schedule the hourly retry / timeout scan.
--
-- Runs at :45 so it stays clear of the :00 buffer-sweep and the :00
-- stuck-buffer-detection jobs.
--
-- Operator prerequisite (see migration 20260414000009): Vault secret
-- `cs_orchestrator_key` must already exist, and the
-- `MASTER_ENCRYPTION_KEY` Supabase Functions secret must be set via
--   supabase secrets set MASTER_ENCRYPTION_KEY=<hex>

do $$
begin
  perform cron.unschedule('check-stuck-deletions-hourly');
exception when others then null;
end $$;

select cron.schedule(
  'check-stuck-deletions-hourly',
  '45 * * * *',
  $$
  select net.http_post(
    url := 'https://xlqiakmkdjycfiioslgs.supabase.co/functions/v1/check-stuck-deletions',
    headers := jsonb_build_object(
      'Authorization',
      'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'cs_orchestrator_key' limit 1)
    )
  );
  $$
);
