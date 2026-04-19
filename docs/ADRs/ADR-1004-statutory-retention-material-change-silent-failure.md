# ADR-1004: Statutory Retention + Material-Change Re-consent + Silent-Failure Detection

**Status:** Proposed
**Date proposed:** 2026-04-19
**Date completed:** —
**Related plan:** `docs/plans/ConsentShield-V2-Whitepaper-Closure-Plan.md` Phase 4
**Depends on:** ADR-1002 (artefacts have a real API surface for the workflows to hit)
**Related gaps:** G-007, G-008, G-012, G-048, G-034

---

## Context

The whitepaper's BFSI and healthcare sections repeatedly lean on three assumptions that are not yet implementable:

1. **Statutory retention is discoverable.** §9.2, §9.3, §11, and §6.3 all describe a Regulatory Exemption Engine that, given `(sector, data_category, statute)`, decides whether a deletion can proceed or must be suppressed with a citation. The BFSI template seed carries purpose-level retention *hints*, but no queryable engine exists. Consequence: the deletion orchestrator cannot honestly answer *"delete marketing but retain KYC"* — the single most important BFSI behaviour.
2. **Material notice changes trigger re-consent.** §4.3 describes a workflow where a material notice change enumerates affected artefacts and surfaces a re-consent campaign. No `notices` table exists; `consent_banners.version` is the only versioning artefact. Consequence: every customer who updates a privacy notice over the product's lifetime silently orphans their active artefacts' `notice_version` reference.
3. **Fan-out silent failure is observable.** §3.3 and §12.5 describe an `orphan_consent_events` metric that fires an alert on any non-zero value. `depa_compliance_metrics.coverage_score` exists; the orphan metric does not. Consequence: if the Edge Function or dispatch trigger fails for any reason (a common scenario during migrations or Supabase gateway hiccups), artefacts are silently missing for the duration of the failure, and the DPDP §8(6) "reasonable security safeguards" standard is quietly broken.

This ADR delivers the three together because they share the same consumer: the Compliance Health dashboard widget (G-034) surfaces retention suppressions, re-consent campaigns, and orphan counts in a single operator-facing view.

## Decision

Ship four capabilities in a single phase:

1. **Regulatory Exemption Engine (G-007)** — a `public.regulatory_exemptions` table with platform defaults for BFSI (5 statutes) and Healthcare (3 statutes), consulted by the deletion orchestrator before any artefact-scoped deletion proceeds. Per-org overrides supported. Compliance dashboard surfaces "X records retained under <statute>" with drill-down.
2. **Legal review (G-008)** — engage an Indian regulatory lawyer (BFSI focus + healthcare focus, one firm or two) to review the default mappings; reviewer notes and dates captured per row; re-review process documented.
3. **Notice versioning + minimum re-consent workflow (G-012)** — `public.notices` table; `material_change_flag` publication triggers enumeration of affected active artefacts; CSV export for customer messaging; `replaced_by` chain populated on re-consent; audit trail of campaign reach.
4. **Orphan metric + alert wiring (G-048)** — view `vw_orphan_consent_events`; pg_cron computes + writes to `depa_compliance_metrics.orphan_count`; non-zero fires the notification channels.

Compliance Health widget (**G-034**) surfaces all four (coverage, orphan, overdue deletions, upcoming expiries) as the operator's single compliance-health view.

## Consequences

- BFSI deletion behaviour becomes correct-by-default. A bancassurance marketing artefact's revocation propagates; a bureau-reporting artefact's revocation does not (CICRA retention), without customer code.
- The audit export gets a new section: `regulatory_exemptions_applied.csv` shows every suppression with statute, data category, affected artefact ID, and counselor's note. This directly supports the DPB-defensible audit chain promise in §12.4.
- Material-change re-consent is operationalised at minimum viable scope. Multi-channel delivery (email + SMS + WhatsApp + push) is deferred to G-031 in ADR-1008 — the v1 workflow is CSV export + customer-owned messaging.
- Silent fan-out failure becomes impossible-to-miss. The orphan alert is the safety-net for the safety-net (ADR-0021 already has a cron that re-fires; this ADR alerts the operator when even that fails to converge).
- The legal review adds a real cost (₹2–3 lakh) and a real external-dependency lead time. Plan must absorb this; Sprint 1.2 is concurrent but may slip the phase exit by up to 2 weeks.

