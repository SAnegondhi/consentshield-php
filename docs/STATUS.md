# ConsentShield Status

(c) 2026 Sudhindra Anegondhi a.d.sudhindra@gmail.com

**Snapshot date:** 2026-04-20 (end-of-day)
**Branch:** main
**Latest commit:** `2a06551` — feat(ADR-0048): suspension gate on compliance writes; banner copy clarified; 5/5 PASS
**Total commits:** 194
**Migrations applied:** 144
**Edge Functions deployed:** 10

---

## Summary

The project has two independently deployable apps in a Bun workspace monorepo:

- **`app/`** — Customer-facing Next.js app (consent management dashboard, rights portal, billing, DEPA compliance, DPIA + auditor engagements for SDFs, probes, audit export, public API keys)
- **`admin/`** — Operator console Next.js app (admin.consentshield.in — accounts, billing with issuer entities + invoices + GST + disputes, impersonation, audit log, connector catalogue, feature flags)

**Customer app:** **Functionally complete for Phase 1 + Phase 2.** Every panel from the `docs/design/screen designs and ux/` wireframe is live and data-bound. All compliance workflows (consent capture → artefact creation → rights → deletion → audit export) are end-to-end. SDF workflow (DPIA records + auditor engagements + audit-ZIP extension) ships. Customer invoice portal + billing profile editor + sectoral template switcher ship. Support sessions list now shows operator names. Suspension banner clarifies paused vs. still-working surfaces.

**Admin console:** 13/13 wireframe panels live. Billing track complete through ADR-0050 (issuer entities, invoicing + GST + Resend, search/export/statement, dispute workspace with evidence bundle). SDF status toggle on org detail.

**Public API (ADR-1001):** **Completed 2026-04-20** — `cs_live_*` keys, Bearer middleware, rate limiter, request log, usage page, OpenAPI draft, security review. ADR-1002+ (route handlers) is the next track.

---

## ADR Completion

### Completed (52 ADRs)

Phase 1 (ADR-0001 through ADR-0018): project scaffold, banner builder, rights workflow, tracker monitoring, Razorpay billing, deletion orchestration, auth hardening, scoped-role enforcement, rate limiter, deletion retry, test suites, signup bootstrap, external services, security scanner, consent probes v1, audit export, Mailchimp/HubSpot connectors.

DEPA (ADR-0019 through ADR-0025, ADR-0037): schema skeleton, process-consent-event, process-artefact-revocation, expiry pipeline, customer UI rollup, score dimension, onboarding seed pack.

Admin platform (ADR-0026 through ADR-0045): monorepo restructure, admin schema, app foundation, organisations panel, sectoral templates, connector + signature catalogues, support tickets, pipeline + abuse/security, billing operations, feature flags, observability, probes v2, OAuth, signup idempotency, customer-auth-only, RBAC hierarchy, admin user lifecycle.

Recent work (ADR-0046 through ADR-0057, ADR-1001):

| ADR | Title | Completed |
|-----|-------|-----------|
| 0046 | Significant Data Fiduciary foundation — sdf_status + DPIA records + auditor engagements + audit-ZIP SDF section | 2026-04-20 |
| 0047 | Customer membership lifecycle + single-account-per-identity invariant | 2026-04-18 |
| 0048 | Admin Accounts panel + customer-side suspension banner + suspension write-gate on compliance workflows | 2026-04-20 |
| 0049 | Security observability ingestion — rate_limit_events + sentry_events | 2026-04-18 |
| 0050 | Admin account-aware billing — issuer entities + invoices + GST + dispute workspace | 2026-04-20 |
| 0054 | Customer-facing billing portal — invoice history + PDF download + billing profile editor | 2026-04-20 |
| 0057 | Customer-facing sectoral template switcher (Settings → Account) | 2026-04-20 |
| 1001 | Public API foundation — `cs_live_*` keys + Bearer middleware + rate limiter + request log + OpenAPI | 2026-04-20 |

### In Progress

_(None — all previously-in-progress ADRs were closed today.)_

### Proposed (not started)

| ADR | Title | Scope |
|-----|-------|-------|
| 0051 | Billing evidence ledger (chargeback-defense capture points) | Admin-side |
| 0052 | Razorpay dispute evidence auto-submission | Admin-side |
| 0053 | GSTR-1 XML generation + filing helpers | Admin-side |
| 0055 | Account-scoped impersonation | Admin-side |
| 0056 | Per-account feature-flag targeting | Admin-side |
| 1002 | Public API Phase 2 — `/v1/consent/verify` + `record` + artefact ops + deletion API | Public API route handlers |
| 1003 | Processor posture — `storage_mode` + BYOS + Zero-Storage + Healthcare seed + sandbox | Public API |
| 1004 | Statutory retention — Regulatory Exemption Engine + material-change re-consent + silent-failure detection | Public API |
| 1005 | Operations maturity — webhook reference + test_delete + support model + status page + rights API + non-email channels | Public API |
| 1006 | Developer experience — Node/Python/Java/Go client libraries + OpenAPI + CI drift check | Public API |
| 1007 | Connector ecosystem expansion — CleverTap, Razorpay, WebEngage, Intercom, Shopify, Segment + plugins | Connectors |
| 1008 | Scale + audit polish + P3 hardening | Operations |

