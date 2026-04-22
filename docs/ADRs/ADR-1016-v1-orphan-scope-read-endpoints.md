# ADR-1016: v1 API — close the orphan `read:audit`, `read:security`, `read:score` scopes

**Status:** Completed
**Date proposed:** 2026-04-22
**Date completed:** 2026-04-22
**Depends on:** ADR-1009 (cs_api role), ADR-1012 (day-1 DX gap fixes — same shape)
**Related gaps:** Tier 3 + Tier 4 items from `docs/reviews/2026-04-21-v1-api-gap-audit.md`

---

## Context

`public.api_keys_scopes_valid` enumerates 13 scopes; ADR-1012 shipped 11 of them. The audit (`docs/reviews/2026-04-21-v1-api-gap-audit.md` §2/§4) flagged three orphan scopes whose endpoints were recommended as "Tier 3 — absorb into ADR-1008" and "Tier 4 — absorb into ADR-1003":

- `read:audit` — `GET /v1/audit` (audit timeline; needed for SOC 2 / SIEM ingestion)
- `read:security` — `GET /v1/security/scans` (nightly security posture findings)
- `read:score` — `GET /v1/score` (DEPA compliance score + 4 dimensions)

Neither ADR-1008 nor ADR-1003 actually added those endpoints to their sprint lists. They remained orphan scopes — keys can be issued with them but nothing is callable, which is the exact "awkward surface" ADR-1012 was written to close.

Every endpoint here is a thin SECURITY DEFINER RPC over an existing table, fenced by `assert_api_key_binding(p_key_id, p_org_id)` and granted to `cs_api` — verbatim the ADR-1012 pattern. No new schema. No dashboard work. No architectural novelty. This ADR finishes what ADR-1012 started: the self-describing surface on top of tables the platform already maintains.

Scope of the three endpoints on the *buffer*-lifecycle tables is narrower than a full historical audit:

