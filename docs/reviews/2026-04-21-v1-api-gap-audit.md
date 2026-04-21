# v1 API Gap Audit — 2026-04-21

**Scope.** The `/api/v1/*` public surface (Bearer-gated, cs_api-backed) as of commit `b8b94de`. Goal: identify missing operations from a consumer perspective before committing to ADR-1005's scope.

**Method.** Cross-referenced:
- OpenAPI spec (`app/public/openapi.yaml`, 953 lines, 10 paths).
- Actual route handlers (`app/src/app/api/v1/**/route.ts`).
- Scope allow-list in `public.api_keys_scopes_valid`.
- RPCs granted to `cs_api` (migrations `20260801000006..10`).

---

## 1. Surface inventory

### 1.1 Endpoints shipped (10 + 1 callback)

| Verb | Path | Scope | Status |
|---|---|---|---|
| GET | `/v1/_ping` | — | ✅ |
| GET | `/v1/consent/verify` | `read:consent` | ✅ |
| POST | `/v1/consent/verify/batch` | `read:consent` | ✅ |
| POST | `/v1/consent/record` | `write:consent` | ✅ |
| GET | `/v1/consent/artefacts` | `read:artefacts` | ✅ |
| GET | `/v1/consent/artefacts/{id}` | `read:artefacts` | ✅ |
| POST | `/v1/consent/artefacts/{id}/revoke` | `write:artefacts` | ✅ |
| GET | `/v1/consent/events` | `read:consent` | ✅ |
| POST | `/v1/deletion/trigger` | `write:deletion` | ✅ (retention_expired → 501) |
| GET | `/v1/deletion/receipts` | `read:deletion` | ✅ |
| POST | `/v1/deletion-receipts/{id}` | HMAC callback | ✅ (not in OpenAPI; outbound) |

### 1.2 Scopes declared but unshipped (5 scope pairs = 7 scopes)

Per `api_keys_scopes_valid` the allow-list has 13 scopes. Matched against shipped endpoints, **7 are orphan**:

| Scope | Endpoints shipped | Endpoints planned |
|---|---|---|
| `read:rights` | 0 | Rights submit, status, withdraw (ADR-1005) |
| `write:rights` | 0 | Rights submit, fulfilment update (ADR-1005) |
| `read:tracker` | 0 | Tracker observations list/detail |
| `read:audit` | 0 | Append-only audit trail export |
| `read:security` | 0 | Security posture scan results |
| `read:probes` | 0 | Consent probe runs + findings |
| `read:score` | 0 | DEPA compliance score timeseries |

Issuing keys with these scopes today succeeds but they unlock nothing. **Action:** either ship endpoints or strip from the allow-list. Recommend shipping — the scopes are forward-declared because the endpoints are coming.

### 1.3 Scope enforcement on shipped endpoints (sanity check)

Grepped `gateScopeOrProblem(` across all route files. Confirmed each endpoint enforces the scope claimed in OpenAPI. No drift.

---

## 2. DX gaps (customer integrating against v1)

These are the gaps a partner engineer hits on day 1 when wiring up an SDK.

### G1. No self-introspection for Bearer tokens

**What's missing:** `GET /v1/keys/self` → returns `{ key_id, account_id, org_id, scopes, rate_tier, created_at, last_rotated_at, expires_at }` for the bearer-presenting key.

**Why it matters:** SDK setup wizards, debugging scripts, and health checks need to know "what does this key authorise me to do?" without making speculative calls. `/v1/_ping` returns some of this (`org_id`, `account_id`, `scopes`, `rate_tier`) but as a health artefact, not a semantic introspection endpoint.

**Size:** ~1 hour. Trivial RPC over `api_keys` by key_id (context.key_id is already on the Bearer path).

### G2. No discovery of `purpose_code` / `property_id` values

**What's missing:**
- `GET /v1/purposes` → list the caller's org's `purpose_definitions`.
- `GET /v1/properties` → list the caller's org's `web_properties`.

**Why it matters:** Every single call to `/consent/verify` or `/consent/record` requires a valid `purpose_code` + `property_id`. Currently the only way to discover these is via the dashboard or the SDK caller's out-of-band knowledge. Partners integrating for the first time have to copy UUIDs out of the dashboard by hand.

