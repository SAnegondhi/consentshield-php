-- ADR-1003 Sprint 1.3 — zero-storage consent_artefact_index TTL writes.
--
-- Sprint 1.2 ships the bridge that uploads a zero_storage org's
-- consent event to customer R2. R2 IS the durability layer. But
-- /v1/consent/verify needs to answer "did this org consent to
-- purpose X" without reaching into customer storage on every call.
--
-- This sprint extends the bridge orchestrator (Next.js,
-- app/src/lib/delivery/zero-storage-bridge.ts) to INSERT one
-- public.consent_artefact_index row per accepted purpose, with a
-- short TTL (24h) — long enough for the typical session-revocation
-- window, short enough to keep the table sized for hot-path lookup.
-- The R2 upload is the load-bearing guarantee; the index INSERT is
-- best-effort (try/catch + ON CONFLICT DO NOTHING) so a transient
-- index failure never blocks the event from reaching customer
-- storage.
--
-- Sprint 3.1 (deferred) will add the refresh-from-R2 read path so
-- expired index rows can be rebuilt on demand from the canonical R2
-- copy. Until 3.1 lands, after 24h a zero_storage event is queryable
-- only by reading customer R2 directly.
--
-- This migration grants INSERT to cs_orchestrator (which currently
-- has SELECT + UPDATE on a few specific columns from
-- 20260413000010_scoped_roles.sql and
-- 20260701000001_consent_artefact_index_identifier.sql).
--
-- ═══════════════════════════════════════════════════════════
-- 1/1 · grant insert on public.consent_artefact_index to cs_orchestrator
-- ═══════════════════════════════════════════════════════════

grant insert on public.consent_artefact_index to cs_orchestrator;

comment on table public.consent_artefact_index is
  'Active-consent validity cache — operational state only, no '
  'personal data unless the caller supplied identifier_hash. '
  'Standard / Insulated orgs: rows written by rpc_consent_record + '
  'process-consent-event. Zero-storage orgs (ADR-1003 Sprint 1.3): '
  'rows written by app/src/lib/delivery/zero-storage-bridge.ts after '
  'successful R2 upload, with deterministic artefact_id '
  '"zs-<event_fingerprint>-<purpose_code>" and 24h expires_at. '
  'cs_orchestrator: SELECT + INSERT + UPDATE (validity_state, '
  'revoked_at, revocation_record_id). cs_delivery: SELECT + DELETE.';
