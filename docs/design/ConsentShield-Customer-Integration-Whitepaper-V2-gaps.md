# ConsentShield — Whitepaper-to-Code Gap Document (Revised)

(c) 2026 Sudhindra Anegondhi · a.d.sudhindra@gmail.com

*Revision date: 2026-04-19*
*Source whitepaper: `docs/design/ConsentShield-Customer-Integration-Whitepaper-v2.md` (v2.0, April 2026)*
*Supersedes: `docs/design/consentshield-whitepape-v2-gaps.md` (initial cut, same date)*
*Ground truth: 44 ADRs (0001–0050), changelogs, migrations in `supabase/migrations/`, and a code-level verification sweep of `app/src/app/api/**`, `app/src/lib/**`, `packages/**`, `worker/**` performed 2026-04-19.*

---

## Why this revision exists

The initial gaps document (same filename, lowercase) catalogued 35 gaps derived from reading the whitepaper alone. A subsequent code-level verification sweep revealed one structural finding that the initial document did not surface and that changes the shape of every gap downstream:

**The public `/v1/*` compliance API surface described in Appendix A of the whitepaper does not exist in the repository.** The only public-facing endpoint under `/v1/*` today is the deletion-receipt callback (`POST /v1/deletion-receipts/[id]`) introduced by ADR-0022. No `/v1/consent/record`, no `/v1/consent/verify`, no `/v1/consent/verify/batch`, no `/v1/consent/artefacts`, no `/v1/deletion/trigger`, no `cs_live_*` API key issuance or verification middleware. The customer-tenant endpoints under `/api/orgs/[orgId]/*` are well-populated — the DEPA artefact pipeline, dashboard, and admin console are real — but the whitepaper's Appendix A promises a surface that can only be reached through a Supabase JWT today.

Two consequences flow from this:

1. **The client libraries gaps (G-002, G-003, G-024) are downstream of, not parallel to, a new P0: building the public REST API.** An npm package cannot ship until the HTTP surface it wraps exists.
2. **Four reference architectures in the whitepaper (§9.2, §9.3, §9.4) are non-executable today.** Surface 2 (consent verification) is the load-bearing integration point for every BFSI and healthcare archetype. Without it, Sections 9.2–9.4 cannot be delivered, and the BFSI Enterprise tier has no product to sell.

This revision therefore:
- Adds a new **P0 block (G-036 through G-041)** for the missing public API surface, which must precede the client libraries.
- Closes or downgrades gaps that the verification sweep showed are already shipped (e.g. the admin-side consent-record flow, sector templates, audit export packaging pattern).
- Adds new gaps the initial document missed (healthcare sector template seed, orphan-event metric implementation, non-email notification channels, audit export CSV-format alignment).
- Re-sequences the critical path.

All gap IDs are stable across revisions. New gaps use G-036+. Closed gaps from the initial doc are marked **Closed** with the ADR/file reference that resolves them.

---

## Why these gaps matter — the DEPA/DPDP compliance promise

ConsentShield's reason for existing is a concrete promise to its customers: **we will let you discharge your DPDP obligations, produce DEPA-aligned consent artefacts, and survive a Data Protection Board examination, across every channel and every customer category you operate in.** Every API in the gap list earns its P0/P1/P2 band by what slice of that promise it unblocks. This section makes the link explicit so that prioritisation trade-offs are framed in customer-compliance terms, not only in engineering-effort terms.

### The DPDP / DEPA obligations ConsentShield must help customers discharge

| # | Obligation | DPDP / DEPA anchor | ConsentShield's contribution |
|---|---|---|---|
| O1 | Specific, informed, free consent per purpose | DPDP §6(1); DEPA artefact model | Produce one artefact per purpose, with explicit `data_scope` and `notice_version`, from any channel (web, mobile, kiosk, call-centre, branch, in-person) |
| O2 | Purpose limitation at point of action | DPDP §5, §6(2) | Runtime verify API with sub-50ms latency, callable from every customer system before any user-data action |
| O3 | Withdrawal as easy as granting | DPDP §6(4) | Revocation available on any channel the grant was available on; revocation reflected in verify within one request cycle |
| O4 | Data-principal rights (access, correction, erasure, nomination, grievance) | DPDP §11–14 | Rights requests capturable from portal, mobile app, call-centre, branch; SLA-tracked; delivery orchestrated |
| O5 | Erasure + retention discipline | DPDP §8(7); sector statutes (RBI KYC, PMLA, CICRA, DISHA, Insurance Act § 64VB) | Artefact-scoped deletion that respects statutory retention via the Regulatory Exemption Engine |
| O6 | Notice obligation + material-change re-consent | DPDP §5(a), §6(1) | Notice versioning on every artefact; re-consent workflow when a material change is published |
| O7 | Processor-not-Fiduciary posture | DPDP §8 (processor accountability); RBI outsourcing guidelines | Zero-persistence of regulated content; customer holds the compliance record; ConsentShield never accumulates PII |
| O8 | Breach + silent-failure detection | DPDP §8(6); reasonable-security-safeguards test | Orphan-event metric, deletion-overdue alerts, probe failures surfaced so compliance drift is never silent |
| O9 | DPB-defensible audit trail | DPDP §12–14; Rule 12 | Three-link chain (artefact → revocation → deletion receipt) exportable in a regulator-ready format |
| O10 | Significant Data Fiduciary controls | DPDP §10 | DPIA inputs, DPO routing, periodic audit artefacts (Phase 3 emphasis; ADR-0046 lays the foundation) |

### Customer archetype × obligation — what each category needs on day one

Different customers need different obligations discharged before they can contract. The matrix below drives gap prioritisation: **bold** cells are hard blockers — without them, the customer cannot buy the product.

| Archetype | O1 consent | O2 verify | O3 withdraw | O4 rights | O5 retention | O6 notice | O7 processor | O8 silent-fail | O9 audit |
|---|---|---|---|---|---|---|---|---|---|
| **Pure web SaaS (Starter/Growth)** | banner-only | optional | banner-only | portal-only | minimal | basic | Standard OK | basic | basic |
| **SaaS Pro (API-heavy)** | banner + API | **required** | banner + API | portal + API | basic | required | Insulated | required | required |
| **Digital NBFC (mobile-first)** | banner + **mobile API** | **critical** | **mobile API** | portal + mobile | **RBI KYC, PMLA, CICRA** | required | **Insulated mandatory** | required | **critical** |
| **Private bank (omni-channel)** | banner + **branch, mobile, call-centre APIs** | **critical, batch** | **every channel** | **every channel** | **5+ statutes** | **versioned + re-consent** | **Zero-Storage mandatory** | **critical** | **critical** |
| **Healthcare (ABDM clinic)** | **tablet + kiosk API** | required | tablet + API | portal + tablet | **DISHA 7 yr** | required | **Zero-Storage mandatory (FHIR)** | required | **critical** |
| **Telecom / edtech / e-commerce (future)** | sector-dependent | required | sector-dependent | required | sector statutes | required | Insulated | required | required |

