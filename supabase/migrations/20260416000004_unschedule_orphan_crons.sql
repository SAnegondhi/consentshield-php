-- Three cron jobs from migration 20260413000014 point at Edge Functions
-- that were never built. They will be re-scheduled when the corresponding
-- features ship under their own ADRs:
--
--   stuck-buffer-detection-hourly  → check-stuck-buffers    (Phase 3 ops)
--   security-scan-nightly          → run-security-scans     (ADR-0015)
--   retention-check-daily          → check-retention-rules  (Phase 3)
--
-- Until those functions exist, the cron entries are noise — with `pg_net`
-- now enabled and the JWT-verify issue resolved per-function, they would
-- return 404 on every fire. Drop them so the cron.job_run_details log is
-- not cluttered with expected failures.

do $$
begin
  perform cron.unschedule('stuck-buffer-detection-hourly');
exception when others then null;
end $$;

do $$
begin
  perform cron.unschedule('security-scan-nightly');
exception when others then null;
end $$;

do $$
begin
  perform cron.unschedule('retention-check-daily');
exception when others then null;
end $$;
