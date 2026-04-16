-- N-S3 fix from docs/reviews/2026-04-16-phase2-completion-review.md.
--
-- Replace the hardcoded Supabase project URL in pg_cron HTTP jobs with a
-- Vault lookup, mirroring the existing `cs_orchestrator_key` pattern from
-- migration 20260414000009.
--
-- Before this migration: every HTTP cron job carried the literal
--   'https://xlqiakmkdjycfiioslgs.supabase.co/functions/v1/<fn>'
-- making project moves a find-and-replace exercise across migrations.
--
-- Operator one-time action (NOT in this migration — Vault secrets stay
-- out of source control):
--   select vault.create_secret(
--     'https://xlqiakmkdjycfiioslgs.supabase.co',
--     'supabase_url'
--   );

do $$ begin
  perform cron.unschedule('sla-reminders-daily');
exception when others then null;
end $$;
do $$ begin
  perform cron.unschedule('check-stuck-deletions-hourly');
exception when others then null;
end $$;
do $$ begin
  perform cron.unschedule('security-scan-nightly');
exception when others then null;
end $$;
do $$ begin
  perform cron.unschedule('consent-probes-hourly');
exception when others then null;
end $$;

select cron.schedule(
  'sla-reminders-daily',
  '30 2 * * *',
  $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'supabase_url' limit 1) || '/functions/v1/send-sla-reminders',
    headers := jsonb_build_object(
      'Authorization',
      'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'cs_orchestrator_key' limit 1)
    )
  );
  $$
);

select cron.schedule(
  'check-stuck-deletions-hourly',
  '45 * * * *',
  $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'supabase_url' limit 1) || '/functions/v1/check-stuck-deletions',
    headers := jsonb_build_object(
      'Authorization',
      'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'cs_orchestrator_key' limit 1)
    )
  );
  $$
);

select cron.schedule(
  'security-scan-nightly',
  '30 20 * * *',
  $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'supabase_url' limit 1) || '/functions/v1/run-security-scans',
    headers := jsonb_build_object(
      'Authorization',
      'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'cs_orchestrator_key' limit 1)
    )
  );
  $$
);

select cron.schedule(
  'consent-probes-hourly',
  '10 * * * *',
  $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'supabase_url' limit 1) || '/functions/v1/run-consent-probes',
    headers := jsonb_build_object(
      'Authorization',
      'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'cs_orchestrator_key' limit 1)
    )
  );
  $$
);