### Gap → obligation → customer unblock

This is the load-bearing table for prioritisation. It reads top-to-bottom as "if this gap is closed, which compliance obligation becomes deliverable, and which customer archetype is unblocked."

| Gap | Unblocks obligation | Without it | Most-affected customers |
|---|---|---|---|
| **G-036** public API scaffolding (`cs_live_*` + Bearer middleware) | Every server-to-server promise (O1–O5, O9) | No customer integration exists beyond browser banner. Pure-Web-SaaS works; every other archetype is unreachable. | NBFC, Bank, Healthcare, SaaS Pro |
| **G-037** verify + batch | **O2 — purpose limitation at point of action** | Customer records consent but cannot enforce it. Marketing engines send to withdrawn users; underwriting engines score against withdrawn bureau-reporting consent. The DPB examiner's *"did you act on withdrawn consent?"* is unanswerable. For BFSI, this is the entire product. | NBFC, Bank, any regulated sector |
| **G-038** consent record (Mode B) | **O1 — consent from every channel** | Mobile apps, call-centres, branch tablets, kiosks cannot produce DEPA artefacts. Customer ships non-compliant channels or builds duplicate DEPA infrastructure — defeats the product. | NBFC, Bank, Healthcare |
| **G-039** artefact list + revoke + events | **O3 — withdraw as easy as grant**; O4 | Mobile app's "withdraw marketing" button has no implementation path; revocation only from banner. Violates DPDP §6(4) parity requirement. | NBFC, Bank, Healthcare |
| **G-040** deletion trigger + receipts list | **O4 — programmatic erasure**; O9 | Operator-initiated erasure has no programmatic path. Support-desk §13 request becomes a manual orchestration ticket. Multi-partner bank deletions (§11 example) cannot be triggered by the bank's own systems. | Bank, NBFC, any customer with support operations |
| **G-041** storage_mode enforcement | **O7 — processor posture** | Zero-Storage is a declarative claim only. The RBI-outsourcing-guideline defence collapses under inspection; the FHIR zero-persistence claim is unenforced and indefensible. | Bank (mandatory), Healthcare (mandatory) |
| **G-042** healthcare sector seed | O1 for healthcare | Healthcare customers have no DEPA-aligned starting point. ABDM + DISHA alignment rebuilt per customer = Healthcare bundle is unsellable. | Healthcare clinics, hospitals |
| **G-045** OpenAPI + CI drift check | Regulator and auditor trust (supporting O9) | Whitepaper drifts from reality silently; procurement security reviews lose confidence; auditor evidence inconsistent across quarters. | All customers under audit (BFSI, healthcare, SDF) |
| **G-046** sandbox provisioning | Integration velocity (not a DPDP obligation directly) | Procurement-to-go-live stretches; pilot customers burn elapsed weeks waiting for environments that should be one-click. | All customers, especially those with procurement timelines |
| **G-048** orphan metric + alert | **O8 — silent-failure detection** | Fan-out pipeline can fail silently; customer believes consent is enforced while artefacts are missing. Latent DPDP §6 violation discovered only at audit time — the worst possible discovery path. | All customers; most consequential for high-volume BFSI |
| **G-049** `/v1/rights/requests` | **O4 — rights from any channel** | Rights requests only possible via public portal + Turnstile. Bank call-centre, mobile app, branch, support desk cannot create requests programmatically — DPDP §13/14 workflow is channel-limited. | Bank, NBFC, Healthcare, any customer with multi-channel operations |
| **G-007** Regulatory Exemption Engine | **O5 — statutory retention** | Deletion orchestration cannot tell "delete marketing data" from "retain KYC under RBI directive". Every BFSI customer either over-deletes (regulatory breach) or under-deletes (DPDP breach). | NBFC, Bank, Insurance, Healthcare |
| **G-012** notice versioning + re-consent | **O6 — material-change obligation** | Privacy-notice update has no machinery; existing artefacts are silently orphaned from the new notice, or the customer ignores the obligation. | All customers that update notices (i.e. all of them over time) |
| **G-011** generic webhook reference implementation | **O4 + O5 + O9 — deletion orchestration** | Generic protocol is specified but unexercised; the moment a BFSI customer tries to wire their core-banking webhook, they discover edge cases and ConsentShield has no reference partner to de-risk against. | Bank, NBFC |

### The consequence for prioritisation

Two of the new P0 gaps — **G-037 (verify) and G-038 (record)** — are not merely "missing endpoints". They are the pieces of the compliance promise that distinguish ConsentShield from *"a banner vendor with a dashboard"*. G-037 is the enforcement surface for DPDP §6(2); G-038 is the multi-channel consent-capture surface for DPDP §6(1). Without either, the whitepaper's Sections 4, 5, 6, 9.2, 9.3, 9.4, and 11 collapse into marketing copy, and ConsentShield regresses to a Starter-tier product no matter what tier the customer paid for.

**G-041 (storage_mode enforcement) is a category-unlock:** without it, the RBI-outsourcing-guideline posture that Section 9.3 depends on is an unkept promise, so the BFSI Enterprise tier has no technical moat against the customer's objection *"how is this different from any other SaaS?"*.

**G-042 (healthcare seed) is a category-unlock in the opposite direction:** without the healthcare sector seed, Section 9.4 has no starting point, so the Healthcare bundle has no SKU.

**G-048 (orphan metric) is the integrity guarantee:** the fan-out pipeline is the single architectural bet behind the DEPA artefact model. If it fails silently — even once — the customer's compliance posture is an illusion for everyone who consented during the failure window. Without a live orphan counter + alert, ConsentShield cannot claim the DPDP §8(6) "reasonable security safeguards" standard for its own processing.

Everything else in P0 / P1 is either operational hygiene (G-001, G-004, G-045, G-046, G-014, G-015) or depth of an already-executable promise (G-007 enriches O5 beyond the BFSI seed; G-012 operationalises O6; G-011 de-risks O4/O9). **The compliance-promise core is G-036 → G-037 → G-038 → G-039 → G-040 → G-041, supported by G-042 and G-048.** That ordering is the product, in engineering form.

---

## How to use this document

- Each gap has a stable ID (`G-NNN`) for cross-reference in tickets, PRs, and commit messages.
- Acceptance criteria are testable statements — when all criteria pass, the gap is closed.
- Priority bands tie to delivery gates, not arbitrary urgency.
- Effort estimates are wall-clock weeks for a solo developer with focused attention.