---

## Implementation Plan

### Phase 1: Regulatory Exemption Engine (G-007 + G-008)

#### Sprint 1.1: Schema + RLS

**Estimated effort:** 1 day

**Deliverables:**
- [ ] Migration `<date>_regulatory_exemptions.sql`:
  - `public.regulatory_exemptions`: `id`, `org_id` (nullable for platform defaults), `sector`, `statute`, `data_category`, `retention_period`, `source_citation`, `precedence`, `applies_to_purposes text[]`, `legal_review_notes`, `reviewed_at`, `reviewer_name`, `reviewer_firm`, `created_at`, `updated_at`
  - RLS: platform defaults (org_id null) visible to all; per-org rows only to that org
- [ ] Helper function `public.applicable_exemptions(p_org_id, p_purpose_code)` returning the precedence-sorted rule list
- [ ] Down-migration tested

**Testing plan:**
- [ ] RLS: org A creates an override, org B does not see it
- [ ] Precedence: per-org row wins over platform default for the same `(sector, statute, data_category)` tuple

**Status:** `[ ] planned`

#### Sprint 1.2: BFSI platform defaults + legal engagement kickoff

**Estimated effort:** 1 day engineering + external legal work initiated in parallel

**Deliverables:**
- [ ] Migration `<date>_regulatory_exemptions_bfsi_seed.sql` with rows for:
  - RBI KYC Master Directions (10-year retention post account closure)
  - PMLA (5-year retention of transaction records)
  - Banking Regulation Act (8 years customer correspondence)
  - Credit Information Companies Regulation Act — CICRA (7 years credit data)
  - Insurance Act § 64VB (policy-term + 10 years)
- [ ] Initial `source_citation` per row linking to the official notification
- [ ] Legal firm engagement letter drafted + sent; target ₹2-3 lakh budget

**Testing plan:**
- [ ] Seed rows present in a fresh DB
- [ ] `applicable_exemptions('<bfsi_org>', 'bureau_reporting')` returns the CICRA rule

**Status:** `[ ] planned`

#### Sprint 1.3: Healthcare platform defaults

**Estimated effort:** 1 day

**Deliverables:**
- [ ] Migration `<date>_regulatory_exemptions_healthcare_seed.sql` with rows for:
  - DISHA (7-year retention of clinical records)
  - ABDM guidelines (consent artefacts retention aligned with health record retention)
  - Clinical Establishments Act (as-per-state placeholder with note)

**Testing plan:**
- [ ] Seed rows present; applicable lookup for a healthcare org returns DISHA when purpose = lab_report_access

**Status:** `[ ] planned`

#### Sprint 1.4: Deletion orchestrator integration

**Estimated effort:** 3 days

**Deliverables:**
- [ ] `process-artefact-revocation` Edge Function (ADR-0022) now calls `applicable_exemptions` before creating `deletion_receipts` rows
- [ ] For each applicable exemption, suppresses the deletion for the covered data categories; records a suppression row in new `public.retention_suppressions` table with `artefact_id`, `exemption_id`, `suppressed_data_categories[]`, `reason_citation`, `suppressed_at`
- [ ] Partial-deletion path: artefact may have some categories deleted (marketing email, name) and some retained (PAN under RBI KYC); receipt reflects the split
- [ ] Audit log entry per suppression

**Testing plan:**
- [ ] BFSI fixture: revoke a `bureau_reporting` artefact → `deletion_receipts` row NOT created; `retention_suppressions` row IS created with CICRA citation
- [ ] BFSI fixture: revoke a `marketing` artefact → deletion proceeds normally
- [ ] BFSI fixture: revoke an artefact whose `data_scope` includes both retained and deletable categories → deletion_receipt.request_payload.data_scope reflects only deletable categories

