-- ADR-1004 Sprint 1.4 — idempotency guard for retention_suppressions.
--
-- The process-artefact-revocation Edge Function may be re-invoked by the
-- safety-net cron after a partial failure. Without a dedupe key, each
-- re-run would insert a duplicate suppression row per (revocation,
-- exemption). Partial UNIQUE index on (revocation_id, exemption_id) where
-- revocation_id IS NOT NULL lets the Edge Function use ON CONFLICT DO
-- NOTHING. The NULL carve-out keeps the door open for erasure-request
-- driven suppressions (ADR-1005 integration) that do not originate from
-- an artefact_revocations row.

create unique index if not exists retention_suppressions_revocation_exemption_uq
  on public.retention_suppressions (revocation_id, exemption_id)
  where revocation_id is not null;