## Priority bands → Delivery gates

| Band | Closes before | Rationale |
|---|---|---|
| **P0** | Whitepaper goes to any BFSI / healthcare prospect | Active misrepresentation or hard blocker; discovery in procurement = lost deal |
| **P1** | First BFSI Enterprise or Healthcare customer goes live | Promised capability that customer will exercise on day one |
| **P2** | Whitepaper claims fully deliverable at scale across all 4 archetypes | Required for the document to be ironclad rather than aspirational |
| **P3** | Phase 4 or post-launch hardening | Nice-to-have, deferrable, not blocking |

---

## Gap summary (revised)

| ID | Title | Priority | Effort | Delta vs. initial |
|---|---|---|---|---|
| G-001 | Connector catalogue accuracy in marketing materials | P0 | 0.5 day | Unchanged |
| G-002 | Node.js client library with fail-closed default | **P1** | 1 week | **Downgraded — depends on G-036/G-037/G-038** |
| G-003 | Python client library with fail-closed default | **P1** | 1 week | **Downgraded — same reason** |
| G-004 | Operational Maturity appendix in whitepaper | P0 | 1 day | Unchanged |
| G-005 | Zero-Storage mode end-to-end production validation | P1 | 3 weeks | Unchanged |
| G-006 | Insulated mode (BYOS) end-to-end validation | P1 | 2 weeks | Unchanged |
| G-007 | Regulatory Exemption Engine — schema + sector templates | P1 | 3 weeks | Unchanged |
| G-008 | Regulatory Exemption Engine — legal review of mappings | P1 | 2 weeks elapsed | Unchanged |
| G-009 | Batch verification load test at 1M+ identifiers | P1 | 1 week | **Depends on G-037** |
| G-010 | DEPA fan-out pipeline spike load test | P1 | 1 week | Unchanged |
| G-011 | Generic webhook protocol — reference implementation | P1 | 2 weeks | Unchanged |
| G-012 | Notice versioning — minimum re-consent workflow | P1 | 3 weeks | Unchanged |
| G-013 | Solutions engineer capacity — hire or contract | P1 | Ongoing | Unchanged |
| G-014 | Production support model — definition + tooling | P1 | 2 weeks | Unchanged |
| G-015 | Status page + incident communication infrastructure | P1 | 1 week | Unchanged |
| G-016 | CleverTap connector | P2 | 1 week | Unchanged |
| G-017 | Razorpay anonymisation connector | P2 | 1 week | Unchanged |
| G-018 | WebEngage + MoEngage connectors | P2 | 2 weeks | Unchanged |
| G-019 | Intercom + Freshdesk connectors | P2 | 2 weeks | Unchanged |
| G-020 | Shopify + WooCommerce connectors | P2 | 2 weeks | Unchanged |
| G-021 | Segment connector | P2 | 1 week | Unchanged |
| G-022 | WordPress plugin | P2 | 2 weeks | Unchanged |
| G-023 | Shopify App Store plugin + listing | P2 | 3 weeks | Unchanged |
| G-024 | Java + Go client libraries | P2 | 2 weeks | Unchanged (still follows G-002/G-003) |
| G-025 | Consent probe testing infrastructure | **Closed** | — | **Shipped in ADR-0041 (Vercel Sandbox runner + CRUD UI); residual scope is tracker-signature coverage, see G-047** |
| G-026 | DPB-format audit export structured packaging | P2 | 1.5 weeks | **Reduced — current export is JSON-sectioned, needs CSV alignment per whitepaper §12.4 + Appendix spec** |
| G-027 | Sub-50ms verify p99 SLO — measurement + infrastructure | P2 | 2 weeks | **Depends on G-037** |
| G-028 | React Native consent component (drop-in modal) | P3 | 3 weeks | Unchanged |
| G-029 | Webflow / Wix / Framer / Squarespace plugin decision | P3 | 0.5 day + variable | Unchanged |
| G-030 | Q3 2026 connector batch (Zoho, Freshworks, Zendesk, Campaign Monitor, Mixpanel) | P3 | 4 weeks | Unchanged |
| G-031 | Re-consent campaign multi-channel delivery | P3 | 4 weeks | Unchanged |
| G-032 | HMAC signature secret rotation mechanism | P3 | 1 week | Unchanged |
| G-033 | SOC 2 Type II audit observation period — verify start | P3 | Audit/process | Unchanged |
| G-034 | Compliance dashboard surfacing of orphan / overdue / expiry metrics | P2 | 2 weeks | **Depends on G-048 (orphan metric implementation)** |
| G-035 | `test_delete` endpoint for connector smoke testing | P2 | 1 week | **Depends on G-036 (API-key auth)** |
| **G-036** | **Public API scaffolding — `cs_live_*` keys + Bearer middleware + rate tiers** | **P0** | **2 weeks** | **New** |
| **G-037** | **`GET /v1/consent/verify` + `POST /v1/consent/verify/batch`** | **P0** | **2 weeks** | **New** |
| **G-038** | **`POST /v1/consent/record` — Mode B escape hatch** | **P0** | **1.5 weeks** | **New** |
| **G-039** | **`/v1/consent/artefacts` + `/v1/consent/artefacts/{id}/revoke` + `/v1/consent/events`** | **P1** | **1 week** | **New** |
| **G-040** | **`POST /v1/deletion/trigger` + `GET /v1/deletion/receipts` (list)** | **P1** | **1 week** | **New** |
| **G-041** | **`storage_mode` enforcement at API gateway layer** | **P1** | **1 week** | **New — column exists (migration 20260413000003) but no runtime gate** |
| **G-042** | **Healthcare sector template seed (ABDM + DISHA purposes)** | **P1** | **1 week** | **New — BFSI seeded, healthcare missing** |
| **G-043** | **Non-email notification channels (Slack, Teams, Discord, PagerDuty, custom webhook)** | **P2** | **2 weeks** | **New — `notification_channels` table exists, only Resend email is wired** |
| **G-044** | **Audit export CSV-format alignment with whitepaper spec** | **P2** | **1 week** | **New — current export is JSON-sectioned ZIP; whitepaper §12.4 + Appendix imply CSV files per entity with manifest** |
| **G-045** | **Public OpenAPI spec + Appendix A regeneration** | **P1** | **1 week** | **New — CI must fail on whitepaper-vs-spec drift (CC-A promoted to a gap)** |
| **G-046** | **Sandbox organisation provisioning flow** | **P1** | **1 week** | **New — whitepaper §12.1 and §14 promise `org_test_*` provisioned in < 1 hour; no such flow exists** |
| **G-047** | **Tracker signature catalogue coverage to 200+ fingerprints** | **P2** | **2 weeks** | **New (residual from G-025) — ADR-0041 ships the runner, not the fingerprint corpus** |
| **G-048** | **`orphan_consent_events` metric + alert wiring** | **P1** | **1 week** | **New — `depa_compliance_metrics.coverage_score` exists; orphan count not computed** |
| **G-049** | **Public rights-request API (`POST /v1/rights/requests`, `GET /v1/rights/requests`)** | **P2** | **1 week** | **New — public portal exists under `/api/public/rights-request`; compliance-API surface does not** |

