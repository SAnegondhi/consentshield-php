-- ADR-1025 Phase 2 Sprint 2.1 — cs_orchestrator grants for
-- public.export_configurations + public.organisations.encryption_salt read.
--
-- The Next.js /api/internal/provision-storage route runs as cs_orchestrator
-- (via csOrchestrator() direct-Postgres) and needs:
--   · SELECT on export_configurations        — idempotency check ("already_provisioned")
--   · INSERT + UPDATE on export_configurations — the UPSERT after verify
--   · SELECT on organisations                 — encryption_salt lookup for key derivation
--
-- cs_orchestrator already has (from earlier migrations):
--   · EXECUTE on public.encrypt_secret
--   · INSERT on public.export_verification_failures  (20260804000035)
--
-- No RLS bypass needed — cs_orchestrator uses bypassrls globally. These
-- grants just satisfy the SQL-level privilege check.

grant select, insert, update on public.export_configurations to cs_orchestrator;
grant select on public.organisations to cs_orchestrator;

-- No DELETE grant — ADR-1025's data-lifecycle model never deletes
-- export_configurations rows from application code. Admin operators can
-- delete via the service-role migration path if a customer leaves.

-- Verification (after `bunx supabase db push`):
--   select table_name, privilege_type
--     from information_schema.role_table_grants
--    where grantee = 'cs_orchestrator'
--      and table_schema = 'public'
--      and table_name   in ('export_configurations', 'organisations')
--    order by table_name, privilege_type;
--
--   Expected rows:
--     export_configurations | INSERT
--     export_configurations | SELECT
--     export_configurations | UPDATE
--     organisations         | SELECT
