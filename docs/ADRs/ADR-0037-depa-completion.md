# ADR-0037: DEPA Completion — Expiry Fan-out, Per-Requestor Binding, CSV Export, Audit DEPA Section, Onboarding Seed Pack

(c) 2026 Sudhindra Anegondhi a.d.sudhindra@gmail.com

**Status:** Completed
**Date proposed:** 2026-04-17
**Date completed:** 2026-04-17
**Depends on:** ADR-0020 (DEPA schema), ADR-0022 (revocation dispatcher — pattern reused for expiry), ADR-0023 (expiry pipeline — extended here), ADR-0017 (audit export — extended here for W8), ADR-0024 (customer UI surfaces — extended for V2-D2 and V2-D3), ADR-0030 (Terminal A's sectoral templates — `admin.sectoral_templates.purpose_definitions` is the source for W9 materialisation).
**Unblocks:** Phase-2 formal closeout. Every wireframe-defined DEPA surface (W2–W10) becomes functionally complete after this ADR + ADR-0038.

---

## Context

ADR-0024 shipped the customer-facing DEPA UI rollup. Five backlog items remain before the DEPA story is functionally complete:

| Item | Gap |
|---|---|
| V2-D1 | `enforce_artefact_expiry()` stages R2 export via `delivery_buffer` but doesn't create `deletion_receipts` for connectors — TTL-lapse expiry doesn't actually delete from Mailchimp/HubSpot. |
| V2-D2 | Rights Centre impact preview is org-wide informational. No per-requestor artefact binding. |
| V2-D3 | Consent Artefacts list has no "Export CSV" action. |
| W8 | Audit export (ADR-0017) has no DEPA section. |
| W9 | `apply_sectoral_template()` writes a pointer but doesn't materialise the template's `purpose_definitions` JSONB payload into `public.purpose_definitions` rows. |

All five are independent. Ship them in a single ADR with one sprint per item so the close-out reads cleanly.

### V2-D1 — Expiry connector fan-out

Two shapes were considered in the backlog:

1. Have `enforce_artefact_expiry()` fire `net.http_post` to `process-artefact-revocation` with a new `trigger_type='consent_expired'` body param — but the Edge Function currently hardcodes `'consent_revoked'` in the `deletion_receipts` insert and in the UNIQUE partial index predicate (`WHERE trigger_type = 'consent_revoked'`).
2. Write a **SQL-native fan-out helper** that reads `purpose_connector_mappings` + `integration_connectors`, computes the `data_categories ∩ data_scope` intersection, and INSERTs `deletion_receipts` rows directly — inside `enforce_artefact_expiry()`, same loop iteration as the `delivery_buffer` write.

**Decision — Option 2.** Keeps the expiry cron as a pure pg function (no Edge Function dependency at cron time), doesn't require widening the Edge Function's idempotency contract, and mirrors the existing `trg_artefact_revocation_cascade` in-DB cascade pattern. New UNIQUE partial index `deletion_receipts_expiry_artefact_connector_uq` on `(artefact_id, connector_id) WHERE trigger_type = 'consent_expired'` — using `artefact_id` not `trigger_id` because `enforce_artefact_expiry()` runs as a loop over expired artefacts without a natural trigger_id (expiry is not a row-scoped event like revocation).

### V2-D2 — Per-requestor artefact binding

Architecture discovery: `session_fingerprint = sha256(userAgent + ipTruncated + orgId)` is computed **server-side on the Worker** at consent time. The client never sees it; it's not a cookie; customer-site → rights-portal cross-origin cookie dance is impossible.

**Clean path: recompute the fingerprint server-side at rights-request submit time.** The rights portal runs on Vercel with `x-forwarded-for` for IP + `user-agent` header. Using the identical sha256 formula, we derive the fingerprint at `POST /api/public/rights-request/route.ts` and persist it on `rights_requests.session_fingerprint`. Same browser + same network → same fingerprint → exact artefact match.

Caveats (documented in the UI):
- User switched browsers / networks between consent and rights request → no match. UI falls back to org-wide impact preview.
- IPv6 truncation: the Worker formula is v4-specific. For v6 users today it produces a degenerate string, but consistently so on both sides.

Rights Centre detail now fetches active artefacts `WHERE org_id = X AND session_fingerprint = Y` and renders per-artefact purpose + data_scope + connector fan-out. Aggregate summary replaces the informational org-wide block when matches exist.

### V2-D3 — CSV export

New route `GET /api/orgs/[orgId]/artefacts.csv` that streams CSV honouring the same filters as the list page (`?status`, `?framework`, `?purpose`, `?expiring=30`). No pagination — full result set. Column set matches the list view. Button added to `/dashboard/artefacts` topbar.

### W8 — Audit & Reports DEPA section

ADR-0017 added the audit-export endpoint that returns a direct-download ZIP. It currently includes (per ADR-0017's scope): audit_log, rights_requests, consent_events (sanitised), deletion_receipts, breach_notifications. W8 asks for a DEPA section adding:

- `purpose_definitions_snapshot.json` — current catalogue for the org
- `purpose_connector_mappings_snapshot.json` — current mappings
- `artefacts_summary.csv` — counts by status × framework × purpose_code (no PII, no per-requestor data)
- `depa_compliance_metrics.json` — current score + sub-scores + computed_at

### W9 — Onboarding seed pack materialisation

`apply_sectoral_template()` (ADR-0030 Sprint 3.1) writes `organisations.settings.sectoral_template = { code, version, applied_at, applied_by }` but explicitly does **not** materialise the template's `purpose_definitions` JSONB into `public.purpose_definitions` rows. Comment in the RPC: _"This RPC DOES NOT materialise... that's a future DEPA sprint."_ That sprint is W9.

**Extend `apply_sectoral_template()` to materialise.** After writing the pointer, iterate the template's `purpose_definitions` JSONB array and upsert into `public.purpose_definitions`. `ON CONFLICT (org_id, purpose_code, framework) DO UPDATE` so re-applying a template is idempotent. The template's JSONB payload shape (per `admin.sectoral_templates.purpose_definitions`) is declared by ADR-0030's migration; we honour whatever fields exist there. Minimum: `purpose_code`, `display_name`, `description`, `data_scope`, `default_expiry_days`, `framework`, `auto_delete_on_expiry`.

Return payload gains a `materialised_count` field so the customer UI can say "Applied 8 purposes from DPDP minimum."

---

## Decision

Five independent sprints, each landing its own migration (where needed), code, and tests.

1. **Sprint 1.1 — V2-D1** — `enforce_artefact_expiry()` fans out to `deletion_receipts` for the mapped connectors. New UNIQUE partial index. Test 10.6c.
2. **Sprint 1.2 — V2-D2** — `rights_requests.session_fingerprint` column + fingerprint derivation in the submit route + per-requestor binding in the Rights Centre detail.
3. **Sprint 1.3 — V2-D3** — CSV export route + UI button.
4. **Sprint 1.4 — W8** — audit export gains a DEPA section.
5. **Sprint 1.5 — W9** — `apply_sectoral_template()` materialises purposes.

Idempotency discipline mirrors the rest of DEPA:
- V2-D1: DB UNIQUE partial index + loop skipping if receipt exists.
- V2-D2: the fingerprint write is a single UPDATE on the new column at INSERT time; no race.
- V2-D3: pure read.
- W8: pure read.
- W9: `ON CONFLICT (org_id, purpose_code, framework) DO UPDATE`. Re-applying a template updates rather than duplicating.

---

## Consequences

- **New daily behaviour:** when `enforce_artefact_expiry()` runs (19:00 UTC), expired artefacts with `auto_delete_on_expiry=true` now also produce `deletion_receipts` rows for third-party connectors. These flow through the existing delivery pathway.
- **Rights requests now carry a session fingerprint.** New column, populated at submit time. Existing rows get NULL — OK, fallback preview still works.
- **Public rights portal form: no UI change.** Fingerprint derivation is server-side only.
- **`apply_sectoral_template` now inserts rows.** Customer clicking "Apply DPDP minimum" gets 5–8 purpose_definitions created in their org. If purposes already exist (re-apply), they are UPDATED in place. If a customer edits a purpose locally after applying, re-applying the same template version will overwrite the edits — document in the UI copy ("applying a sector pack resets its purposes to the template default").
- **Audit export grows.** New files added to the ZIP; no breaking change for consumers.
- **CSV export unlocks V2-D3.** Done, removable from V2-BACKLOG.
- V2-D1, V2-D2, V2-D3, W8, W9 all close out of the backlog after this ADR.

### Architecture Changes

None structural. Adds two new columns, one new UNIQUE partial index, three new Edge-Function-free SQL behaviours (fan-out, materialisation, fingerprint derivation via Next.js route).

---

## Implementation Plan

### Sprint 1.1 — V2-D1 expiry connector fan-out

**Estimated effort:** 90 min.

**Deliverables:**

- [ ] `supabase/migrations/20260424000001_depa_expiry_connector_fanout.sql`:
  - UNIQUE partial index on `deletion_receipts (artefact_id, connector_id) WHERE trigger_type = 'consent_expired'`.
  - Rewrite `enforce_artefact_expiry()` so that when a purpose has `auto_delete_on_expiry=true` it ALSO iterates `purpose_connector_mappings` for the purpose, joins `integration_connectors` filtered to `status='active'`, computes `scoped_fields = mapping.data_categories ∩ artefact.data_scope`, and INSERTS one `deletion_receipts` row per mapping with `trigger_type='consent_expired'`, `trigger_id=NULL` (not a row-scoped event), `artefact_id=<artefact>`, `status='pending'`, `request_payload={ artefact_id, data_scope=scoped_fields, reason='consent_expired' }`. ON CONFLICT DO NOTHING.
  - Keep the existing `delivery_buffer` R2-export row (don't replace — both fire).
- [ ] Test 10.6c in `tests/depa/expiry-pipeline.test.ts` — seed a purpose with `auto_delete_on_expiry=true` + one connector mapping; time-travel an artefact past expires_at; call `enforce_artefact_expiry()`; verify exactly one `deletion_receipts` row with `trigger_type='consent_expired'` + correct `data_scope`.

**Status:** `[x] complete` — 2026-04-17 — `deletion_receipts_expiry_artefact_connector_uq` index live, `enforce_artefact_expiry()` rewritten to fan out, Test 10.6c PASS in `tests/depa/expiry-pipeline.test.ts` (3/3 in that file).

### Sprint 1.2 — V2-D2 per-requestor artefact binding

**Estimated effort:** 2h.

**Deliverables:**

- [ ] `supabase/migrations/20260424000002_rights_session_fingerprint.sql`:
  - `alter table rights_requests add column session_fingerprint text`.
  - `create index idx_rights_requests_fingerprint on rights_requests (org_id, session_fingerprint) where session_fingerprint is not null`.
- [ ] `app/src/app/api/public/rights-request/route.ts` — derive `session_fingerprint` from request headers (userAgent + x-forwarded-for truncated + orgId) using identical sha256 formula as `worker/src/events.ts:118`. Persist on INSERT.
- [ ] `app/src/lib/rights/fingerprint.ts` — shared helper exporting `deriveRequestFingerprint(request, orgId)`. Keeps the formula in one place for future parity tests.
- [ ] `app/src/app/(dashboard)/dashboard/rights/[id]/page.tsx` — fetch `rights_requests.session_fingerprint`; when present, query `consent_artefacts WHERE org_id = X AND session_fingerprint = Y AND status = 'active'`; render per-artefact purpose + data_scope + connector fan-out. Fall back to the existing org-wide informational block when fingerprint is NULL or matches zero artefacts. UI caveat line: "Matched N artefact(s) on session fingerprint. If this requestor used a different browser / network than at consent time, no match will appear — the org-wide impact preview below still applies."

**Status:** `[x] complete` — 2026-04-17 — migrations `20260424000002` (column) + `20260424000003` (RPC signature) applied, `deriveRequestFingerprint` helper in `app/src/lib/rights/fingerprint.ts`, public POST persists, Rights Centre detail shows matched artefacts above the informational fallback.

### Sprint 1.3 — V2-D3 CSV export

**Estimated effort:** 75 min.

**Deliverables:**

- [ ] `app/src/app/api/orgs/[orgId]/artefacts.csv/route.ts` — GET handler. Auth via `organisation_members` membership. Honours `?status&framework&purpose&expiring=30` (same parser as the list page). Streams `text/csv` with `Content-Disposition: attachment`. Columns: artefact_id, purpose_code, framework, status, data_scope (semicolon-joined), expires_at, created_at.
- [ ] `app/src/app/(dashboard)/dashboard/artefacts/page.tsx` — "Export CSV" button in the topbar stat-row; constructs the CSV URL preserving current filters.
- [ ] Remove V2-D3 from `docs/V2-BACKLOG.md` — replace with `→ see ADR-0037 Sprint 1.3`.

**Status:** `[x] complete` — 2026-04-17 — `/api/orgs/[orgId]/artefacts.csv` route live, "Export CSV" button on the artefacts page preserves current filters. V2-D3 closed.

### Sprint 1.4 — W8 Audit DEPA section

**Estimated effort:** 90 min.

**Deliverables:**

- [ ] Inspect existing audit export route first (`app/src/app/api/orgs/[orgId]/audit-export/route.ts`); identify the ZIP-composition pattern.
- [ ] Add four new files to the ZIP:
  - `depa/purpose_definitions.json`
  - `depa/purpose_connector_mappings.json`
  - `depa/artefacts_summary.csv` — aggregate counts (no PII).
  - `depa/compliance_metrics.json` — current row from `depa_compliance_metrics`.
- [ ] Update the export manifest to list the new files.
- [ ] Flip alignment-tracker W8 code column to `✅ 2026-04-17`.

**Status:** `[x] complete` — 2026-04-17 — audit-export ZIP now includes `depa/purpose_definitions.json`, `depa/purpose_connector_mappings.json`, `depa/artefacts_summary.csv`, `depa/compliance_metrics.json`. Section counts extended; `audit_export_manifests` records the full count map.

### Sprint 1.5 — W9 apply_sectoral_template materialisation

**Estimated effort:** 60 min.

**Deliverables:**

- [ ] `supabase/migrations/20260424000003_apply_template_materialise.sql`:
  - Re-create `public.apply_sectoral_template(p_template_code text)` so that, after writing the `organisations.settings.sectoral_template` pointer, it iterates `v_template.purpose_definitions` JSONB array and UPSERTs into `public.purpose_definitions` via `ON CONFLICT (org_id, purpose_code, framework) DO UPDATE`.
  - Return payload gains `materialised_count int`.
- [ ] `tests/rls/sectoral-template-apply.test.ts` — extend existing test (Terminal A's Sprint 3.1) with a new assertion: after `apply_sectoral_template` completes, `purpose_definitions` has N rows for the org where N = array_length of the template payload.
- [ ] Flip alignment-tracker W9 code column to `✅ 2026-04-17`.

**Status:** `[x] complete` — 2026-04-17 — `public.apply_sectoral_template` re-created with UPSERT loop over `template.purpose_definitions`. Return payload gains `materialised_count`. Existing sectoral-template-apply RLS test extended with a materialisation assertion.

---

## Test Results

```
Test: expiry pipeline (10.6 + 10.6b + 10.6c)
Method: bunx vitest run tests/depa/expiry-pipeline.test.ts
Result: 3/3 PASS in 9.94s.

Test: sectoral template apply + materialisation
Method: bunx vitest run tests/rls/sectoral-template-apply.test.ts
Result: 3/3 PASS in 6.35s.

Test: Full test:rls suite (14 files)
Method: bun run test:rls
Result: 14 passed / 160 passed in 109.58s.

Build: cd app && bun run build
Result: Success — zero errors, zero warnings. New routes in the manifest:
  /api/orgs/[orgId]/artefacts.csv
```

---

## Changelog References

- `CHANGELOG-schema.md` — three new migrations (expiry fan-out, rights fingerprint, template materialisation).
- `CHANGELOG-api.md` — rights-request fingerprint derivation, artefacts CSV route, audit export DEPA content.
- `CHANGELOG-dashboard.md` — Rights Centre per-requestor binding, CSV export button.
- `CHANGELOG-docs.md` — ADR-0037 authored; V2-BACKLOG D1/D2/D3 replaced with pointer; alignment-tracker W8/W9 flipped.
