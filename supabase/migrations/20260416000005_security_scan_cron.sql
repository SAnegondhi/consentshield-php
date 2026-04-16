-- ADR-0015 Sprint 1.1 — re-schedule the nightly security posture scan.
-- Unscheduled in 20260416000004_unschedule_orphan_crons.sql; now that the
-- run-security-scans Edge Function exists we can put it back.

do $$
begin
  perform cron.unschedule('security-scan-nightly');
exception when others then null;
end $$;

select cron.schedule(
  'security-scan-nightly',
  '30 20 * * *',  -- 02:00 IST
  $$
  select net.http_post(
    url := 'https://xlqiakmkdjycfiioslgs.supabase.co/functions/v1/run-security-scans',
    headers := jsonb_build_object(
      'Authorization',
      'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'cs_orchestrator_key' limit 1)
    )
  );
  $$
);
