-- ADR-0037 Sprint 1.2 — V2-D2 per-requestor artefact binding.
--
-- Adds a nullable session_fingerprint column on rights_requests so the
-- public rights-request submit route can persist the server-computed
-- fingerprint (sha256(userAgent + ipTruncated + orgId)) derived at
-- submit time. The Rights Centre detail page then matches active
-- consent_artefacts by (org_id, session_fingerprint) — same formula
-- used by the Cloudflare Worker at consent event ingestion time
-- (worker/src/events.ts:118), giving an exact match when the requestor
-- used the same browser and (truncated) network at consent time.
--
-- Existing rows stay NULL — the Rights Centre detail page falls back
-- to the org-wide informational impact preview when fingerprint is
-- NULL or matches zero artefacts.

alter table rights_requests
  add column if not exists session_fingerprint text;

create index if not exists idx_rights_requests_fingerprint
  on rights_requests (org_id, session_fingerprint)
  where session_fingerprint is not null;

comment on column rights_requests.session_fingerprint is
  'ADR-0037 V2-D2. sha256(userAgent + ipTruncated + org_id), computed '
  'server-side at /api/public/rights-request POST time using the same '
  'formula as worker/src/events.ts. Lets the Rights Centre detail page '
  'match active consent_artefacts owned by this requestor. NULL for '
  'pre-ADR-0037 rows and for submissions where derivation failed.';