**Status:** `[ ] planned`

#### Sprint 1.5: Dashboard surface + API endpoint

**Estimated effort:** 2 days

**Deliverables:**
- [ ] `/dashboard/compliance/retention` page: list of applied suppressions, filterable by statute/purpose/date
- [ ] "X records retained under <statute>" drill-down surfaced from Compliance Health widget (Sprint 4.2)
- [ ] `GET /api/orgs/[orgId]/regulatory-exemptions` for customer inspection of applicable rules (both platform defaults and their own overrides)
- [ ] `POST /api/orgs/[orgId]/regulatory-exemptions` for customers to add overrides (account_owner only)

**Testing plan:**
- [ ] Override created by customer appears in `applicable_exemptions` results for their org only
- [ ] Suppressions from Sprint 1.4 integration test appear in the dashboard page

**Status:** `[ ] planned`

#### Sprint 1.6: Legal review ingestion (G-008 close-out)

**Estimated effort:** 2 days engineering (post-review)

**Deliverables:**
- [ ] Reviewer notes populated in `legal_review_notes` per row for every reviewed statute
- [ ] `reviewed_at` + `reviewer_name` + `reviewer_firm` populated
- [ ] Reviewer's letter saved at `docs/legal/regulatory-review-2026-QX.pdf` (covered by NDA — summary-only in repo, full letter in secure storage)
- [ ] Re-review process documented at `docs/runbooks/regulatory-exemptions-re-review.md` (annual default, or on amendment-notification trigger)

**Testing plan:**
- [ ] Every BFSI + Healthcare seed row has non-null `reviewed_at` and `reviewer_firm`

**Status:** `[ ] planned`

### Phase 2: Notice versioning + re-consent (G-012)

#### Sprint 2.1: Notices schema

**Estimated effort:** 1 day

**Deliverables:**
- [ ] Migration `<date>_notices.sql`:
  - `public.notices`: `id`, `org_id`, `version`, `title`, `body_markdown`, `published_at`, `material_change_flag`, `published_by`
  - Append-only (no UPDATE/DELETE from authenticated)
  - RLS org-scoped
- [ ] `consent_events.notice_version` becomes a foreign key to `notices.version` (existing nullable column now points at the new table)

**Testing plan:**
- [ ] Publish a notice, consent event captures the version, query joins both
- [ ] Attempt to modify a published notice → rejected

**Status:** `[ ] planned`

#### Sprint 2.2: Material-change enumeration + CSV export

**Estimated effort:** 2 days

**Deliverables:**
- [ ] `/dashboard/notices` page: list notices, publish new version, toggle `material_change_flag` on publish
- [ ] On publish with `material_change_flag=true`: compute affected artefacts (`SELECT ... FROM consent_artefacts WHERE notice_version = <prior-version> AND status='active'`); store count on notice row for display
- [ ] Dashboard surface: "X artefacts on prior notice — re-consent campaign" with action button
- [ ] Action: generate CSV export of `(identifier, email_if_known, last_consent_date, purposes_affected)` → customer feeds into their own messaging system
- [ ] Hosted re-consent page URL is produced (deferred full rendering to G-031 in ADR-1008; v1 is just the affected-artefact list)

**Testing plan:**
- [ ] Publish material notice → affected count matches direct query
- [ ] CSV export header + row shape matches spec

**Status:** `[ ] planned`

#### Sprint 2.3: Replaced-by chain + audit trail

**Estimated effort:** 2 days

**Deliverables:**
- [ ] When a consent event arrives (via banner or `/v1/consent/record`) referencing a newer `notice_version` for a principal who has an active artefact under an older notice, the new artefact is created with `replaced_by` populated on the old artefact (status `replaced`) per §3.4 semantics
- [ ] Campaign tracking: `public.reconsent_campaigns` row holding (notice_id, initiated_at, affected_count, responded_count, revoked_count, no_response_count); updated nightly by pg_cron
- [ ] `/dashboard/notices/[id]/campaign` shows the counts over time

