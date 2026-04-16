-- ADR-0016 Sprint 1 — schedule the hourly consent-probe runner.
--
-- Runs at :10 past the hour — clear of buffer-sweep (:00, :15, :30, :45),
-- sla-reminders (02:30 UTC), check-stuck-deletions (:45), and
-- security-scan-nightly (20:30 UTC).

do $$
begin
  perform cron.unschedule('consent-probes-hourly');
exception when others then null;
end $$;

select cron.schedule(
  'consent-probes-hourly',
  '10 * * * *',
  $$
  select net.http_post(
    url := 'https://xlqiakmkdjycfiioslgs.supabase.co/functions/v1/run-consent-probes',
    headers := jsonb_build_object(
      'Authorization',
      'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'cs_orchestrator_key' limit 1)
    )
  );
  $$
);