---

## Customer App (`app/`) — Panel Inventory

### Shipped and wired (all from wireframe)

| Route | Panel | ADR anchor |
|-------|-------|-----------|
| `/dashboard` | Home (DPDP score, DEPA score gauge, status tiles, SDF card when flagged) | ADR-0003 + 0025 + 0046 |
| `/dashboard/banners` | Banner builder (purpose-bound) | ADR-0003 / 0020 |
| `/dashboard/purposes` | Purpose definitions CRUD + connector mappings | ADR-0024 |
| `/dashboard/artefacts` | Consent artefacts list + 4-link chain-of-custody detail | ADR-0021 / 0024 |
| `/dashboard/enforcement` | Security scanner + withdrawal verifier | ADR-0015 / 0022 |
| `/dashboard/probes` | Vercel Sandbox probes | ADR-0041 |
| `/dashboard/inventory` | Data inventory | ADR-0003 |
| `/dashboard/template` | Sectoral template picker | ADR-0030 |
| `/dashboard/rights` | Rights requests inbox + artefact-scoped impact preview | ADR-0004 / 0022 / 0024 |
| `/dashboard/dpia` + `/new` + `/[dpiaId]` | DPIA records (SDF) | ADR-0046 Phase 2 |
| `/dashboard/auditors` + `/new` + `/[engagementId]` | Auditor engagements (SDF) | ADR-0046 Phase 3 |
| `/dashboard/integrations` | Connector list + OAuth | ADR-0018 / 0039 |
| `/dashboard/billing` | Plan selector + Razorpay checkout | ADR-0006 |
| `/dashboard/exports` | Audit export (direct + R2) — now includes SDF section | ADR-0017 / 0040 / 0046 Phase 4 |
| `/dashboard/support` | Support ticket submit | ADR-0032 |
| `/dashboard/support-sessions` | Impersonation history with operator names | ADR-0029 |
| `/dashboard/settings/account` | Org name + industry (editable) + active sector template | ADR-0057 |
| `/dashboard/settings/billing` | Plan summary + billing profile editor + invoice history + PDF download | ADR-0054 |
| `/dashboard/settings/members` | Team & invitations | ADR-0044 / 0047 |
| `/dashboard/settings/api-keys` | `cs_live_*` key CRUD (account_owner only) | ADR-1001 |

### Remaining customer-app backlog

**None.** All gaps from the 2026-04-20 (morning) snapshot closed:

- ✅ Customer invoice portal (ADR-0054)
- ✅ Sectoral template switcher (ADR-0057)
- ✅ Support sessions tab enrichment (operator names)
- ✅ Suspension banner — Worker (pre-existing) + dashboard banner clarification + write-gate on compliance workflows
- ✅ SDF workflows — DPIA + auditor engagements + audit-ZIP section (ADR-0046 Phases 2–4)

Per-ADR TODO items that don't belong to the customer-app scope are captured in `docs/V2-BACKLOG.md` and individual ADR files.

---

## Admin App (`admin/`) — Panel Inventory

### Shipped

| Route | ADR |
|-------|-----|
| `/accounts` + `/[accountId]` | ADR-0048 |
| `/orgs` + `/[orgId]` (SDF card) | ADR-0029 / 0046 |
| `/billing` landing + `/[accountId]` | ADR-0050 |
| `/billing/operations` | ADR-0034 |
| `/billing/issuers` + `/[issuerId]` + `/new` | ADR-0050 |
| `/billing/search` + `/gst-statement` + `/export` | ADR-0050 |
| `/billing/disputes` + `/[disputeId]` | ADR-0050 |
| `/pipeline` | ADR-0033 |
| `/security` | ADR-0033 |
| `/connectors` + `/[connectorId]` | ADR-0031 |
| `/signatures` + `/[signatureId]` | ADR-0031 |
| `/templates` + `/[templateId]` | ADR-0030 |
| `/flags` | ADR-0036 |
| `/admins` | ADR-0045 |
| `/support` + `/[ticketId]` | ADR-0032 |
| `/audit-log` + `/audit-log/export` | ADR-0028 |

### Remaining

| Panel | Planned ADR |
|-------|------------|
| Billing evidence ledger (on dispute detail) | ADR-0051 |
| Razorpay auto-submit dispute evidence | ADR-0052 |
| GSTR-1 XML download | ADR-0053 |
| Account-scoped impersonation | ADR-0055 |
| Per-account feature flag overrides | ADR-0056 |

---

## Database + Infrastructure