**Total P0 effort (revised):** ~7 weeks (up from 2.5 — the public API surface adds ~5 weeks)
**Total P1 effort (revised):** ~22 engineering weeks
**Total P2 effort (revised):** ~26 engineering weeks
**Total P3 effort (revised):** ~12 engineering weeks

---

## P0 — Close before BFSI/Healthcare whitepaper distribution

### G-001 — Connector catalogue accuracy in marketing materials

**Status vs. initial:** Unchanged. Verification confirms only Mailchimp + HubSpot exist under `app/src/lib/connectors/oauth/`.

**Whitepaper section:** Appendix D (and §9.2, §9.3 passing references)
**Whitepaper claim:** 11 services listed as "Shipping" (Mailchimp, HubSpot, Freshdesk, Intercom, CleverTap, WebEngage, MoEngage, Shopify, WooCommerce, Razorpay, Segment).
**Current state:** Only Mailchimp + HubSpot built and tested (ADR-0018 + ADR-0039).
**Target state:** Catalogue accurately reflects shipping vs. roadmap, with realistic delivery dates.

**Acceptance criteria:**
- Appendix D edited: only Mailchimp + HubSpot marked "Shipping today"
- All others moved to "Q3 2026" or "On request" with concrete dates
- Same change applied to `consentshield-landing.html`, `consentshield-site.html`, all sales decks
- README in `app/src/lib/connectors/` matches whitepaper catalogue exactly

**Effort:** 0.5 day · **Dependencies:** None · **Owner:** Founder

---

### G-004 — Operational Maturity appendix in whitepaper

**Status vs. initial:** Unchanged. Still a documentation task. Now depends on the honest public-API status surfaced in this revision.

**Acceptance criteria:** (as in initial document; now must explicitly flag the public `/v1/*` API as Roadmap, not Shipping)

**Effort:** 1 day · **Dependencies:** Honest internal inventory (this document) · **Owner:** Founder

---

### G-036 — Public API scaffolding — `cs_live_*` keys + Bearer middleware + rate tiers *(new)*

**Whitepaper section:** Appendix A (Compliance API)
**Whitepaper claim:** Every `/v1/*` route is authenticated via `Authorization: Bearer cs_live_xxxx...`. Rate limits are "Starter 100/hr · Growth 1,000/hr · Pro 10,000/hr · Enterprise custom".
**Current state:** No API key issuance, no verification middleware. Nothing under `/v1/*` apart from the HMAC-signed deletion callback, which has its own signature scheme. `account_memberships` and credential RLS exist (ADR-0044 Phase 1) but the customer-facing API-key surface is absent.
**Target state:** Customers can mint, rotate, and revoke `cs_live_*` keys scoped to an org or account; every `/v1/*` route verifies the key, resolves `org_id`, checks per-tier rate limits, and logs usage.

**Acceptance criteria:**
- New `public.api_keys` table: `id`, `org_id`, `account_id`, `prefix`, `hashed_secret`, `scopes` (array from §Appendix A scope list), `created_by`, `created_at`, `last_used_at`, `revoked_at`, `name`, `rate_tier`
- Key format: `cs_live_` + 32 url-safe bytes; store SHA-256 hash, never the plaintext
- Dashboard surface: `/dashboard/settings/api-keys` list/create/revoke, full plaintext shown once on creation only
- Next.js middleware (or edge helper) on the `/api/v1/*` branch: resolves bearer → `org_id`, attaches to request context, rejects with `401` / `403` / `429` per failure mode
- Scoped RLS: requests flow through a Postgres role (`cs_api`, new, minimum-privilege) with `current_org_id()` set from the resolved key; no service-role usage
- Rate limiter re-used from ADR-0010; per-tier windows configurable via `public.plans` join
- Audit-log writes on every successful call (`api.request_log` table, day-partitioned, 90-day retention)
- Unit + integration tests: valid key / revoked key / expired-rotated key / wrong-scope / rate-limit breach / cross-org reference
- OpenAPI spec stub at `/openapi.yaml` (used by G-045)

**Effort:** 2 weeks · **Dependencies:** None blocking; ADR-0044 membership layer already live · **Owner:** Founder
**Blocks:** G-002, G-003, G-024, G-037, G-038, G-039, G-040, G-049

---

### G-037 — `GET /v1/consent/verify` + `POST /v1/consent/verify/batch` *(new)*

**Whitepaper section:** §5.1, §5.3, §11; Appendix A
**Whitepaper claim:** Sub-50ms p99 single-identifier verify; batches up to 10k identifiers per call; fail-closed behaviour in client libraries.
**Current state:** `consent_artefact_index` exists and is populated by `process-consent-event` (ADR-0021). No public HTTP endpoint reads it. Internal callers query directly via RLS.
**Target state:** Public endpoints backed by `consent_artefact_index`, behind G-036's API-key middleware, returning the four-valued status (`granted | revoked | expired | never_consented`) with artefact IDs and timestamps exactly as spec'd in §5.1.

**Acceptance criteria:**
- `GET /api/v1/consent/verify?property_id=...&data_principal_identifier=...&identifier_type=...&purpose_code=...` implemented as a Vercel Function
- `POST /api/v1/consent/verify/batch` accepts body per §5.3; validates `property_id` ownership via API-key's `org_id`; rejects batches > 10,000 with `413`
- Response body matches §5.1 schema exactly (field names, ISO-8601 timestamps, null handling)
- Scope check: key must hold `read:consent`
- Read path uses `consent_artefact_index` only; no JOIN to `consent_artefacts` on hot path
- `evaluated_at` populated server-side; never trust client
- p99 latency measured in staging at realistic load (deferred to G-027 for ongoing measurement; one-shot pass required here to prove the pathway is plausible)
- Integration test: active artefact → `granted`; revoked → `revoked` with `revocation_record_id`; past `expires_at` → `expired`; absent → `never_consented`
- Whitepaper §5.4's documented `CONSENT_VERIFY_FAIL_OPEN` client-library behaviour requires nothing server-side; the endpoint returns deterministic status only

**Effort:** 2 weeks · **Dependencies:** G-036 · **Owner:** Founder

---

### G-038 — `POST /v1/consent/record` — Mode B escape hatch *(new)*

