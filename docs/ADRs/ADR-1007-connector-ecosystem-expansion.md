# ADR-1007: Connector Ecosystem Expansion + Platform Plugins

**Status:** Proposed
**Date proposed:** 2026-04-19
**Date completed:** —
**Related plan:** `docs/plans/ConsentShield-V2-Whitepaper-Closure-Plan.md` Phase 7
**Depends on:** ADR-1002 (deletion API), ADR-1004 (regulatory exemption engine for G-017), ADR-1006 (library conventions useful but not blocking)
**Related gaps:** G-016, G-017, G-018, G-019, G-020, G-021, G-022, G-023, G-030

---

## Context

Appendix D of the whitepaper lists 11 connectors as "Shipping" and 5 more as "Q3 2026". ADR-1001 Sprint 1.1 has since corrected the marketing surface — only Mailchimp and HubSpot are truthfully Shipping — but the real work remains: shipping the other 9 connectors plus the WordPress and Shopify platform plugins so the customer-facing statement becomes true.

Two things set this ADR apart from everything else in the plan:

1. **It is demand-driven, not sequence-driven.** The order of connector delivery should follow the customer-pipeline signal, not a fixed engineering roadmap. A BFSI prospect asking for CleverTap first should get CleverTap first; a retail prospect asking for Shopify first should get Shopify first. The sprint order below is a *default* — the ADR's adoption should be flexible on ordering within the constraint that every connector follows established patterns (G-016 as template).
2. **It absorbs contractor capacity well.** Every connector after G-016 is a pattern instance — OAuth flow, dashboard entry, deletion API call, retry/backoff, error handling, test against real partner sandbox. A capable contractor can ship 1–2 per week against a clear spec.

## Decision

Ship 11 connectors + 2 platform plugins in the order below, subject to re-prioritisation from the customer pipeline:

1. **CleverTap (G-016)** — India BFSI/B2C heavyweight; highest customer demand signal.
2. **Razorpay anonymisation (G-017)** — critical for PMLA-aware deletion; depends on ADR-1004's Regulatory Exemption Engine.
3. **WebEngage + MoEngage (G-018)** — complete the India engagement platform tier.
4. **Intercom + Freshdesk (G-019)** — support tooling; common ask across SaaS and BFSI.
5. **Shopify + WooCommerce (G-020)** — e-commerce tier with non-OAuth auth patterns.
6. **Segment (G-021)** — CDP; multi-day async deletion status handling (new pattern).
7. **WordPress plugin (G-022)** — long-tail Indian SMB market; banner-install convenience.
8. **Shopify App Store plugin (G-023)** — Shopify-native install path for e-commerce customers.
9. **Q3 2026 connector batch (G-030)** — Zoho CRM, Freshworks CRM, Zendesk, Campaign Monitor, Mixpanel; P3 priority.

Every connector ships with the same contract: OAuth (or auth scheme appropriate to the platform), dashboard entry under `/dashboard/integrations`, deletion API call on revocation, retry + token refresh + rate-limit handling, an integration test against a real partner sandbox account, and a customer-facing setup guide.

## Consequences

- Appendix D becomes truthful in stages. After each sprint, the corresponding row moves from "Q3 2026" to "Shipping today" in the whitepaper (per CC-F).
- Each connector carries a permanent supply-chain footprint (an OAuth app registration with each vendor). Rotation + ownership is tracked in a new `docs/runbooks/connector-credentials.md`.
- G-017 (Razorpay) is the first connector that exercises the Regulatory Exemption Engine end-to-end. If ADR-1004 hasn't shipped, G-017 slips to after ADR-1004 completes.
- G-022 (WordPress) and G-023 (Shopify App Store) introduce non-engineering overhead: plugin-directory reviews, App Store approval cycles, localisation for Hindi (WordPress), pricing-model decision for Shopify.
- Contractor capacity can parallelise this phase. Founder focuses on pattern templates (G-016 as the reference); contractors pick up G-018 onwards.

---

## Implementation Plan

