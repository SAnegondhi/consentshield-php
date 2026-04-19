# ADR-1008: Scale + Audit Polish + P3 Hardening

**Status:** Proposed
**Date proposed:** 2026-04-19
**Date completed:** —
**Related plan:** `docs/plans/ConsentShield-V2-Whitepaper-Closure-Plan.md` Phase 8
**Depends on:** ADR-1002 (API endpoints to load-test), ADR-1005 (status page + support model for SLO publishing), ADR-1004 (notice versioning — prerequisite for multi-channel re-consent)
**Related gaps:** G-009, G-010, G-026, G-027, G-031, G-032, G-033, G-044, G-047, G-028, G-029

---

## Context

By end of ADR-1007, the v2.0 whitepaper is truthful in every claim. This ADR delivers the final polish: load-test evidence, latency SLO infrastructure, DPB-format audit export packaging, 200+ tracker-signature coverage, and the P3 items (multi-channel re-consent, HMAC secret rotation, SOC 2 Type II, React Native component, WYSIWYG plugin decision).

Two threads run in parallel here:

1. **Scale & evidence** — load tests, latency SLO, audit-export format alignment, tracker signatures. These convert qualitative claims ("sub-50ms p99", "DPB-format export") into measured, published, verifiable evidence.
2. **P3 hardening** — items the whitepaper defers to Phase 4 or post-launch. They are here for completeness and because some (HMAC rotation, SOC 2 observation start) are blocking for specific customer conversations that happen to come up mid-roadmap.

This ADR is the only one with high parallelism potential — every sprint is independent.

## Decision

Ship eleven items across three parallel phases:

**Scale + evidence (P2):**
1. **G-009** — 1M+ identifier batch-verify load test; documented SLO per tier.
2. **G-010** — DEPA fan-out spike load test; documented event-to-artefact SLO.
3. **G-026** — DPB-format audit export packaging (manifest + CSVs) — **already partially delivered by ADR-1004 for suppressions; this sprint completes the rest.**
4. **G-027** — sub-50ms verify p99 SLO continuous measurement; Cloudflare KV edge cache if needed.
5. **G-044** — Audit export CSV-format alignment (ties with G-026).
6. **G-047** — tracker signature catalogue expanded to 200+ fingerprints.

**P3 hardening:**
7. **G-028** — React Native consent component (drop-in modal + ABHA QR scanner).
8. **G-029** — Webflow / Wix / Framer / Squarespace plugin decision + execution.
9. **G-031** — re-consent campaign multi-channel delivery (email + SMS + WhatsApp + push).
10. **G-032** — HMAC secret rotation with dual-window acceptance.
11. **G-033** — SOC 2 Type II audit observation period — verify start, adjust timeline.

## Consequences

- Every numeric claim in the whitepaper (sub-50ms p99, batch-verify at 12M customers, fan-out SLO) is backed by a published load-test report.
- The audit export format is stable, documented, and ready for DPB submission format alignment when DPB publishes specifications.
- Tracker detection meaningfully covers the Indian MarTech surface area.
- Re-consent workflows become self-sufficient — customers can run campaigns from within ConsentShield without wiring external SMS/email gateways.
- HMAC rotation removes a long-tail supply-chain risk.
- SOC 2 Type II observation period, once confirmed-started, gives a realistic delivery date and removes whitepaper ambiguity.
- Customer-side React Native teams have a drop-in, saving 3–4 weeks of integration work per customer.

---

## Implementation Plan

### Phase 1: Scale & evidence (G-009, G-010, G-027)

#### Sprint 1.1: Batch-verify load test (G-009)

**Estimated effort:** 1 week

**Deliverables:**
- [ ] k6 (or Artillery) load-test suite in `tests/load/batch-verify.ts`
- [ ] Staging `consent_artefact_index` populated to 50M+ rows (fixture data, sandbox-safe)
- [ ] Scenario: 100 concurrent batch calls × 10k identifiers × 10 minutes
- [ ] Measured: p50 / p95 / p99 per batch; error rate; DB CPU + connection saturation; Worker subrequest exhaustion
- [ ] Report at `docs/benchmarks/batch-verify-1M-2026-Q3.md` with plots
- [ ] Per-tier rate limits adjusted to observed sustainable throughput
- [ ] Customer-facing doc updated with batching guidance for 10M+ reconciliations

**Testing plan:**
- [ ] Report captures baseline; any regression in future CI runs fails the SLO
- [ ] If p99 > 50ms: follow-on work tracked as a separate gap (edge caching)