**Size:** ~2 hours. Two SECURITY DEFINER RPCs + two route handlers. Very similar shape to the existing `listArtefacts` helper.

### G3. No usage / quota endpoint

**What's missing:** `GET /v1/usage` → `{ key_id, window: 'current_hour', used: <int>, limit: <int>, burst: <int>, rate_tier }` and/or `{ window: 'last_7d', total: <int>, by_route: {...}, p50_latency_ms, p95_latency_ms }`.

**Why it matters:** Callers can't see their consumption ahead of hitting a 429. `rpc_api_key_usage` RPC already exists (migration `20260601000001`) — just needs a route handler. The dashboard already shows a usage chart at `/dashboard/settings/api-keys/{id}/usage`; the public API version would be the same data.

**Size:** ~1 hour.

### G4. No plan-tier discovery

**What's missing:** `GET /v1/plans` → public description of available tiers (starter / growth / pro / enterprise) with per-hour limits + burst. Static content but useful for SDK install flows and checkout wizards.

**Why it matters:** Marginal. Any SDK that hard-codes tier limits is already using the static `TIER_LIMITS` map in `rate-limits.ts`. This is a "documentation as API" play.

**Size:** ~30 min. Reads `public.plans` via a SECURITY DEFINER function; cached.

---

## 3. Rights API — the biggest gap (ADR-1005 territory)

`read:rights` + `write:rights` scopes are declared but no endpoints exist. DPDP §11 defines 7 data-principal rights; the customer dashboard has full UI for them under `/dashboard/rights`. Making them available over the public API lets enterprise customers build their own rights portals / submit rights on behalf of their users / integrate with existing CRM.

Rights-request submission, status polling, evidence attachment, fulfilment update, consent withdrawal — these are the ADR-1005 core. Rough endpoint sketch:

| Verb | Path | Scope |
|---|---|---|
| POST | `/v1/rights/requests` | `write:rights` |
| GET | `/v1/rights/requests` | `read:rights` |
| GET | `/v1/rights/requests/{id}` | `read:rights` |
| POST | `/v1/rights/requests/{id}/events` | `write:rights` |
| POST | `/v1/rights/requests/{id}/evidence` | `write:rights` |
| POST | `/v1/rights/requests/{id}/close` | `write:rights` |

**Not for this audit to scope.** Belongs to ADR-1005 Phase 1.

---

## 4. Operational visibility endpoints (ADR-1005 / ADR-1008 territory)

### Tracker observations (`read:tracker`)

- `GET /v1/trackers` — list of trackers seen on a property in a time window (joined against `tracker_signatures`).
- `GET /v1/trackers/{signature_id}` — detail incl. category, risk, blocked status.

### Audit log (`read:audit`)

- `GET /v1/audit` — append-only sensitive-operation log (key issuance/rotation/revoke, property/banner config changes, rights-request outcomes). Filters by `event_type`, `entity_type`, date range. Needed for SOC 2 and internal SIEM ingestion.

### Security posture (`read:security`)

- `GET /v1/security/scans` — `run-security-scans` Edge Function results summarised per property. HSTS, CSP, cookie-secure posture, third-party origin inventory.

### Consent probes (`read:probes`)

- `GET /v1/probes` — historical runs of `run-consent-probes` per property.
- `GET /v1/probes/{id}` — detail: which trackers fired before consent, which after.

### DEPA score (`read:score`)

- `GET /v1/score` — compliance score over time from `depa_compliance_metrics`. One or two numbers + a breakdown.

All of these wrap existing tables — no new schema. Belong to ADR-1005 or can be split into their own ADRs (tracker + probes read-API could be a "monitoring surface" ADR).

---

## 5. Shape / consistency gaps in existing endpoints

### S1. Filter-param naming drift

- `GET /v1/consent/events` uses `created_after` / `created_before`.
- `GET /v1/deletion/receipts` uses `issued_after` / `issued_before`.
- `GET /v1/consent/artefacts` uses `expires_before` / `expires_after`.