**Whitepaper section:** §4.2, §9.2, §9.4, §11; Appendix A
**Whitepaper claim:** Customers post a consent event with purposes, `notice_version`, `captured_via`, `captured_by`, receive one artefact ID per granted purpose.
**Current state:** The fan-out pipeline (`process-consent-event` Edge Function) creates artefacts from any `consent_events` row, but the only writer is the Worker (HMAC-signed browser POST) and the dashboard. No server-to-server endpoint.
**Target state:** API-key-authenticated endpoint that validates purpose-definition IDs, writes a `consent_events` row as if from a non-browser channel, and returns artefact IDs synchronously (not 202 + async — customers recording call-centre consent expect the ID before they hang up).

**Acceptance criteria:**
- `POST /api/v1/consent/record` with body per §4.2 (property_id, data_principal, purposes[], notice_version, captured_via, captured_by, captured_at)
- Scope: `write:consent`
- Validation: every `purpose_definition_id` resolves and belongs to the org; `property_id` belongs to the org; `captured_at` within ±15 minutes of server time (drift tolerance)
- Writes `consent_events` with `source = 'api'`, `captured_via` recorded, `notice_version` recorded
- Synchronous path: triggers `process-consent-event` in-line (not trigger + async) for this call only, returning artefact IDs in the response. Trigger+safety-net path remains for idempotency.
- Response: `{ event_id, artefact_ids: [{ purpose_code, artefact_id, status: "active" | "denied" }], created_at }`
- Rejects with `422` if any `purpose_definition_id` is missing/invalid (matches §3.2 coverage_score = 100% invariant)
- Integration tests covering kiosk, call-centre, branch patterns (5 granted + 2 denied example from §4.2)

**Effort:** 1.5 weeks · **Dependencies:** G-036 · **Owner:** Founder

---

## P1 — Close before first BFSI Enterprise / Healthcare go-live

### G-002 — Node.js client library with fail-closed default *(downgraded to P1)*

**Status vs. initial:** Was P0. Downgraded because it wraps an API that does not yet exist. Remains P1 so it lands before first BFSI go-live.

**Acceptance criteria:** As in initial document. Library's `verify`, `verifyBatch`, `recordConsent`, `revoke`, `triggerDeletion` methods must target the endpoints from G-037, G-038, G-039, G-040.

**Effort:** 1 week · **Dependencies:** G-036, G-037, G-038, G-039, G-040 · **Owner:** Founder

---

### G-003 — Python client library *(downgraded to P1)*

Same reasoning as G-002. Acceptance criteria unchanged.

**Effort:** 1 week · **Dependencies:** G-002 (API convention lockdown) · **Owner:** Founder

---

### G-005 — Zero-Storage mode end-to-end production validation

**Status vs. initial:** Unchanged — column exists, enforcement doesn't (see G-041).

(Criteria as in initial document.) **Effort:** 3 weeks · **Dependencies:** G-006, G-041 · **Owner:** Founder

---

### G-006 — Insulated mode (BYOS) end-to-end validation

**Status vs. initial:** Unchanged. `app/src/lib/storage/sigv4.ts` ships the SigV4 PUT path (ADR-0040); BYOS credential-validation UX and scoped-permission probe are absent.

(Criteria as in initial.) **Effort:** 2 weeks · **Dependencies:** None · **Owner:** Founder

---

### G-007 — Regulatory Exemption Engine — schema + sector templates

**Status vs. initial:** Unchanged. Verification confirms no `regulatory_exemptions` table. BFSI template seed (`20260502000003_bfsi_template_seed.sql`) carries purpose-level retention defaults but not a queryable exemption engine.

(Criteria as in initial.) **Effort:** 3 weeks · **Owner:** Founder

---

### G-008 — Regulatory Exemption Engine — legal review

Unchanged. **Effort:** 2 weeks elapsed · **Dependencies:** G-007 + external counsel · **Owner:** Founder + counsel

---

### G-009 — Batch verification load test at 1M+ identifiers

**Status vs. initial:** Dependency added — cannot load-test an endpoint that does not exist.

(Criteria as in initial.) **Effort:** 1 week · **Dependencies:** G-037 · **Owner:** Founder

---

### G-010 — DEPA fan-out pipeline spike load test

Unchanged. **Effort:** 1 week · **Dependencies:** Staging env · **Owner:** Founder

---

### G-011 — Generic webhook protocol — reference implementation

Unchanged. **Effort:** 2 weeks · **Dependencies:** G-035, willing partner · **Owner:** Founder

---

### G-012 — Notice versioning — minimum re-consent workflow

**Status vs. initial:** Unchanged. `consent_banners.version` exists; `notices` table + `material_change_flag` do not. Confirmed.

(Criteria as in initial.) **Effort:** 3 weeks · **Dependencies:** G-007 · **Owner:** Founder

---

### G-013 — Solutions engineer capacity

Unchanged. **Owner:** Founder

---

### G-014 — Production support model

Unchanged. **Effort:** 2 weeks · **Dependencies:** G-013 · **Owner:** Founder

---

### G-015 — Status page + incident communication infrastructure

Unchanged. **Effort:** 1 week · **Owner:** Founder

---

### G-039 — `/v1/consent/artefacts` list + `/v1/consent/artefacts/{id}/revoke` + `/v1/consent/events` *(new)*

**Whitepaper section:** Appendix A; §11 (core banking stores artefact IDs against customer record)
**Whitepaper claim:** The bank's core banking system stores five artefact IDs against Mrs. Sharma's customer record and revokes one programmatically on 10 March 2026 via `POST /v1/consent/artefacts/cs_art_01HXX2/revoke` (§11, step where Mrs. Sharma opens her banking app).
**Current state:** The admin/customer dashboard can list and revoke artefacts via `/api/orgs/[orgId]/artefacts*` routes. No API-key-authenticated equivalents.
**Target state:** Parity endpoints under `/v1/*` using the same underlying RPCs.

**Acceptance criteria:**
- `GET /v1/consent/artefacts` with filters: `property_id`, `data_principal_identifier`, `status`, `purpose_code`, `expires_before`, `expires_after`, `limit` (max 200), `cursor`
- `GET /v1/consent/artefacts/{id}` returning the full audit trail (artefact + revocation record if any + replaced-by chain)
- `POST /v1/consent/artefacts/{id}/revoke` — body: `{ reason_code, reason_notes?, actor_type: "user" | "operator" | "system" }`; re-uses existing `artefact_revocations` INSERT path (ADR-0022 cascade)
- `GET /v1/consent/events` with date-range filter; returns paged summary (not full payloads) — existing list RPC re-used
- Scope matrix: `read:artefacts` / `write:artefacts` / `read:consent`
- Idempotency: revoking an already-revoked artefact returns `200` with existing `revocation_record_id`, not `409`
- Integration tests, including the §11 end-to-end scenario as a fixture