**Status:** `[ ] planned`

#### Sprint 1.2: DEPA fan-out spike load test (G-010)

**Estimated effort:** 1 week

**Deliverables:**
- [ ] Load-test scenario: 50k consent events / 12h × 5 artefacts
- [ ] Measured: trigger fire rate, Edge Function execution time, validity cache UPSERT contention, safety-net cron latency, end-to-end event-to-artefact distribution
- [ ] SLO set: 99% of events have artefacts within 30 s
- [ ] Orphan detection verified at scale (safety net catches trigger failures within 10 min)
- [ ] Idempotency verified: replayed consent_event_id → 0 duplicates
- [ ] Report at `docs/benchmarks/depa-fanout-spike-2026-Q3.md`
- [ ] Whitepaper §3.3 amended with the SLO

**Testing plan:**
- [ ] Report captures baseline
- [ ] Regression CI integration deferred (track as separate gap)

**Status:** `[ ] planned`

#### Sprint 1.3: Verify p99 SLO — measurement + edge cache (G-027)

**Estimated effort:** 2 weeks

**Deliverables:**
- [ ] Synthetic verify probes from four Indian regions (Mumbai, Hyderabad, Bangalore, Delhi) every minute
- [ ] Latency dashboard p50/p95/p99 over rolling 24h / 7d / 30d
- [ ] If SLO not consistently met: Cloudflare KV-backed validity cache replicated from Postgres with TTL invalidation on revocation events
- [ ] Public latency SLO published; current performance shown on status page (ADR-1005 G-015)
- [ ] BFSI Enterprise contracts reference the SLO

**Testing plan:**
- [ ] 7-day measurement window shows p99 < 50ms consistently
- [ ] Revocation invalidates cache within 1s

**Status:** `[ ] planned`

### Phase 2: Audit export format + tracker corpus (G-026, G-044, G-047)

#### Sprint 2.1: Audit export CSV alignment + DPB packaging (G-044 + G-026)

**Estimated effort:** 2 weeks

**Deliverables:**
- [ ] Export ZIP reformatted: `manifest.json` + `consent_artefacts.csv`, `artefact_revocations.csv`, `deletion_receipts.csv`, `rights_requests.csv`, `processing_logs.csv`, `breaches.csv`, `regulatory_exemptions_applied.csv`, `retention_suppressions.csv` (from ADR-1004)
- [ ] Legacy JSON sections retained under `legacy/*.json` for 6 months; removed after
- [ ] Format spec published at `docs.consentshield.in/audit-export-spec`
- [ ] 1M-artefact export benchmark: < 60 s
- [ ] Dashboard + R2 upload + `/v1/audit/export` all emit the new format
- [ ] Whitepaper §12.4 amended with "structured format ready for regulatory submission; will align with DPB specs when published"

**Testing plan:**
- [ ] Sample export validates against the schema spec
- [ ] 1M-artefact benchmark captured
- [ ] Legacy format still loadable for 6-month overlap

**Status:** `[ ] planned`

#### Sprint 2.2: Tracker signature catalogue to 200+ (G-047)

**Estimated effort:** 2 weeks

**Deliverables:**
- [ ] ≥ 200 signatures in `admin.tracker_signature_catalogue`
- [ ] Coverage families: Google (Analytics, Ads, GTM, Firebase), Meta (Pixel, CAPI), MarTech big-ten (Hotjar, Mixpanel, Segment, HubSpot, Salesforce, Adobe, Intercom, Zendesk, Drift, Amplitude), India-specific (CleverTap, WebEngage, MoEngage, NetCore, Hansel), ad DMPs, fingerprinting libs
- [ ] Each signature: domains, cookie patterns, script URL patterns, classification (ad / analytics / functional / unknown)
- [ ] Versioned + deprecation path documented
- [ ] Import script `scripts/import-tracker-signatures.ts` from Disconnect list + EasyList for bulk triage

**Testing plan:**
- [ ] Fresh banner load on a site with 10 known trackers → all 10 detected
- [ ] Import-script round-trip reproduces a known corpus

**Status:** `[ ] planned`

### Phase 3: P3 hardening (parallel sprints)

#### Sprint 3.1: HMAC secret rotation (G-032)

**Estimated effort:** 1 week

**Deliverables:**
- [ ] Dashboard action "Rotate webhook secret" per connector
- [ ] Dual-secret window: both old + new accepted for configurable period (default 7 days)
- [ ] Customer doc: when to rotate, how to update their endpoint
- [ ] Notification on rotation start + old-secret retirement
- [ ] Audit-log captures rotation