**Testing plan:**
- [ ] Re-consent flow: old artefact A with notice v1 → consent event with v2 → new artefact B created, `consent_artefacts.replaced_by` on A points to B, A.status='replaced'
- [ ] Campaign counts advance nightly

**Status:** `[ ] planned`

### Phase 3: Silent-failure detection (G-048) + Compliance Health widget (G-034)

#### Sprint 3.1: Orphan metric + alert

**Estimated effort:** 2 days

**Deliverables:**
- [ ] View `public.vw_orphan_consent_events` returning `(org_id, count)` for rows with `artefact_ids='{}'` AND `created_at BETWEEN now() - interval '24 hours' AND now() - interval '10 minutes'`
- [ ] pg_cron `orphan-consent-events-monitor` every 5 minutes: reads view, UPSERTs `depa_compliance_metrics.orphan_count` per org
- [ ] Any non-zero count triggers notification delivery via `notification_channels` (ADR-1005 wires up non-email channels; this sprint uses the existing Resend email channel; later sprints upgrade)
- [ ] Recovery test harness: disable the `process-consent-event` URL temporarily, verify orphans accrue, re-enable, verify safety-net catches them, verify alert fires + clears

**Testing plan:**
- [ ] Induced-failure test passes end-to-end
- [ ] Metric visible in `depa_compliance_metrics` for every active org

**Status:** `[ ] planned`

#### Sprint 3.2: Compliance Health widget

**Estimated effort:** 3 days

**Deliverables:**
- [ ] `/dashboard` widget "Compliance Health" showing four live metrics with targets:
  - Coverage score (target: 100%)
  - Orphan events (target: 0)
  - Overdue deletions (target: 0)
  - Upcoming expiries in 30 days (informational count)
- [ ] Each metric clickable → drill-down list with action buttons
- [ ] 5-minute refresh (client-side polling)
- [ ] Per-metric threshold-alert configuration UI (which channel gets each severity)
- [ ] Documentation page `docs/customer-docs/compliance-health.md` explaining each metric + remediation

**Testing plan:**
- [ ] Widget renders with current metrics on a freshly seeded org
- [ ] Drill-down navigates to the right sub-pages
- [ ] Alert threshold change propagates to the notification-channel config

**Status:** `[ ] planned`

---

## Architecture Changes

- `docs/architecture/consentshield-definitive-architecture.md`:
  - New section: Regulatory Exemption Engine — schema + orchestrator integration + partial-deletion semantics
  - New section: Notice versioning + re-consent workflow + replaced_by chain
  - Expand §Operational Observability with the orphan metric + alert
- `docs/architecture/consentshield-complete-schema-design.md`:
  - Document `regulatory_exemptions`, `retention_suppressions`, `notices`, `reconsent_campaigns`

_None yet._

---

## Test Results

_Empty until Sprint 1.1 runs._

---

## V2 Backlog (explicitly deferred)

- Multi-channel re-consent delivery (email + SMS + WhatsApp + push) — G-031 in ADR-1008.
- Automatic re-review on regulator amendment notification (manual trigger in v1).
- Non-BFSI / non-Healthcare sector seeds (telecom, edtech, e-commerce) — to be added when a customer in that sector signs.

---

## Changelog References

- `CHANGELOG-schema.md` — Sprints 1.1, 1.2, 1.3, 2.1 (reg_exemptions, seed, notices)
- `CHANGELOG-edge-functions.md` — Sprint 1.4 (process-artefact-revocation update)
- `CHANGELOG-api.md` — Sprint 1.5 (regulatory-exemptions endpoints)
- `CHANGELOG-dashboard.md` — Sprints 1.5, 2.2, 2.3, 3.2 (retention page, notices, campaign, Compliance Health)
- `CHANGELOG-docs.md` — Sprints 1.6, 3.2 (legal review runbook, compliance-health docs)
