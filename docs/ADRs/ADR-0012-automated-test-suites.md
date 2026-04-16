# ADR-0012: Automated Test Suites for High-Risk Paths

**Status:** In Progress (Sprint 1 complete; Sprints 2 + 3 deferred)
**Date proposed:** 2026-04-16
**Date completed:** —
**Superseded by:** —

---

## Context

The RLS isolation suite (`tests/rls/isolation.test.ts`, 39 tests) is
the only automated check that runs on every build. Three classes of
regression have no coverage today:

1. **SLA / breach deadlines.** `set_rights_request_sla` trigger computes
   `new.sla_deadline = new.created_at + interval '30 days'`; the SLA-reminder
   Edge Function buckets requests into 7-day / 1-day / overdue windows by
   date arithmetic. An off-by-one in either place silently mis-reports
   every rights request. No test catches this.
2. **URL-path tenant crossing.** The authenticated API routes under
   `/api/orgs/[orgId]/...` extract `orgId` from the URL and issue
   `.eq('org_id', orgId)`. RLS also filters by `current_org_id()` from
   the JWT. Both predicates must hold, so cross-org manipulation is
   impossible today — but no test asserts the invariant, so a future
   policy edit could loosen it without anyone noticing.
3. **Worker + buffer pipeline end-to-end.** The Worker's HMAC/origin
   validation and the delivery Edge Function's mark-delivered-then-delete
   flow have no integration tests. (Scope for a later sprint —
   Miniflare + a delivery-pipeline scenario suite.)

Finding **S-11** from the 2026-04-14 codebase review flagged the
missing tests. Finding **S-2** (URL-path cross-org test) was folded
into this ADR during the 2026-04-15 triage.

## Decision

Add a phased test-coverage ADR. Each sprint lands a self-contained
test file under `tests/` and runs on every build via `bun run test`.

- **Phase 1 Sprint 1:** SLA-timer + URL-path RLS. No new dependencies.
  Uses the existing test helpers (`tests/rls/helpers.ts`) and runs
  against the live dev Supabase.
- **Phase 1 Sprint 2 (deferred):** Worker Miniflare tests. Installs
  `miniflare` dev-only and stands up a test harness for HMAC, origin
  validation, and fail-fast Turnstile.
- **Phase 1 Sprint 3 (deferred):** Buffer-pipeline integration. Seeds
  consent_events, invokes `deliver-consent-events`, asserts
  mark-delivered + delete atomicity.

## Consequences

- Slightly longer CI: +15–20 s per added test file (live Supabase
  round trips).
- Tests hit the dev DB. Each suite uses `createTestOrg` / `cleanupTestOrg`
  so no shared state lingers.
- Property-style coverage for date arithmetic is hand-rolled — no
  `fast-check` dep (rule #14).

---

## Implementation Plan

### Phase 1 Sprint 1: SLA-timer + URL-path RLS

**Estimated effort:** ~3 h
**Deliverables:**
- [x] `tests/workflows/sla-timer.test.ts` — exercises the `set_rights_request_sla` Postgres trigger across boundary dates (normal, year-crossing, leap-year Feb, non-leap Feb, IST-anchored offset), plus a property sweep over random dates in `[2026, 2030]`.
- [x] `tests/rls/url-path.test.ts` — authenticated Org A client issues cross-org SELECT and UPDATE targeting Org B rights_requests; both must return zero rows. Covers the S-2 finding.
- [x] ADR-0012, ADR-index, `CHANGELOG-schema.md`, `STATUS.md` updated.

**Testing plan:**
- [x] `bun run test` — suite grows from 43 to ≥ 55, all green.
- [x] `bun run lint` — clean.
- [x] `bun run build` — clean.

**Status:** `[x] complete`

### Phase 1 Sprint 2: Worker Miniflare tests (deferred)
### Phase 1 Sprint 3: Buffer-pipeline integration (deferred)

---

## Architecture Changes

No architecture doc changes. The trigger and the Edge Function are
unchanged; this ADR adds coverage only.

---

## Test Results

### Phase 1 Sprint 1 — 2026-04-16

```
Test: SLA-timer trigger — 6 boundary cases + 20-date property sweep
Method: Insert rights_request rows with controlled created_at; read back sla_deadline; compare epoch milliseconds
Expected: sla_deadline = created_at + 30 calendar days, every case
Actual: all 7 tests pass; zero mismatches in the 20-date sweep across 2026–2030
Result: PASS
```

```
Test: URL-path RLS (S-2) — 5 cases
Method: Signed-in Org A client issues SELECT, UPDATE, and UPDATE-without-org-predicate targeting Org B's rights_request; admin re-reads Org B row
Expected: zero rows returned / affected; Org B row unchanged
Actual: all 5 tests pass; Org B row still status='new', closure_notes=null
Result: PASS
```

```
Test: Full suite + build + lint
Method: bun run test && bun run lint && bun run build
Expected: 43 → 55 tests (+ 4 files → 4 files, +2 files), zero lint output, clean build
Actual: 55 / 55 PASS; lint clean; 25 routes build clean
Result: PASS
```

---

## Changelog References

- CHANGELOG-schema.md — 2026-04-16 — ADR-0012 Sprint 1 (schema-trigger coverage)