**Effort:** 1 week · **Dependencies:** G-036 · **Owner:** Founder

---

### G-040 — `POST /v1/deletion/trigger` + `GET /v1/deletion/receipts` list *(new)*

**Whitepaper section:** Appendix A; §6 passing
**Whitepaper claim:** Customers can trigger deletions via API and list receipts programmatically.
**Current state:** `POST /v1/deletion-receipts/[id]` accepts callbacks from customer webhook endpoints (HMAC-signed URL); no inbound trigger endpoint or list endpoint for customers.
**Target state:** Customer-facing endpoints to (a) initiate a deletion orchestration for a data-principal + purpose manually, and (b) page through deletion receipts with filters.

**Acceptance criteria:**
- `POST /v1/deletion/trigger` body: `{ property_id, data_principal, reason: "erasure_request" | "consent_revoked" | "retention_expired", purpose_codes?: [], deadline? }`; creates the right combination of `artefact_revocations` and/or `deletion_receipts` rows
- `GET /v1/deletion/receipts` filters: `status`, `connector_id`, `artefact_id`, `issued_after`, `issued_before`
- Scope matrix: `write:deletion` / `read:deletion`
- Trigger path asserts the principal has at least one matching artefact (unless `reason = erasure_request`, which sweeps)
- Returns receipt IDs synchronously; the dispatch pipeline runs asynchronously as today
- Integration tests

**Effort:** 1 week · **Dependencies:** G-036 · **Owner:** Founder

---

### G-041 — `storage_mode` enforcement at API gateway layer *(new)*

**Whitepaper section:** §2.2 ("Security Rule 9 — a non-negotiable architectural constraint"); §8.1
**Whitepaper claim:** An organisation configured in Zero-Storage mode must never have personal data written to any persistent ConsentShield table.
**Current state:** `accounts.storage_mode` (or `organisations.storage_mode` — verified in migration 20260413000003) exists with `standard | insulated | zero_storage` values; no runtime path inspects it.
**Target state:** Every write path (Worker buffer writes, dashboard RPCs, new `/v1/*` endpoints) consults `storage_mode` and branches to the appropriate persistence strategy.

**Acceptance criteria:**
- Helper: `public.get_storage_mode(p_org_id)` STABLE SQL function, cached per-request
- Worker (`worker/src/events.ts`, `worker/src/observations.ts`) queries mode via a cached KV entry; in `zero_storage`, writes to an ephemeral in-memory queue dispatched straight to the Edge Function rather than `consent_events`
- `process-consent-event` branches: in `zero_storage`, writes `consent_artefact_index` (TTL-bounded, per §2.1) but NOT `consent_artefacts` persistent rows
- `delivery_buffer` in `zero_storage`: a transient memory path with immediate R2 upload, no durable row
- Invariant test: create a zero-storage org, post 1,000 events, assert `SELECT COUNT(*) FROM consent_events WHERE org_id = $1 = 0` and `SELECT COUNT(*) FROM consent_artefacts WHERE org_id = $1 = 0` and `SELECT COUNT(*) FROM delivery_buffer WHERE org_id = $1 = 0`
- Documented gap list: features that degrade under zero-storage (re-export from buffer, historical replay) surfaced in customer onboarding

**Effort:** 1 week (base enforcement) + 2 weeks (full zero-storage data-plane rework absorbed into G-005) · **Dependencies:** None; G-005 depends on this · **Owner:** Founder

---

### G-042 — Healthcare sector template seed *(new)*

**Whitepaper section:** §9.4; §8 (FHIR enumeration); §4.1 sector templates
**Whitepaper claim:** Sector templates ship pre-seeded; a healthcare clinic inherits ABDM/DISHA-aligned purpose definitions on account creation.
**Current state:** Only BFSI template exists (`supabase/migrations/20260502000003_bfsi_template_seed.sql`). ADR-0030 ships the template framework. No healthcare seed.
**Target state:** A healthcare sector template seeded with ABDM-aligned purposes, DISHA retention rules, and connector mappings.

**Acceptance criteria:**
- New migration `<date>_healthcare_template_seed.sql` in `supabase/migrations/`
- Purposes: teleconsultation, prescription dispensing, lab-report access, insurance claim share (ABDM HIU/HIP), appointment reminders, marketing, research (with explicit broad-consent caveat)
- `storage_mode` default `zero_storage` for any org applying the template (per §2.1 mandate)
- Retention rules per DISHA (7 years for clinical records) and Clinical Establishments Act (as applicable per state)
- Connector-mapping defaults: appointment-reminder vendor, EMR vendor placeholder
- Healthcare-bundle onboarding path documented
- Templates panel in admin console (ADR-0030) shows BFSI + Healthcare as published

**Effort:** 1 week · **Dependencies:** G-007 schema alignment preferable but not blocking · **Owner:** Founder

---

### G-045 — Public OpenAPI spec + Appendix A regeneration *(new — CC-A promoted)*

**Whitepaper section:** Appendix A (normative API table)
**Whitepaper claim:** The document lists all compliance-API endpoints authoritatively.
**Current state:** No OpenAPI file in the repository. The whitepaper Appendix A is hand-written and cannot be validated against code.
**Target state:** `openapi.yaml` is the single source of truth; Appendix A is regenerated from it; CI fails if they drift.

**Acceptance criteria:**
- `openapi.yaml` at repo root (or `app/public/openapi.yaml`), covering every `/v1/*` endpoint from G-036, G-037, G-038, G-039, G-040
- Published at `https://api.consentshield.in/openapi.yaml` and referenced from docs
- Script `scripts/regenerate-whitepaper-appendix.ts` emits markdown table from the spec
- CI check: run the regeneration, diff against Appendix A in whitepaper — fail the build on any drift
- Spec covers: auth scheme, scopes, rate tiers, all request/response schemas, error codes
- Dash of client-facing language: cross-references to `docs.consentshield.in` once that lives

**Effort:** 1 week (spec authoring) + ongoing maintenance **Dependencies:** G-036, G-037, G-038, G-039, G-040 must exist first · **Owner:** Founder

---

### G-046 — Sandbox organisation provisioning flow *(new)*

**Whitepaper section:** §12.1, §14 ("A free sandbox organisation can be provisioned within the hour")
**Whitepaper claim:** Every customer account includes a separate sandbox organisation (`org_test_*`) with identical API surface, zero-cost rate limits, and test data principal identifiers.
**Current state:** No sandbox-tagging exists on accounts or orgs; rate tiers are real-money tiers; no test-data-principal generator.
**Target state:** Sandbox orgs are first-class, non-billable, bounded, and isolated from production compliance reporting.

