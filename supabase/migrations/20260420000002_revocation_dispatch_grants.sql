-- ADR-0022 Sprint 1.3 — cs_orchestrator grants for process-artefact-revocation.
--
-- The Edge Function needs SELECT on artefact_revocations (to fetch the
-- row being dispatched) and UPDATE on the new dispatched_at column
-- (to mark dispatch complete). These grants were not part of ADR-0020's
-- 20260418000005_depa_artefact_revocations.sql (which only granted
-- INSERT for user-initiated revocations via the customer app).

grant select on artefact_revocations to cs_orchestrator;
grant update (dispatched_at) on artefact_revocations to cs_orchestrator;
