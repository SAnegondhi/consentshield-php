-- N-S1 fix from docs/reviews/2026-04-16-phase2-completion-review.md.
--
-- Operational observability table for Cloudflare Worker → Supabase write
-- failures. The Worker logs to Cloudflare console today; nothing wakes
-- Sentry, and operators can't see ingestion breakage from the dashboard.
--
-- Design choice: this is an OPERATIONAL table, not a buffer table.
--   * No `delivered_at` — these rows are not delivered to customer storage.
--   * 7-day retention via cleanup cron.
--   * Org-scoped read for dashboard surface; cs_worker writes only.
--   * Append-only for `authenticated` (REVOKE update/delete).

create table worker_errors (
  id              uuid primary key default gen_random_uuid(),
  org_id          uuid not null,
  property_id     uuid,
  endpoint        text not null,
  status_code     integer,
  upstream_error  text,
  created_at      timestamptz not null default now()
);

create index idx_worker_errors_org_time on worker_errors (org_id, created_at desc);

alter table worker_errors enable row level security;

create policy "org_read_worker_errors"
  on worker_errors for select
  using (org_id = current_org_id());

revoke update, delete on worker_errors from authenticated;

-- cs_worker INSERTs failure rows. cs_orchestrator may read them for
-- future ops dashboards / alerting. cs_worker has no BYPASSRLS by design,
-- but consent_events / tracker_observations work the same way: RLS is
-- enabled with only a SELECT policy, and INSERT succeeds via the grant.
-- Mirror that pattern exactly.
grant insert on worker_errors to cs_worker;
grant select on worker_errors to cs_orchestrator;

-- 7-day retention cleanup. SQL-only cron (no HTTP), runs at 03:15 UTC
-- (08:45 IST) — clear of all existing cron slots.
do $$
begin
  perform cron.unschedule('worker-errors-cleanup-daily');
exception when others then null;
end $$;

select cron.schedule(
  'worker-errors-cleanup-daily',
  '15 3 * * *',
  $$delete from worker_errors where created_at < now() - interval '7 days'$$
);