**Acceptance criteria:**
- `accounts.sandbox` boolean column; plan gating does not apply; no billing rows created
- Self-serve provisioning: dashboard button creates `org_test_<nanoid>` with the customer's sector template auto-applied
- Sandbox rate limits: 1,000/hr on every tier, with a "sandbox" banner in the dashboard
- Test data principals: `cs_test_principal_<seq>` generator endpoint (Faker-style) for integration-test scaffolding
- Sandbox audit exports clearly marked; not included in production compliance score
- Documented in a new `docs/customer-docs/sandbox.md`

**Effort:** 1 week · **Dependencies:** G-036 (API keys scoped to sandbox org) · **Owner:** Founder

---

### G-048 — `orphan_consent_events` metric + alert wiring *(new)*

**Whitepaper section:** §3.3, §12.5
**Whitepaper claim:** `orphan_consent_events` counts consent events with `artefact_ids = '{}'` and `created_at > now() - 10 minutes`; any non-zero value fires an alert.
**Current state:** `depa_compliance_metrics.coverage_score` exists; no orphan counter. Safety-net cron (ADR-0021) re-fires the Edge Function; nothing surfaces a metric or alert for persistently orphaned events.
**Target state:** A computed metric + alert wired to the notification channels.

**Acceptance criteria:**
- View `public.vw_orphan_consent_events` returning `(org_id, count)` for rows with `artefact_ids = '{}'` and `created_at between now() - 24h and now() - 10 min`
- pg_cron job (5-min interval) reads the view; writes to `depa_compliance_metrics` with new `orphan_count` column; fires `notification_channels` delivery on any non-zero count
- Dashboard surface: the compliance-health widget (G-034) shows orphan count with drill-down to the affected events and their safety-net retry history
- Integration test: induce a fan-out failure (disable the Edge Function URL temporarily), verify metric + alert fire

**Effort:** 1 week · **Dependencies:** None blocking (G-034 surfaces it) · **Owner:** Founder

---

## P2 — Required for full whitepaper deliverability

All P2 gaps from the initial document stand. New P2 gaps listed below; existing P2 criteria unchanged unless noted.

### G-043 — Non-email notification channels *(new)*

**Whitepaper section:** §7 (Surface 4)
**Whitepaper claim:** Slack, Teams, Discord, PagerDuty, custom webhook — each listed as a supported channel with 5–15 minutes of setup.
**Current state:** `notification_channels` table exists with `jsonb config`; only Resend email delivery path is implemented (`app/src/lib/rights/email.ts`).
**Target state:** Each channel has a delivery adapter, per-severity routing, and an onboarding UI.

**Acceptance criteria:**
- Per-channel adapters in `app/src/lib/notifications/adapters/` (slack, teams, discord, pagerduty, webhook)
- Adapter interface: `deliver(channel, event, severity) → { ok, external_id? }`; retries on 5xx; no retries on 4xx
- Per-channel configuration UI in `/dashboard/settings/notifications` with test-send button
- Severity-to-channel mapping per §7 ("critical → PagerDuty, daily summary → Slack")
- PagerDuty adapter uses Events API v2, not the deprecated v1
- Custom webhook adapter signs the body with the channel's shared secret (new field in `notification_channels.config`)
- Integration tests: one live delivery per adapter to a test destination

**Effort:** 2 weeks · **Dependencies:** None · **Owner:** Founder

---

### G-044 — Audit export CSV-format alignment *(new)*

**Whitepaper section:** §12.4; (implied Appendix)
**Whitepaper claim:** Export is a structured package; the whitepaper's imagery and G-026's spec imply CSV files per entity with a manifest.
**Current state:** ADR-0017 ships a ZIP with JSON sections (one file per entity); ADR-0040 uploads to R2. Format works but does not match the documented external-facing specification that a DPB examiner would expect to find consistently structured.
**Target state:** ZIP contains both manifest + CSV files matching the spec at `docs.consentshield.in/audit-export-spec`.

**Acceptance criteria:**
- Export includes: `manifest.json` (metadata + FK map), `consent_artefacts.csv`, `artefact_revocations.csv`, `deletion_receipts.csv`, `rights_requests.csv`, `processing_logs.csv`, `breaches.csv`, `regulatory_exemptions_applied.csv`
- Existing JSON sections retained under `legacy/*.json` for 6 months for backwards compatibility (then removed)
- Format spec document published
- Large-org benchmark: 1M-artefact export completes in < 60 seconds
- Dashboard export + R2 upload + `/v1/audit/export` all emit the new format

**Effort:** 1 week (reduced from 2 — ADR-0017/0040 did the plumbing; this is format change + spec publication) · **Dependencies:** None · **Owner:** Founder

---

### G-047 — Tracker signature catalogue coverage *(new, residual from G-025)*

**Whitepaper section:** §12.2
**Whitepaper claim:** The probe engine + real-time MutationObserver detect "a minimum of 200 trackers".
**Current state:** ADR-0041 ships the probe runner (Vercel Sandbox + Playwright); ADR-0031 ships the signature-catalogue admin panel. The corpus is not at 200.
**Target state:** Catalogue reaches 200+ fingerprints covering the major Indian MarTech surface area.

**Acceptance criteria:**
- At least 200 tracker signatures in `admin.tracker_signature_catalogue`
- Coverage: all Google (Analytics/Ads/GTM/Firebase), Meta (Pixel, CAPI), MarTech big-ten (Hotjar, Mixpanel, Segment, HubSpot, Salesforce, Adobe, Intercom, Zendesk, Drift, Amplitude), India-specific (CleverTap, WebEngage, MoEngage, NetCore, Hansel), adtech DMPs, fingerprinting libraries
- Each signature: domains, cookie patterns, script URL patterns, classification (ad / analytics / functional / unknown)
- Signatures versioned; deprecation path documented
- Import script from community feeds (Disconnect list, EasyList) for bulk triage

**Effort:** 2 weeks · **Dependencies:** None · **Owner:** Founder or contractor (data curation)

---

### G-049 — Public rights-request API *(new)*

**Whitepaper section:** Appendix A (`/v1/rights/requests` listed)
**Whitepaper claim:** Customers can list and create rights requests programmatically via compliance API.
**Current state:** Public rights-request form under `/api/public/rights-request` (Turnstile + OTP) exists (ADR-0004). No API-key surface.
**Target state:** `GET /v1/rights/requests` (list, filtered) and `POST /v1/rights/requests` (server-initiated, bypasses Turnstile but requires explicit `identity_verified` attestation).

**Acceptance criteria:**
- Endpoints implemented behind G-036 middleware
- `POST` requires the key to have `write:rights` + the body to include `captured_via` and `identity_verified_by` (operator identity); triggers the same workflow as the public path but skips Turnstile + OTP
- `GET` returns paged list with status + SLA + artefact IDs
- Separate audit-log trail marking API-key-created requests for DPB-export filtering
- Integration tests

