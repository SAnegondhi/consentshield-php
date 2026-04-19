# ADR-1006: Developer Experience — Client Libraries + OpenAPI Spec + CI Drift Check

**Status:** Proposed
**Date proposed:** 2026-04-19
**Date completed:** —
**Related plan:** `docs/plans/ConsentShield-V2-Whitepaper-Closure-Plan.md` Phase 6
**Depends on:** ADR-1002 (every `/v1/*` endpoint must exist and be stable)
**Related gaps:** G-002, G-003, G-024, G-045

---

## Context

The whitepaper §5.4 promises client libraries in Node.js, Python, Java, and Go that ship with a 2-second default timeout and fail-closed behaviour (`CONSENT_VERIFY_FAIL_OPEN=true` opts out, with the override recorded in the audit trail). This is not a library-convenience feature; it is the compliance posture ConsentShield promises by default. A BFSI customer that calls the verify endpoint with no client library and no configured timeout will, in many common failure modes, default-open and silently act on withdrawn consent — the worst DPDP outcome. The libraries encode the correct default.

Appendix A of the whitepaper is a hand-written table of `/v1/*` endpoints. Once ADRs 1001–1005 land, that table needs to match code exactly. A CI check that regenerates Appendix A from an OpenAPI spec and fails the build on drift is how we prevent the document from decaying over time (CC-F + G-045).

This ADR delivers libraries and the spec-as-SSOT commitment.

## Decision

Ship four languages and one specification:

1. **Node.js library (G-002)** — `@consentshield/node` on npm at v1.0.0. Methods: `verify`, `verifyBatch`, `recordConsent`, `revoke`, `triggerDeletion`, plus artefact-CRUD helpers. Fail-closed default with env override. TypeScript types. Express + Next.js integration examples.
2. **Python library (G-003)** — `consentshield` on PyPI at v1.0.0. API parity with Node. Python 3.9+. Django + Flask + FastAPI examples.
3. **Java + Go libraries (G-024)** — `com.consentshield:consentshield-client:1.0.0` on Maven Central; `github.com/consentshield/go-client` Go module. API parity. Spring Boot (Java) + net/http (Go) examples.
4. **OpenAPI spec + CI drift check (G-045)** — `app/public/openapi.yaml` becomes the single source of truth for `/v1/*`. `scripts/regenerate-whitepaper-appendix.ts` emits markdown; CI fails if Appendix A diverges.

## Consequences

- Every `/v1/*` shape change in future PRs must edit both the code and the OpenAPI spec (enforced by CI). The whitepaper Appendix A regenerates automatically.
- Customers integrating in Node or Python can go from "npm install / pip install" to first verify call in under an hour (target documented in README).
- The `CONSENT_VERIFY_FAIL_OPEN` override is an explicit compliance trade-off: it is opt-in, it is documented, and it writes to the customer's audit trail. This matches the whitepaper's §5.4 stance exactly.
- Java + Go are lower-priority than Node + Python (the Indian BFSI + healthcare customer base skews heavily to Node/Python); they ship in the same ADR for convenience and to hold the API conventions stable across all four languages.
- Library maintenance becomes a per-release discipline: a `/v1/*` shape change bumps the libraries' minor version.

---

## Implementation Plan

### Phase 1: Node.js library (G-002)

#### Sprint 1.1: Package scaffold

**Estimated effort:** 2 days

**Deliverables:**
- [ ] New repo `consentshield-node` (or `packages/node-client/` if we choose monorepo)
- [ ] Package scaffolding: tsconfig, eslint, prettier, vitest, exact-pinned deps per project norms
- [ ] `ConsentShieldClient` class with constructor accepting `{ apiKey, baseUrl?, timeoutMs?, failOpen? }`
- [ ] HTTP helper with 2-second default timeout; retry on 5xx + network error up to 3 times
- [ ] Error types: `ConsentVerifyError`, `ConsentShieldApiError`, `ConsentShieldNetworkError`

**Testing plan:**
- [ ] Constructor accepts valid config
- [ ] HTTP helper respects timeout; mock server delays 3s → error after 2s

**Status:** `[ ] planned`

#### Sprint 1.2: Verify + verifyBatch methods

**Estimated effort:** 2 days

**Deliverables:**
- [ ] `client.verify({ propertyId, dataPrincipalIdentifier, identifierType, purposeCode })` → typed response matching §5.1
- [ ] `client.verifyBatch({ propertyId, purposeCode, dataPrincipalIdentifiers })` → typed array response
- [ ] Input validation (client-side) matching server-side constraints
- [ ] Fail-closed behaviour: network failure throws `ConsentVerifyError` (not "assumed granted")
- [ ] `CONSENT_VERIFY_FAIL_OPEN=true` env var check: when set, catches the error and returns a `{ status: 'open_failure', reason: ... }` shape; writes an audit record via the `/v1/audit/override` endpoint (to be added)

**Testing plan:**
- [ ] Verify happy path against mock server
- [ ] Timeout + fail-closed: default throws
- [ ] Fail-open env override: catches, audits, returns alternate shape
- [ ] Batch with 10k → ok; 10,001 → throws before network call

**Status:** `[ ] planned`

#### Sprint 1.3: Record + revoke + triggerDeletion + artefact helpers

**Estimated effort:** 2 days

**Deliverables:**
- [ ] `client.recordConsent(...)` → returns `{ eventId, artefactIds, createdAt }`
- [ ] `client.revokeArtefact(id, { reasonCode, actorType })`
- [ ] `client.triggerDeletion(...)` → returns receipt IDs
- [ ] `client.listArtefacts({ ... })` with cursor iteration
- [ ] `client.getArtefact(id)`
- [ ] `client.listRightsRequests({ ... })` + `client.createRightsRequest(...)`