**Testing plan:**
- [ ] Rotate → old secret still accepted for 7 days → new secret works immediately → old stops after window

**Status:** `[ ] planned`

#### Sprint 3.2: Re-consent multi-channel delivery (G-031)

**Estimated effort:** 4 weeks

**Deliverables:**
- [ ] Email (Resend — existing), SMS (MSG91 or Twilio), WhatsApp (Razorpay / Gupshup), in-app push (FCM) adapters
- [ ] Per-campaign channel choice UI
- [ ] Templates per channel with merge fields (customer name, principal name, re-consent link)
- [ ] Tracking: delivery + open (where supported) + click-through
- [ ] Hosted re-consent page branded per customer; shows new notice; captures consent; produces new artefact
- [ ] Whitepaper §4.3 amended

**Testing plan:**
- [ ] Campaign sends to 100 principals across 4 channels; delivery rate tracked; re-consents correctly chain via `replaced_by`

**Status:** `[ ] planned`

#### Sprint 3.3: SOC 2 Type II observation verification (G-033)

**Estimated effort:** Process + audit cost (₹15–25 lakh)

**Deliverables:**
- [ ] Auditor engaged with signed letter
- [ ] Observation period start date confirmed; evidence collection underway
- [ ] Realistic delivery date set (likely Q1 2027)
- [ ] Whitepaper §14 + Operational Maturity appendix (ADR-1001 G-004) updated with the realistic date
- [ ] If Q4 2026 infeasible: soften to "Type I available; Type II in progress, expected H1 2027"

**Testing plan:**
- [ ] Engagement letter signed + stored
- [ ] Observation-period start date captured in tracker

**Status:** `[ ] planned`

#### Sprint 3.4: React Native component (G-028)

**Estimated effort:** 3 weeks

**Deliverables:**
- [ ] `@consentshield/react-native` on npm
- [ ] `<ConsentShieldModal orgId="..." propertyId="..." purposes={[...]} onConsentRecorded={fn} />` drop-in
- [ ] Themeable via prop (matches host app's design tokens)
- [ ] ABHA QR scanner (camera permission handled)
- [ ] Internally calls `/v1/consent/record`
- [ ] Tested on iOS + Android with Expo and bare React Native
- [ ] Whitepaper §4.2 updated

**Testing plan:**
- [ ] Fresh Expo project → install → render modal → consent flows → artefact visible in ConsentShield dashboard

**Status:** `[ ] planned`

#### Sprint 3.5: WYSIWYG plugin decision + execution (G-029)

**Estimated effort:** 0.5 day decision + variable

**Deliverables:**
- [ ] Per-platform decision documented: Webflow / Wix / Framer / Squarespace → Build / Instructions / Remove
- [ ] For Build: scoped as separate gaps (likely G-050, G-051 depending on decisions)
- [ ] For Instructions: per-platform setup guide at `docs/customer-docs/install-webflow.md` etc.
- [ ] For Remove: whitepaper §4.1 updated to remove the platform
- [ ] Decision factors: market share in target base, engineering effort, support burden

**Testing plan:**
- [ ] Decision document reviewed
- [ ] Any Instructions path self-tested against a scratch account

**Status:** `[ ] planned`

---

## Architecture Changes

- `docs/architecture/consentshield-definitive-architecture.md`: document the edge-cache pattern (if implemented in Sprint 1.3)
- `docs/architecture/consentshield-testing-strategy.md`: add load-test methodology + SLO regression policy
- `docs/benchmarks/` — new directory housing reports

_None yet._

---

## Test Results

_Empty until Sprint 1.1 runs._

---

## V2 Backlog (explicitly deferred post-this-ADR)

- Predictive capacity planning (auto-scale triggers from observed growth) — Phase 4+.
- Customer-side benchmark tooling (give customers a load-test harness to validate their own rate tier) — on request.
- Tracker signature community contribution workflow — if community demand emerges.

---

## Changelog References

- `CHANGELOG-api.md` — Sprints 1.3, 3.1, 3.2
- `CHANGELOG-schema.md` — Sprint 2.1 (format change), Sprint 3.2 (campaign tracking)
- `CHANGELOG-dashboard.md` — Sprints 1.3, 2.1, 3.1, 3.2
- `CHANGELOG-infra.md` — Sprint 1.3 (Cloudflare KV edge cache)
- `CHANGELOG-docs.md` — Sprint 1.1, 1.2, 2.1 benchmark reports; Sprint 3.3, 3.4, 3.5 docs