These are semantically distinct (event `created_at` vs receipt issuance vs artefact expiry) — so the naming differences are arguably *correct*. But a partner using all three endpoints has to remember three naming conventions. Worth settling on a doc-level convention.

**Verdict:** leave as-is. Document the rule in OpenAPI description.

### S2. No idempotency hint in `/v1/deletion/trigger`

`/v1/consent/record` takes an optional `client_request_id` for idempotency. `/v1/deletion/trigger` does not. Re-triggering the same erasure is effectively idempotent at the artefact level (no active artefacts left → 0 revoked), but the caller gets a new `artefact_revocations` row each time. Not a bug but worth adding.

**Verdict:** minor; add `client_request_id` to deletion trigger later. Not tier-1.

### S3. Missing `HEAD` / `OPTIONS` verbs

Bearer-authed server-to-server API. No browser caller, no CORS preflight. Skip.

### S4. No mutation verbs on most resources

Artefacts are append-only by design (Rule 19). Events are append-only. Revocations are append-only. No `PUT` / `PATCH` is intentional and correct.

**Verdict:** not a gap — this is the DPDP compliance story.

---

## 6. OpenAPI gaps

### O1. Zero `examples:` blocks

10 paths, 30+ schemas, but no request/response examples. Partners copy-paste from documentation — examples dramatically reduce integration time.

**Size:** ~2 hours to add at least one example per endpoint. Each one is 5–10 lines of YAML.

### O2. No CI drift check

OpenAPI can drift from the route handlers (new params not documented, response shape changes). ADR-1006 covers this: `redocly lint` + a test that cross-checks OpenAPI paths against actual Next.js routes. Not tier-1.

### O3. Single `servers:` entry

Current: `https://app.consentshield.in/api/v1`. Should add a sandbox URL when the sandbox mode ships (ADR-1003 territory). Not a gap now.

---

## 7. Recommendations

### Tier 1 — Ship as small sprints right now (totals ~1 day)

These are all thin wrappers over existing RPCs + zero new schema. Each is a single route handler + test. Proposed as **ADR-1012** — "v1 DX gap fixes".

- **S1** `GET /v1/keys/self` — self-introspection
- **S2** `GET /v1/purposes` — purpose discovery
- **S3** `GET /v1/properties` — property discovery
- **S4** `GET /v1/usage` — quota + recent consumption
- **S5** `GET /v1/plans` — public tier table
- **S6** OpenAPI examples backfill (every endpoint gets at least one request + one success response example)

**Why ship now.** Trivial effort, massive DX impact for any partner integrating for the first time, and ADR-1005 builds on the same patterns.

### Tier 2 — Absorb into ADR-1005

- Rights API (the big piece — 6+ endpoints covering DPDP §11 rights for submit/status/events/evidence/close)
- Tracker observations read (`read:tracker` → `GET /v1/trackers`)
- Consent probes read (`read:probes` → `GET /v1/probes`)

### Tier 3 — Absorb into ADR-1008 (SOC 2 / audit surface)

- Audit log read (`read:audit` → `GET /v1/audit`)
- Security posture read (`read:security` → `GET /v1/security/scans`)

### Tier 4 — Absorb into ADR-1003 (Processor posture)

- DEPA score read (`read:score` → `GET /v1/score`) — relates to the storage-mode story since Zero-Storage has different score semantics.
- Sandbox mode endpoint surface.

### Tier 5 — Strip from scope allow-list if deferred further

If any of the above slips past ADR-1008's close without implementation, strip the scope from `api_keys_scopes_valid` to stop false-positive key issuance.

---

## 8. Outcome

Recommend ADR-1012 to ship Tier 1 before starting ADR-1005. ~1 day of work, 5 new endpoints, closes the day-1 integration story. Then ADR-1005 proceeds with the rights API + probes + trackers as planned — having ADR-1012 already shipped means partners can actually use the new endpoints when they ship (instead of fumbling around to discover `purpose_code` values).

No blocking issues found. No security regressions. The 10 shipped endpoints are shape-consistent, scope-enforced, and test-covered (107 integration tests). The remaining surface is **forward work**, not debt.