- `audit_log` and `security_scans` are *transient buffers* (Rule 1). Rows are delivered to customer R2/S3 and deleted within ~5 minutes. The canonical historical audit is the customer's own storage. The v1 endpoints therefore return *recent* events — useful for real-time ops dashboards and SIEM polling every few minutes. This limitation is documented in each OpenAPI path.
- `depa_compliance_metrics` is a persistent single-row cache (one row per org, UPSERTed nightly by ADR-0025's `refresh_depa_compliance_metrics()` cron). Not a buffer, so no retention caveat.

## Decision

Ship three GET endpoints in one ADR, one sprint per endpoint.

| Verb | Path | Scope | RPC |
|---|---|---|---|
| GET | `/v1/audit` | `read:audit` | `rpc_audit_log_list(p_key_id, p_org_id, ...)` (new) |
| GET | `/v1/security/scans` | `read:security` | `rpc_security_scans_list(p_key_id, p_org_id, ...)` (new) |
| GET | `/v1/score` | `read:score` | `rpc_depa_score_self(p_key_id, p_org_id)` (new) |

Each RPC is `SECURITY DEFINER`, fenced by `assert_api_key_binding` at the top, and `GRANT EXECUTE TO cs_api`. Route handlers follow the ADR-1012 scope-gate / org-gate / error-mapping pattern. OpenAPI gets 3 new paths + request/response examples, matching the Sprint 2.1 shape.

### Envelope choices

- List endpoints (`/v1/audit`, `/v1/security/scans`) — keyset cursor format matching `rpc_event_list` / `rpc_deletion_receipts_list`: base64(`{c: created_at, i: id}`). `limit` 1..200, default 50. Most-recent-first.
- Score endpoint — single envelope `{ total_score, coverage_score, expiry_score, freshness_score, revocation_score, computed_at, max_score: 20 }`. Returns `null`s for a fresh org with no metrics row yet (not 404) so clients can special-case cleanly.

### Deliberately excluded from response envelopes

- `audit_log.ip_address` — PII. Caller can correlate via `actor_email` if needed.
- `audit_log.payload` — keep it (it's the event-specific detail, already org-scoped per row).
- `security_scans.details` — keep it (remediation guidance is the point).
- `depa_compliance_metrics.*_score_delta` (if any future fields are added) — not yet in the table; N/A.

## Consequences

- 3 of 7 orphan scopes close. The remaining 4 (`read:rights` + `write:rights` closed by ADR-1005 Sprint 5.1 yesterday; `read:tracker` + `read:probes` pending) will fall later as their owning ADRs ship.
- `cs_api` EXECUTE surface grows from 19 to 22 RPCs (ADR-1012: +5 → ADR-1005: +2 → ADR-1016: +3).
- Zero schema changes. Zero new test patterns.

---

## Implementation Plan

### Sprint 1.1 — `GET /v1/audit` (read:audit)

**Estimated effort:** 1h

**Deliverables:**
- [ ] Migration: `rpc_audit_log_list(p_key_id, p_org_id, p_event_type, p_entity_type, p_created_after, p_created_before, p_cursor, p_limit)` returns jsonb envelope `{ items, next_cursor }`. Fenced. Returns `id, actor_id, actor_email, event_type, entity_type, entity_id, payload, created_at` — no `ip_address` (PII).
- [ ] Grant EXECUTE to cs_api.
- [ ] Route handler `/app/src/app/api/v1/audit/route.ts`, lib helper `/app/src/lib/api/audit.ts`.
- [ ] OpenAPI path + schemas with examples.
- [ ] Integration test `tests/integration/audit-api.test.ts`.

**Testing plan:**
- [ ] Happy path returns recent audit_log rows for the caller's org.
- [ ] Cross-org fence — otherOrg-bound key cannot list org rows.
- [ ] Scope gate — key without `read:audit` gets 403.
- [ ] Filter by event_type returns only matching rows.
- [ ] `ip_address` never appears in the response (safe-subset assertion).
- [ ] Bad cursor → 422.

**Status:** `[x] complete` — 2026-04-22

### Sprint 1.2 — `GET /v1/security/scans` (read:security)

**Estimated effort:** 1h

**Deliverables:**
- [ ] Migration: `rpc_security_scans_list(p_key_id, p_org_id, p_property_id, p_severity, p_signal_key, p_scanned_after, p_scanned_before, p_cursor, p_limit)` returns jsonb envelope. Fenced.
- [ ] Grant EXECUTE to cs_api.
- [ ] Route handler `/app/src/app/api/v1/security/scans/route.ts`, lib helper `/app/src/lib/api/security.ts`.
- [ ] OpenAPI path + schemas with examples.
- [ ] Integration test.

**Testing plan:**
- [ ] Happy path; cross-org fence; scope gate; filter by severity + property_id; bad cursor.

**Status:** `[x] complete` — 2026-04-22

### Sprint 1.3 — `GET /v1/score` (read:score)

**Estimated effort:** 30min

**Deliverables:**
- [ ] Migration: `rpc_depa_score_self(p_key_id, p_org_id)` returns jsonb `{ total_score, coverage_score, expiry_score, freshness_score, revocation_score, computed_at, max_score: 20 }` or all-null envelope if no row. Fenced.
- [ ] Grant EXECUTE to cs_api.
- [ ] Route handler `/app/src/app/api/v1/score/route.ts`, lib helper `/app/src/lib/api/score.ts`.
- [ ] OpenAPI path + schema with example.
- [ ] Integration test.

**Testing plan:**
- [ ] Returns envelope after the nightly cron runs; returns null-envelope for an org with no metrics yet; cross-org fence; scope gate.

**Status:** `[x] complete` — 2026-04-22

---

## Architecture Changes

None. All additive.

The CLAUDE.md Rule 5 RPC count line and the architecture doc §5.4 leak-surface paragraph get bumped from "19" to "22" at ADR close-out.

---

## Test Results

- Sprint 1.1 — 9/9 `tests/integration/audit-api.test.ts` PASS.
- Sprint 1.2 — 9/9 `tests/integration/security-scans-api.test.ts` PASS.
- Sprint 1.3 — 3/3 `tests/integration/score-api.test.ts` PASS.
- Full suite — 189/189 PASS (was 168 pre-ADR-1016).
- `bunx @redocly/cli lint app/public/openapi.yaml` — 0 errors, 1 pre-existing cosmetic warning.

---

## Changelog References

- `CHANGELOG-schema.md` — Sprints 1.1 / 1.2 / 1.3 migrations
- `CHANGELOG-api.md` — Sprints 1.1 / 1.2 / 1.3 route handlers + lib helpers
- `CHANGELOG-docs.md` — ADR-1016 close-out + Rule 5 / §5.4 RPC count bump
