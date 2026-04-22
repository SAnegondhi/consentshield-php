# E2E-3.2-worker-consent-event-origin-mismatch: unsigned + foreign-Origin is rejected at step 1

**ADR:** ADR-1014 (Sprint 3.2 — Banner → Worker HMAC → buffer → delivery → R2)
**Sprint:** Phase 3, Sprint 3.2 (partial — origin-mismatch negative only; delivery + R2 hash match blocked on missing infra)
**Companion positive:** `worker-consent-event.spec.ts` (Sprint 1.3 — HMAC path happy; serves as Sprint 3.2's "valid event → buffer row" positive too).
**Companion negative (HMAC path):** `worker-consent-event-tampered.spec.ts` (Sprint 1.3 — HMAC signature flipped).
**This spec:** the missing paired negative on the origin-only path.
**Category:** @pipeline @worker

---

## 1. Intent

Proves the Worker's step-1 origin validation rejects browser-style unsigned POSTs whose Origin header is either (a) present but not in the property's `allowed_origins`, or (b) absent entirely. Both variants must 403 and write zero buffer rows.

Without this guard, a malicious script on any domain could spoof consent events into a victim property's pipeline — the core tenant-isolation violation Rule 8 (Validate Origin on Worker endpoints) exists to prevent.

## 2. Setup

- `WORKER_URL` reachable (same as the Sprint 1.3 tests).
- `.env.e2e` has the ecommerce fixture seeded by `scripts/e2e-bootstrap.ts`.
- `SUPABASE_SERVICE_ROLE_KEY` set for the buffer-table count query.
- The test uses `ecommerce.properties[2]` (Sandbox probe) — its fixture `allowed_origins` list is `['http://localhost:4001']` only, so any other hostname or the absence of Origin is guaranteed rejected.

## 3. Invariants

- **Property isolation:** positive uses `properties[0]`, HMAC-tampered negative uses `properties[1]`, origin-mismatch negative uses `properties[2]`. All three can run in parallel with no count-assertion collisions under clock skew.
- **Unsigned path:** the envelope has no `signature` / `timestamp` fields. The Worker's step 2 accepts only HMAC-verified OR valid-Origin paths; with Origin rejected at step 1 (or a missing Origin triggering the later "Origin required" guard), the request is denied before any INSERT.
- **Zero-row proof:** after a 1-second settle, `countConsentEventsSince(properties[2].id, cutoffIso)` MUST be 0. A regression where the Worker writes before validating would flip this assertion red.

## 4. Expected proofs

### Sub-test A — foreign Origin header

1. POST `${WORKER_URL}/v1/events` with `Origin: https://attacker.example.invalid` (not in the property's allowed_origins) and no HMAC → **403**.
2. Response body contains the rejected origin hostname and the substring `not in the allowed origins` (matches `worker/src/origin.ts:rejectOrigin`).
3. Count delta since `cutoffIso` = 0.

### Sub-test B — no Origin header

1. POST same envelope with no `Origin` / `Referer` header → **403**.
2. Response body contains `Origin required` (matches `worker/src/events.ts:145` "Origin required for unsigned events").
3. Count delta since `cutoffIso` = 0.

## 5. Pair-with-positive

**Positive pair:** `worker-consent-event.spec.ts` (Sprint 1.3). Same envelope structure, different path (HMAC-signed server-to-server), expected to succeed. Together they cover: (a) legitimate traffic accepted, (b) HMAC-tampered rejected, (c) foreign-origin rejected, (d) no-origin rejected.

## 6. Why this spec is not a fake positive

Three independent surfaces are asserted:

1. **HTTP response** — a 403 status and a specific body string.
2. **The Worker's origin-validation code path** — the response body shape only reaches the client if `validateOrigin()` returns `rejected` AND `rejectOrigin()` formats the body. A Worker regression that somehow returned 403 from a different code path would fail the body-substring check.
3. **The DB** — zero rows for the property since the test's cutoff stamp. A Worker that wrote before validating would satisfy #1 + #2 but fail #3.

The test uses `properties[2]` specifically because its allow-list is `['http://localhost:4001']` — that leaves the Origin `https://attacker.example.invalid` unambiguously outside the allowed set regardless of where the test runner executes. Other properties have broader allow-lists that would be harder to write a "definitely foreign" Origin against.

## 7. Evidence outputs

- `trace-id.txt` (per test, via the shared `traceId` fixture)
- `origin-mismatch-response.json` — status, headers, body-preview for sub-test A
- `origin-missing-response.json` — same for sub-test B
- Playwright trace on failure

## 8. Sprint 3.2 scope — what this spec does NOT cover

The parent Sprint 3.2 also requires:

- **Delivery + R2 object hash match** — needs the `deliver-consent-events` Edge Function (referenced throughout `docs/architecture` + older ADRs but not yet shipped in `supabase/functions/`).
- **Trace-ID assertion at every stage** — needs a `trace_id` column on `consent_events` and Worker-side trace-id header propagation (neither present as of 2026-04-22).

Both are documented as Sprint 3.2 open items on ADR-1014; the origin-mismatch paired negative is the complete, shippable slice of Sprint 3.2 today.
