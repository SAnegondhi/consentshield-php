-- Enable pg_net so the cron HTTP jobs (stuck-buffer-detection-hourly,
-- sla-reminders-daily, security-scan-nightly, retention-check-daily, and the
-- new check-stuck-deletions-hourly from ADR-0011) can call Supabase Edge
-- Functions via `net.http_post`.
--
-- Required for any fresh-DB setup. Was missing from the live dev project
-- until 2026-04-16; discovered while wiring the deletion retry pipeline.
-- pg_cron's HTTP jobs had been silently failing for weeks — buffer-sweep
-- worked because it's a pure SQL call.

create extension if not exists pg_net with schema extensions;
