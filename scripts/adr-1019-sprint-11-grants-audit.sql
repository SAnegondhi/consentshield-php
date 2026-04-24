-- ADR-1019 Sprint 1.1 — cs_delivery grants audit.
--
-- Read-only SQL. Run against dev to confirm cs_delivery has the grants
-- ADR-1019's delivery orchestrator expects. Any EXTRA row in the result is
-- fine (defence in depth); any MISSING row must be fixed with a migration
-- before the orchestrator route goes live.
--
-- Expected (minimum):
--   * SELECT on: delivery_buffer, consent_events, tracker_observations,
--     audit_log, processing_log, rights_request_events, deletion_receipts,
--     withdrawal_verifications, security_scans, consent_probe_runs,
--     export_configurations.
--   * UPDATE (column: delivered_at) on all 10 buffer tables above.
--   * DELETE on all 10 buffer tables.
--   * EXECUTE on public.decrypt_secret(bytea, text).
--
-- Usage: psql "$SUPABASE_DATABASE_URL" -f scripts/adr-1019-sprint-11-grants-audit.sql
-- or: bunx supabase db remote psql -f scripts/adr-1019-sprint-11-grants-audit.sql

\echo '================================================================'
\echo 'ADR-1019 Sprint 1.1 — cs_delivery grants audit'
\echo '================================================================'

\echo ''
\echo '--- SELECT grants on buffer tables + export_configurations ---'
select table_name, privilege_type
from information_schema.role_table_grants
where grantee = 'cs_delivery'
  and privilege_type = 'SELECT'
  and table_schema = 'public'
  and table_name in (
    'delivery_buffer', 'consent_events', 'tracker_observations',
    'audit_log', 'processing_log', 'rights_request_events',
    'deletion_receipts', 'withdrawal_verifications', 'security_scans',
    'consent_probe_runs', 'export_configurations'
  )
order by table_name;

\echo ''
\echo '--- UPDATE(delivered_at) grants on buffer tables ---'
select table_name, column_name, privilege_type
from information_schema.role_column_grants
where grantee = 'cs_delivery'
  and privilege_type = 'UPDATE'
  and column_name = 'delivered_at'
  and table_schema = 'public'
order by table_name;

\echo ''
\echo '--- DELETE grants on buffer tables ---'
select table_name, privilege_type
from information_schema.role_table_grants
where grantee = 'cs_delivery'
  and privilege_type = 'DELETE'
  and table_schema = 'public'
  and table_name in (
    'delivery_buffer', 'consent_events', 'tracker_observations',
    'audit_log', 'processing_log', 'rights_request_events',
    'deletion_receipts', 'withdrawal_verifications', 'security_scans',
    'consent_probe_runs'
  )
order by table_name;

\echo ''
\echo '--- EXECUTE grants on decrypt helpers ---'
select routine_name, privilege_type
from information_schema.role_routine_grants
where grantee = 'cs_delivery'
  and routine_schema = 'public'
  and routine_name in ('decrypt_secret', 'current_uid')
order by routine_name;

\echo ''
\echo '--- Role attributes (login + bypassrls must both be true) ---'
select rolname, rolcanlogin, rolbypassrls
from pg_roles
where rolname = 'cs_delivery';

\echo ''
\echo '================================================================'
\echo 'Done. Expected: 11 SELECT rows, 10 UPDATE rows, 10 DELETE rows,'
\echo '1 EXECUTE row (decrypt_secret), login=t, bypassrls=t.'
\echo '================================================================'