**Effort:** 1 week · **Dependencies:** G-036 · **Owner:** Founder

---

### Existing P2 gaps (unchanged)

G-016 through G-027 and G-034, G-035 — criteria and effort unchanged from initial document. G-035 dependency adjusted: requires G-036 (API-key middleware) since the endpoint is under `/v1/*`.

---

## P3 — Phase 4 / post-launch hardening

All P3 gaps from the initial document stand unchanged: G-028 (React Native), G-029 (WYSIWYG platform decision), G-030 (Q3 connector batch), G-031 (multi-channel re-consent), G-032 (HMAC rotation), G-033 (SOC 2 Type II).

---

## Closed since the initial document

| ID | Title | Resolution |
|---|---|---|
| G-025 | Consent probe testing infrastructure | Shipped in ADR-0041 (Vercel Sandbox runner + probe CRUD UI). Residual work is signature-catalogue coverage, carved out as G-047. |

---

## Cross-cutting concerns

### CC-A — API surface alignment with whitepaper claims

**Promoted to G-045.** The CI check becomes the enforcement mechanism.

### CC-B — Documentation consistency

Unchanged. PR template checkbox: "Whitepaper / Architecture / Schema docs updated where affected."

### CC-C — Testing coverage standards

Unchanged.

### CC-D — Security review cadence

Unchanged. Note that G-036 (API-key system) is a new attack surface and warrants a targeted review in addition to the quarterly pen test.

### CC-E — Schema migration discipline

Unchanged.

### CC-F — Whitepaper-as-normative-spec *(new)*

The v2.0 whitepaper is now the customer-facing normative specification for the compliance-API surface. Any ADR that changes a `/v1/*` shape must be paired with a whitepaper amendment (or an errata note) before the ADR is marked Completed. The initial and this revised gap document are the transition artefacts; once G-045's CI check is in place, drift is caught automatically.

---

## Revised sequencing — critical path to BFSI / Healthcare deliverability

### Sprint 1 (Weeks 1–2): Marketing accuracy + public API foundation

- G-001 (catalogue accuracy) — 0.5 day
- G-004 (operational-maturity appendix) — 1 day
- **G-036 (public API scaffolding) — 2 weeks** — the critical-path P0 addition

### Sprint 2 (Weeks 3–4): Verification + record endpoints

- **G-037 (verify + batch) — 2 weeks**
- **G-038 (record) — 1.5 weeks (overlaps with G-037)**

At end of Sprint 2: the whitepaper's core architectural promise for BFSI (verify consent before acting on data) is executable. This is the earliest possible moment the v2.0 whitepaper can be distributed to a BFSI prospect without misrepresentation.

### Sprint 3 (Weeks 5–7): Storage-mode enforcement + Zero-Storage + batch-verify load test

- **G-041 (storage_mode enforcement) — 1 week**
- G-005 (Zero-Storage E2E) — 3 weeks (starts week 5, overlaps with Sprint 4)
- G-006 (Insulated BYOS) — 2 weeks (starts week 5, parallel)
- G-009 (batch-verify load test) — 1 week (week 7)
- G-010 (DEPA spike load test) — 1 week (week 7, parallel)

### Sprint 4 (Weeks 8–10): Regulatory engine + reference webhook partner + healthcare seed

- G-007 (regulatory exemption engine) — 3 weeks
- G-008 (legal review) — 2 weeks (parallel, started week 8)
- G-011 (generic webhook reference partner) — 2 weeks (parallel, started week 9)
- G-035 (`test_delete`) — 1 week (week 8)
- **G-042 (healthcare seed) — 1 week (week 10)**
- G-046 (sandbox provisioning) — 1 week (week 10, parallel)

### Sprint 5 (Weeks 11–13): Artefact API + deletion API + notice versioning + support

- **G-039 (`/v1/consent/artefacts` + revoke + events) — 1 week**
- **G-040 (`/v1/deletion/trigger` + receipts list) — 1 week (parallel)**
- G-012 (re-consent workflow) — 3 weeks
- **G-048 (orphan metric + alert) — 1 week (parallel)**
- G-014 (support model + tooling) — 2 weeks (parallel, started week 11)
- G-013 (SE capacity hire) — background
- G-015 (status page) — 1 week (parallel)
- G-034 (compliance-health widget) — 2 weeks (parallel, weeks 12–13)

### Sprint 6 (Weeks 14–15): Client libraries + OpenAPI + rights API

- G-002 (Node.js library) — 1 week
- G-003 (Python library) — 1 week (parallel)
- **G-045 (OpenAPI spec + CI check) — 1 week (parallel)**
- **G-049 (`/v1/rights/requests`) — 1 week (week 15)**

### After Sprint 6 (Week 16+): P2 connector buildout, format alignment, observation hardening

Connectors G-016–G-021 (~10 weeks total, demand-sequenced), plugins G-022/G-023 (~5 weeks parallel), G-024 Java/Go libraries (2 weeks), G-026 DPB export packaging (1.5 weeks), G-027 verify SLO infra (2 weeks), G-043 notification channels (2 weeks), G-044 audit-export CSV alignment (1 week), G-047 tracker signatures (2 weeks).

---

## Revised critical-path summary

- **To whitepaper defensibly distributable to a BFSI prospect (no active misrepresentation):** End of Sprint 2 = **~4 weeks** from Sprint 1 start. This is the earliest moment `/v1/consent/verify` exists, which is the single load-bearing promise in §5 and §11.
- **To first BFSI Enterprise customer signature (with Operational Maturity appendix in hand):** End of Sprint 2 + contract negotiations = ~6 weeks.
- **To first BFSI Enterprise customer go-live:** End of Sprint 6 = **~15 weeks** from Sprint 1 start. This adds 2 weeks over the initial document's 13-week estimate — the public API was underspecified previously.
- **Beyond that:** P2 / P3 is customer-demand-driven and can absorb contractor capacity in parallel once G-013 is closed.

**Two simultaneous BFSI Enterprise customers** remains infeasible under the critical path without G-013 capacity addition landing during Sprints 3–5.

---

## Document maintenance

Update this document on the following triggers:

- Any gap closes → mark as **Closed** with date and ADR / PR reference (move out of the active list, into the "Closed since" table)
- New gap discovered → append as G-NNN with the next sequential ID and appropriate band
- Whitepaper revised → re-run the verification sweep, produce a new revision
- Quarterly review → re-prioritise based on pipeline and capacity

*Revision 2 · 2026-04-19 · Next scheduled review: after Sprint 2 closes (expected mid-May 2026), which is the first closure-of-a-P0-gap checkpoint under the revised plan.*
