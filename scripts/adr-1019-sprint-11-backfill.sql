-- ADR-1019 Sprint 1.1 — pre-delivery backfill.
--
-- Quarantines every pre-existing undelivered row in delivery_buffer so the
-- first real delivery run does not attempt to re-upload ancient test
-- fixtures. Rows are marked with attempt_count = 10 (matching the manual-
-- review threshold from Sprint 2.3) and delivery_error =
-- 'pre-deliver-consent-events'; an operator decides keep-or-delete later.
--
-- Idempotent. Skips rows that already have a delivery_error.
--
-- Usage: psql "$SUPABASE_DATABASE_URL" -f scripts/adr-1019-sprint-11-backfill.sql

\echo '================================================================'
\echo 'ADR-1019 Sprint 1.1 — pre-delivery backfill'
\echo '================================================================'

begin;

\echo ''
\echo '--- Row count BEFORE backfill ---'
select
  count(*) filter (where delivered_at is null)         as undelivered_total,
  count(*) filter (where delivered_at is null and delivery_error is null)
                                                       as undelivered_clean,
  count(*) filter (where delivered_at is null and delivery_error is not null)
                                                       as undelivered_errored,
  min(created_at) filter (where delivered_at is null)  as oldest_undelivered
from delivery_buffer;

update delivery_buffer
set
  delivery_error = 'pre-deliver-consent-events',
  attempt_count  = greatest(attempt_count, 10),
  last_attempted_at = now()
where delivered_at is null
  and delivery_error is null
  and created_at < now() - interval '1 hour';

\echo ''
\echo '--- Row count AFTER backfill ---'
select
  count(*) filter (where delivered_at is null)         as undelivered_total,
  count(*) filter (where delivery_error = 'pre-deliver-consent-events')
                                                       as quarantined,
  count(*) filter (where delivered_at is null and delivery_error is null)
                                                       as undelivered_clean_remaining
from delivery_buffer;

commit;

\echo ''
\echo '================================================================'
\echo 'Done. quarantined count is the number of rows that will surface'
\echo 'on the manual-review readiness flag once Sprint 2.3 lands.'
\echo '================================================================'
