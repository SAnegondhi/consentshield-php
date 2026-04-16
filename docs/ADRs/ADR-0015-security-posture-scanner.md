# ADR-0015: Security Posture Scanner

**Status:** Completed
**Date proposed:** 2026-04-16
**Date completed:** 2026-04-16
**Superseded by:** —

---

## Context

The `security_scans` table exists with INSERT granted to
`cs_orchestrator`, and the Phase-1 scaffolding scheduled a nightly
`run-security-scans` Edge Function in pg_cron. **The function was
never written.** In Sprint 4 (ADR-0011 cleanup), that orphan cron
entry was unscheduled alongside the other unbuilt-function jobs.

This ADR builds the function and re-schedules the cron.

## Decision

Implement a header-based posture scan — zero browser automation, zero
dependencies, pure `fetch` + response-header inspection. Each nightly
run scans every `web_properties` row across all orgs and inserts one
row per finding into `security_scans`.

### Checks (v1)

| signal_key                  | severity | description |
|-----------------------------|----------|-------------|
| `tls_unreachable`           | critical | fetch errored — site is unreachable over HTTPS |
| `tls_invalid`               | high     | TLS handshake failed (certificate invalid / expired / hostname mismatch) |
| `missing_hsts`              | medium   | no `Strict-Transport-Security` response header |
| `weak_hsts`                 | low      | HSTS present but `max-age` < 180 days |
| `missing_csp`               | medium   | no `Content-Security-Policy` or `Content-Security-Policy-Report-Only` |
| `missing_xfo`               | low      | no `X-Frame-Options` (and CSP doesn't supply `frame-ancestors`) |
| `missing_referrer_policy`   | info     | no `Referrer-Policy` header |
| `all_clean`                 | info     | all of the above pass — one row per scan for trend data |

Deno `fetch` does its own TLS validation; a certificate failure
surfaces as a network error which becomes `tls_unreachable`. We don't
separately verify cert expiry (would need lower-level TLS access that
Supabase Edge Runtime doesn't expose cleanly). A `tls_invalid` finding
is emitted when the TypeError specifically mentions certificate
validation. Good-enough v1 — if we need true expiry-day-counting later
it goes into a follow-up ADR.

### Scheduling

Re-register `security-scan-nightly` cron to `30 20 * * *` (02:00 IST =
20:30 UTC-day-before). Deployed with `--no-verify-jwt` per the
platform-gotchas memory.

## Consequences

- Writes to `security_scans` (buffer table). The normal sweep cycle
  will delete delivered rows, but the dashboard reads the latest per
  property before delivery happens (immediate-read use case, matches
  ADR-0004 rights_requests pattern).
- Scan fires per property for every org every 24 h. Concurrency via
  `Promise.all` with a small in-fn batch size to avoid Edge Function
  CPU limits.
- False-positive surface: a customer site that returns different
  headers to the Supabase Edge IP vs. end users will look worse than
  reality. Acceptable v1; can upgrade to a multi-region scan later.

---

## Implementation Plan

### Phase 1: Function + cron + minimal dashboard section

#### Sprint 1.1: Write, deploy, verify, dashboard

**Estimated effort:** ~6–8 h
**Deliverables:**
- [x] Edge Function `supabase/functions/run-security-scans/index.ts` — Deno, ~200 LoC, zero external deps beyond supabase-js.
- [x] Migration re-scheduling the nightly cron.
- [x] Deploy with `--no-verify-jwt`, set `MASTER_ENCRYPTION_KEY` etc. if needed (none needed for this function — no decryption).
- [x] Live smoke: manual invocation inserts N rows into `security_scans` where N = number of web_properties, confirms findings match expectations against the five demo sites (all Vercel-hosted → should show HSTS / CSP deficits if any).
- [x] `/dashboard/enforcement` — extend the existing page with a "Security Posture" section listing the most-recent scan per property with severity colour-coding.
- [x] ADR, CHANGELOG-schema, CHANGELOG-edge-functions, CHANGELOG-dashboard, STATUS.md, ADR-index.

**Testing plan:**
- [x] `bun run lint` + `bun run build` + `bun run test` — clean.
- [x] Manual `net.http_post` invocation returns 200; rows land in
  `security_scans` for the demo org.

**Status:** `[x] complete`

---

## Architecture Changes

`docs/architecture/consentshield-definitive-architecture.md` already
describes `security_scans` as a buffer table with a delivery pipeline.
This ADR does not change that — it fills in the producer.

---

## Test Results

### Sprint 1.1 — 2026-04-16

```
Test: Live invocation of run-security-scans
Method: select net.http_post(...) with the vault orchestrator key
Expected: 200 OK, findings per property inserted into security_scans
Actual: 200 OK, {"ok":true,"at":"2026-04-16T04:28:04Z","scanned":6,"findings":18,"violations":12}
Result: PASS
```

```
Test: Findings shape in DB
Method: SELECT signal_key, severity, count(*) FROM security_scans WHERE scanned_at > now() - '2 min' GROUP BY
Expected: Distribution across missing_* signals per property
Actual:
  missing_referrer_policy | info   | 6
  missing_xfo             | low    | 6
  missing_csp             | medium | 6
  (HSTS present on all 6 — Vercel ships it by default)
Result: PASS — scanner differentiates findings correctly
```

```
Test: Dashboard rendering + CI
Method: bun run lint && bun run test && bun run build
Expected: 81/81 tests, clean lint, clean build
Actual: 81/81 pass; lint clean; build clean
Result: PASS
```

---

## Changelog References

- CHANGELOG-schema.md — 2026-04-16 — ADR-0015 cron
- CHANGELOG-edge-functions.md — 2026-04-16 — run-security-scans
- CHANGELOG-dashboard.md — 2026-04-16 — security-posture section