| Component | Identifier / URL |
|-----------|-----------------|
| Customer app (Vercel) | `consentshield-one.vercel.app` |
| Admin app (Vercel) | `consentshield-admin.vercel.app` |
| Cloudflare Worker CDN | `https://cdn.consentshield.in/v1/*` |
| Supabase project | `xlqiakmkdjycfiioslgs` |
| GitHub repo | `github.com/SAnegondhi/consentshield` |

**Edge Functions (10):** `process-consent-event`, `process-artefact-revocation`, `send-sla-reminders`, `run-security-scans`, `run-consent-probes`, `check-stuck-buffers`, `check-stuck-deletions`, `check-cron-health`, `oauth-token-refresh`, `sync-admin-config-to-kv`.

**pg_cron jobs:** SLA reminders, buffer sweeps, security scans, consent probes, stuck-deletion checks, cron health watchdog, sentry events cleanup, feature-flag KV sync, DEPA expiry enforcement, auditor-engagement + DPIA next-review reminders.

**Database:** 144 migrations applied. RLS on every table. Three scoped runtime roles (`cs_worker`, `cs_delivery`, `cs_orchestrator`). `SUPABASE_SERVICE_ROLE_KEY` only in admin `auth.admin.*` carve-out per CLAUDE.md Rule 5.

---

## Test Suite

Approximately **470+ tests passing** end-of-session. Recent additions (today):

| Suite | Tests | ADR |
|-------|-------|-----|
| `tests/billing/customer-invoice-reads.test.ts` | 9 | ADR-0054 Sprint 1.1 |
| `tests/billing/customer-billing-profile-update.test.ts` | 8 | ADR-0054 Sprint 1.2 |
| `tests/rls/dpia-records.test.ts` | 10 | ADR-0046 Phase 2 |
| `tests/rls/auditor-engagements.test.ts` | 11 | ADR-0046 Phase 3 |
| `tests/rls/update-org-industry.test.ts` | 5 | ADR-0057 |
| `tests/rls/org-suspension-gate.test.ts` | 5 | ADR-0048 follow-up |
| **Today's new tests** | **48** | |

Two pre-existing flaky tests in `tests/admin/admin-lifecycle-rpcs.test.ts` (shared-dev-DB has extra platform_operator rows so "last active" guards never fire) — not Sprint-3.x scope.

---

## Session Summary — 2026-04-20

**Morning (Sprints 3.1 + 3.2 of ADR-0050):**
- GST statement CSV + invoice export + invoice search (26 tests)
- Dispute workspace + evidence bundle assembly (13 tests)
- ADR-0050 fully completed

**Afternoon (customer-app backlog sweep):**
- ADR-0054 (customer billing portal) — 2 sprints, 17 tests — completed
- ADR-0046 Phase 2 (DPIA records + UI) — 2 sprints, 10 tests
- ADR-0046 Phase 3 (auditor engagements + UI) — 1 sprint, 11 tests
- ADR-0046 Phase 4 (SDF section in audit ZIP) — 1 sprint, no new tests (read-path)
- ADR-0046 completed
- ADR-0029 follow-up (support sessions enrichment) — 1 commit, no new tests (UI polish)
- ADR-0057 (sectoral template switcher) — 1 sprint, 5 tests — completed
- ADR-0048 follow-up (suspension gate + banner clarification) — 1 commit, 5 tests
- ADR-1001 completed in parallel by Terminal B

**Net:** 10+ commits, ~50 new tests, 4 ADRs completed (0046, 0054, 0057, 1001), customer-app gap list fully closed.

---

## Immediate Next Steps

With the customer-app backlog closed, the next natural move is the **admin-side billing follow-ups** in sequence:

1. **ADR-0051** — Billing evidence ledger (capture points at signup / invoice email / rights request / webhook / admin plan change). Feeds the dispute bundle assembler from ADR-0050 Sprint 3.2.
2. **ADR-0052** — Razorpay dispute evidence auto-submission (depends on ADR-0051).
3. **ADR-0053** — GSTR-1 XML + filing helpers.

After 0051–0053, the ADR-1002+ public API track resumes.

---

## Pending Manual Setup

| Item | Action required |
|------|-----------------|
| Supabase email templates (password reset, email change) | Stock templates still use click-through links. Paste OTP-form HTML from `docs/ops/supabase-auth-templates.md` before enabling those flows. |
| Resend domain verification | `consentshield.in` verified; relaxed-alignment DMARC live; deliverability confirmed to Gmail. |
| Turnstile production keys | Live on Vercel Production. Preview env vars not set. |
| Razorpay | Live in test mode on Vercel Production. End-to-end checkout UX smoke with test card pending. |
| Vercel Deployment Protection | Off on both projects for dev. |
| `NEXT_PUBLIC_APP_URL` | Points to `consentshield-one.vercel.app`. Revisit when custom domain is added. |