**Testing plan:**
- [ ] Each method tested against mock server
- [ ] Idempotent revoke replay returns same revocation_record_id

**Status:** `[ ] planned`

#### Sprint 1.4: Publish + integration examples

**Estimated effort:** 1 day

**Deliverables:**
- [ ] TypeScript type definitions shipped (generated from OpenAPI where possible)
- [ ] README with quickstart
- [ ] `examples/express-verify-middleware/` — Express middleware that verifies marketing consent before every request
- [ ] `examples/nextjs-mobile-record/` — Next.js API route recording consent from a mobile app
- [ ] Publish to npm at v1.0.0
- [ ] Internal smoke test in ConsentShield admin app uses the library against staging

**Testing plan:**
- [ ] `npm install @consentshield/node` in a scratch project; example runs against staging
- [ ] Coverage ≥ 80% (`npm test -- --coverage`)

**Status:** `[ ] planned`

### Phase 2: Python library (G-003)

#### Sprint 2.1: Package scaffold + method parity

**Estimated effort:** 3 days

**Deliverables:**
- [ ] `consentshield` package layout with Poetry/uv or pip-tools
- [ ] Py 3.9+ compatibility
- [ ] Type hints on every public API; mypy clean
- [ ] API parity with Node: same method names (snake_case adapted), same error types, same fail-closed default, same `CONSENT_VERIFY_FAIL_OPEN` env override
- [ ] `httpx` for HTTP (supports async + sync)

**Testing plan:**
- [ ] Method-parity tests: same fixtures as Node library, same assertions
- [ ] `mypy --strict` passes

**Status:** `[ ] planned`

#### Sprint 2.2: Integration examples + PyPI publish

**Estimated effort:** 2 days

**Deliverables:**
- [ ] Django middleware example
- [ ] Flask decorator example
- [ ] FastAPI dependency-injection example
- [ ] README with quickstart
- [ ] Publish to PyPI at v1.0.0
- [ ] Internal smoke test

**Testing plan:**
- [ ] `pip install consentshield` in a scratch project; examples run against staging

**Status:** `[ ] planned`

### Phase 3: OpenAPI spec completion + CI drift check (G-045)

#### Sprint 3.1: Full spec + Appendix A generator

**Estimated effort:** 2 days

**Deliverables:**
- [ ] `app/public/openapi.yaml` covers every `/v1/*` endpoint shipped in ADRs 1001–1005 with full request/response schemas, scopes, error shapes
- [ ] Spec published at `https://api.consentshield.in/openapi.yaml`
- [ ] `scripts/regenerate-whitepaper-appendix.ts` reads OpenAPI and emits the Markdown table that replaces Appendix A in the whitepaper

**Testing plan:**
- [ ] `redocly lint` passes
- [ ] Generated Appendix A matches current whitepaper (diff is empty at time of merge)

**Status:** `[ ] planned`

#### Sprint 3.2: CI drift check

**Estimated effort:** 1 day

**Deliverables:**
- [ ] CI workflow step: run the generator; diff against `docs/design/ConsentShield-Customer-Integration-Whitepaper-v2.md` Appendix A section; fail build on any difference
- [ ] Developer ergonomics: a `bun run sync:whitepaper-appendix` command updates the whitepaper in place from the spec

**Testing plan:**
- [ ] Introduce a fake drift (add an endpoint in code but not in spec) → CI fails
- [ ] Remove the drift → CI passes

**Status:** `[ ] planned`

### Phase 4: Java + Go libraries (G-024)

#### Sprint 4.1: Java library

**Estimated effort:** 5 days

**Deliverables:**
- [ ] `com.consentshield:consentshield-client:1.0.0` Maven artefact
- [ ] API parity with Node/Python
- [ ] Fail-closed default; `CONSENT_VERIFY_FAIL_OPEN` via Java system property or env
- [ ] Spring Boot integration example with auto-configuration
- [ ] Publish to Maven Central (Sonatype OSSRH onboarding done during this sprint)
- [ ] Coverage ≥ 80%

**Testing plan:**
- [ ] `mvn install` in a scratch Spring Boot project; example runs against staging
- [ ] Integration tests: same fixtures

**Status:** `[ ] planned`

#### Sprint 4.2: Go library

**Estimated effort:** 3 days

**Deliverables:**
- [ ] `github.com/consentshield/go-client` Go module
- [ ] API parity with other languages (Go-idiomatic: `context.Context` first arg, explicit error returns)
- [ ] Fail-closed default; `CONSENT_VERIFY_FAIL_OPEN` via env
- [ ] `net/http` example + middleware for `chi`/`gin`
- [ ] Tag v1.0.0 on the module proxy
- [ ] Coverage ≥ 80%

**Testing plan:**
- [ ] `go get github.com/consentshield/go-client@v1.0.0` in scratch project; example runs against staging

**Status:** `[ ] planned`

---

## Architecture Changes

- `docs/architecture/consentshield-definitive-architecture.md`: add a "Client libraries" section with the four supported languages + API conventions
- `docs/architecture/nextjs-16-reference.md`: OpenAPI spec as part of the public static assets

_None yet._

---

## Test Results

_Empty until Sprint 1.1 runs._

---

## V2 Backlog (explicitly deferred)

- PHP client library — wait for WordPress plugin + customer demand (ADR-1007).
- Ruby / Rust / C# libraries — defer to future ADR on customer signal.
- Async-first Python client (current library exposes both sync + async from httpx) — no further work unless users complain.

---

## Changelog References

- `CHANGELOG-api.md` — Sprint 3.1 (OpenAPI spec), Sprint 3.2 (CI drift)
- `CHANGELOG-docs.md` — Sprints 1.4, 2.2 (examples), Sprint 3.2 (drift-check docs)
- External: per-library release notes in each library repo