### Phase 1: Connector batch (G-016 → G-021)

#### Sprint 1.1: CleverTap connector (G-016)

**Estimated effort:** 1 week

**Deliverables:**
- [ ] OAuth app registered with CleverTap; CS app approved
- [ ] Dashboard setup flow under `/dashboard/integrations` → Connect CleverTap → OAuth redirect → active connector
- [ ] Deletion execution: `POST /delete/profiles` invoked with data principal's identifier on artefact revocation
- [ ] Response mapping: success → `deletion_receipts.status='confirmed'`; failure → `failed` with error captured
- [ ] Token refresh logic
- [ ] Rate-limit error handling
- [ ] Customer setup guide at `docs/customer-docs/connectors/clevertap.md`
- [ ] Integration test against real CleverTap test account
- [ ] Whitepaper Appendix D updated to show CleverTap as Shipping

**Testing plan:**
- [ ] End-to-end deletion against test account → confirmed
- [ ] Token-refresh path exercised
- [ ] Rate-limit response → retry with backoff

**Status:** `[ ] planned`

#### Sprint 1.2: Razorpay anonymisation (G-017)

**Estimated effort:** 1 week

**Deliverables:**
- [ ] OAuth setup with Razorpay
- [ ] `POST /customers/{id}/anonymize` on deletion
- [ ] **PMLA integration**: before invocation, consult Regulatory Exemption Engine (ADR-1004) for PMLA retention rules; transaction records explicitly retained, only PII fields anonymised
- [ ] Customer documentation explains the PMLA-compliant pattern
- [ ] `docs/customer-docs/connectors/razorpay.md`
- [ ] Integration test
- [ ] Appendix D updated

**Testing plan:**
- [ ] Deletion invocation against a test Razorpay account anonymises PII fields; transaction history remains
- [ ] `retention_suppressions` row created for PMLA-retained categories

**Status:** `[ ] planned`

#### Sprint 1.3: WebEngage + MoEngage (G-018)

**Estimated effort:** 2 weeks (1 each)

**Deliverables:**
- [ ] WebEngage: `DELETE /users/{id}` adapter; OAuth; retry; token refresh; dashboard entry; customer guide; integration test
- [ ] MoEngage: `DELETE /v1/customer/{id}` adapter; same pattern
- [ ] Appendix D updated after each lands

**Testing plan:**
- [ ] Live deletion against each test account

**Status:** `[ ] planned`

#### Sprint 1.4: Intercom + Freshdesk (G-019)

**Estimated effort:** 2 weeks

**Deliverables:**
- [ ] Intercom: `POST /user_delete_requests`; OAuth; full pattern
- [ ] Freshdesk: `PUT /api/v2/contacts/{id}` (anonymise); OAuth; full pattern
- [ ] Customer guides + integration tests
- [ ] Appendix D updated

**Testing plan:**
- [ ] Live deletion against each test account

**Status:** `[ ] planned`

#### Sprint 1.5: Shopify + WooCommerce (G-020)

**Estimated effort:** 2 weeks

**Deliverables:**
- [ ] Shopify: `DELETE /customers/{id}` via REST Admin API (app-install auth pattern — not pure OAuth)
- [ ] WooCommerce: `POST /customers/{id}/anonymize` via consumer-key/secret auth
- [ ] Both adapt the connector-auth abstraction for non-OAuth schemes
- [ ] Customer guides + integration tests against test stores
- [ ] Appendix D updated

**Testing plan:**
- [ ] Live deletion against a test Shopify store + a test WooCommerce store

**Status:** `[ ] planned`

#### Sprint 1.6: Segment (G-021)

**Estimated effort:** 1 week

**Deliverables:**
- [ ] `POST /regulations` with `regulationType: "Suppress_With_Delete"`
- [ ] API-key auth (not OAuth)
- [ ] Polling for regulation-completion status (Segment's deletion is async, takes hours/days)
- [ ] Receipt status transitions: `pending` → `accepted` (Segment received) → `confirmed` (Segment completed) over time
- [ ] Polling job `poll-segment-regulations` via pg_cron
- [ ] Customer documentation explains the multi-day timeline
- [ ] Appendix D updated

**Testing plan:**
- [ ] End-to-end regulation creation + status polling + confirmation

**Status:** `[ ] planned`

### Phase 2: Platform plugins (G-022 + G-023)

#### Sprint 2.1: WordPress plugin (G-022)

**Estimated effort:** 2 weeks

**Deliverables:**
- [ ] Plugin installs on WordPress 6.0+, PHP 7.4+; tested vs WooCommerce
- [ ] Settings page for org_id + property_id; injects banner script in `<head>`
- [ ] Dashboard widget showing compliance status via `/v1/consent/score`
- [ ] One-click Disconnect
- [ ] Localised in English + Hindi
- [ ] Setup screencast + troubleshooting guide
- [ ] Submitted + approved on WordPress.org Plugin Directory
- [ ] Whitepaper §4.1 updated

**Testing plan:**
- [ ] Fresh WordPress install → install plugin → configure → banner visible → consent event in CS
- [ ] Disconnect path clears configuration + removes script tag

**Status:** `[ ] planned`

#### Sprint 2.2: Shopify App Store plugin (G-023)

**Estimated effort:** 3 weeks (inc. App Store approval cycle)

**Deliverables:**
- [ ] Shopify Partners account + app built with Shopify CLI / Remix template
- [ ] OAuth install → Shopify Script Tag API injects banner
- [ ] Mandatory App Store requirements: GDPR webhooks, embedded UI, Billing API
- [ ] App Store listing with screenshots, demo store, review materials
- [ ] Approval received
- [ ] Pricing model decided: free with ConsentShield account / freemium
- [ ] Whitepaper §4.1 updated

**Testing plan:**
- [ ] Install on a test Shopify store → banner visible → consent event in CS
- [ ] GDPR webhook tests pass Shopify's automated review

**Status:** `[ ] planned`

### Phase 3: Q3 2026 connector batch (G-030)

#### Sprint 3.1: Zoho CRM + Freshworks CRM + Zendesk + Campaign Monitor + Mixpanel

**Estimated effort:** 4 weeks (≈ 4 days each with established patterns)

**Deliverables:**
- [ ] Zoho CRM: `DELETE /crm/v2/Contacts/{id}`
- [ ] Freshworks CRM: `DELETE /contacts/{id}`
- [ ] Zendesk: `POST /api/v2/users/{id}/deletions`
- [ ] Campaign Monitor: `DELETE /subscribers.json`
- [ ] Mixpanel: `POST /api/2.0/gdpr-requests`
- [ ] All follow G-016 pattern; each lands its own Appendix D update
- [ ] Sequenced by customer demand (reorder as signal emerges)

**Testing plan:**
- [ ] Per-connector integration test against real test account

**Status:** `[ ] planned`

---

## Architecture Changes

- No architectural change — these are pattern instances of the existing deletion-orchestration surface (ADR-0007 + ADR-0039).
- `docs/runbooks/connector-credentials.md` — new operational runbook for rotating per-connector OAuth apps / API keys.

_None yet._

---

## Test Results

_Empty until Sprint 1.1 runs._

---

## V2 Backlog (explicitly deferred)

- Salesforce, Klaviyo, ActiveCampaign, Sendinblue — future ADRs on customer signal.
- Custom-connector builder UI (customer builds their own connector without a ConsentShield engineer) — considered too advanced for v1; defer.
- Bank-specific connectors (bancassurance APIs, co-lending, bureau reporting APIs) — delivered as per-customer BFSI Enterprise engagement rather than catalogue connectors.

---

## Changelog References

- `CHANGELOG-api.md` — each connector sprint
- `CHANGELOG-dashboard.md` — each sprint adds an integrations-panel entry
- `CHANGELOG-docs.md` — each sprint adds a customer-docs page + Appendix D update
- External: plugin directory listings for WordPress + Shopify
