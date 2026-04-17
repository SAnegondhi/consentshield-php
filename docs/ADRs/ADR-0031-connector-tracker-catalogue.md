# ADR-0031: Connector Catalogue + Tracker Signature Catalogue (Admin Panels)

(c) 2026 Sudhindra Anegondhi a.d.sudhindra@gmail.com

**Status:** Completed
**Date proposed:** 2026-04-17
**Date completed:** 2026-04-17

---

## Context

Two closely-related admin panels need to ship together:

1. **Connector Catalogue** — global registry of pre-built deletion connectors (Mailchimp v1, HubSpot v1, Razorpay v1, Generic Webhook, etc.). A customer picking a connector from this list gets one-click wiring for their deletion pipeline. Admin surface must allow adding new connector versions, deprecating old ones (with replacement + cutover deadline), and editing metadata. Customer-side consumer already exists (ADR-0018 pre-built connectors, ADR-0039 OAuth wiring).

2. **Tracker Signatures** — global catalogue of regex patterns the Cloudflare Worker uses to classify third-party scripts observed on customer sites (GA4, Meta Pixel, Mixpanel, Hotjar, etc.). Synced to Cloudflare KV via `sync-admin-config-to-kv` cron (ADR-0027 Sprint 3.2). Today the seed file `supabase/seed/tracker_signatures.sql` is the source of truth; this panel promotes it to a live-editable admin surface.

Infrastructure shipped with ADR-0027:
- `admin.connector_catalogue` table + RLS (Sprint 2.1).
- `admin.tracker_signature_catalogue` table + RLS (Sprint 2.1).
- Six SECURITY DEFINER RPCs: `admin.add_connector`, `update_connector`, `deprecate_connector`, `add_tracker_signature`, `update_tracker_signature`, `deprecate_tracker_signature` (Sprint 3.1).
- One bulk-import RPC: `admin.import_tracker_signature_pack(p_pack jsonb, p_reason text)` returns `int` (count inserted; `on conflict (signature_code) do nothing`).
- `admin-config` KV snapshot (Sprint 3.2) already reads `status='active'` signatures; the panel simply needs to drive writes through the RPCs and let the existing cron pick changes up.

What's missing is the operator UI. Today connectors and tracker signatures can only be authored via raw SQL or seed-file edits.

Wireframe references:
- `docs/admin/design/consentshield-admin-screens.html` §5 (Connector Catalogue) — list + editor split, 4 metric tiles (Active / Deprecated / Highest usage / Avg latency), connector row has Used-by count.
- `docs/admin/design/consentshield-admin-screens.html` §6 (Tracker Signatures) — category pill filter bar + list + editor split, severity column (info/warn/critical), `Import pack` button.

## Decision

Four sprints across two sub-panels, same shape as ADR-0030 (list → editor → actions):

- **Sprint 1.1** — `/connectors` list + `/connectors/[connectorId]` detail (read-only).
- **Sprint 1.2** — `/connectors/new` + `/connectors/[connectorId]/edit` + Deprecate action (with replacement + cutover). Platform-operator only.
- **Sprint 2.1** — `/signatures` list + `/signatures/[signatureId]` detail (read-only). Category-pill filter bar.
- **Sprint 2.2** — `/signatures/new` + `/signatures/[signatureId]/edit` + Deprecate action + `Import pack` form (paste or upload JSON array → `admin.import_tracker_signature_pack`). Support-role can add/edit (RPC already allows `require_admin('support')`); platform-operator required for bulk import.

Core invariants:
- Connectors are **versioned**, not edited-in-place once deprecated. Editing a deprecated connector means creating a new version with a higher version string. The editor gracefully disables the form when `status='deprecated'`.
- Tracker signatures are edited in place (unlike templates and connectors) — they are pattern regexes, not customer-facing artefacts. A wrong pattern is fixed, not versioned.
- All writes require a `reason` ≥ 10 chars (RPC-enforced).
- Used-by counts (connector) and observation counts (signatures) are **deferred** to V2. Neither is load-bearing for the panel's core usefulness and both require left joins into customer-side tables.

## Consequences

- Operator can onboard a new deletion connector end-to-end in ~5 minutes without touching SQL. That unblocks the next wave of pre-built connectors (Salesforce, Zoho, Freshworks) when the project needs them.
- Tracker signature updates (e.g., adding a new GA variant pattern) now flow: admin edit → RPC → `admin_config` KV snapshot (2-min cron) → Worker sees new signature. No deploy required.
- The `import_tracker_signature_pack` RPC closes the ADR-0027 Sprint 2.1 deferred item — the seed file is no longer the single source of truth after the operator imports it once.

## Out of scope

- **Used-by counts** — connectors across orgs, signatures across observations. Both require cross-schema joins and are not load-bearing for this phase.
- **Test-connector button** (wireframe §5 topbar) — runs a dry deletion webhook against a mock target. Deferred to V2; `docs/V2-BACKLOG.md` entry V2-C2.
- **Tracker observation counts** per signature — nice-to-have; requires a materialised view because `public.tracker_observations` is a buffer table.

---

## Implementation Plan

### Sprint 1.1: /connectors list + detail (read-only)

**Estimated effort:** 1.5 hours.

**Deliverables:**
- [x] `admin/src/app/(operator)/connectors/page.tsx` — Server Component. Fetches `admin.connector_catalogue` ordered by `connector_code`, `version desc`. Filters: status (active / deprecated / retired / all), vendor. Pill counts (N active · N deprecated · N retired). Row-click → detail.
- [x] `admin/src/app/(operator)/connectors/[connectorId]/page.tsx` — detail page. Metadata cards (Created / Deprecated with admin display name, replacement link, cutover deadline). Webhook endpoint template, required credentials JSON schema viewer, supported purposes, documentation link.
- [x] `admin/src/components/connectors/filter-bar.tsx` — Client Component. Status + Vendor selects. Clear-filters link.
- [x] `admin/src/app/(operator)/layout.tsx` — `Connector Catalogue` nav item live, `href=/connectors`.

**Testing plan:**
- [x] `cd admin && bun run build` — routes compile.
- [x] `cd admin && bun run lint` — zero warnings.
- [x] `cd admin && bun run test` — 1/1 smoke.
- [x] `bun run test:rls` — no regression.

**Status:** `[x] complete` — 2026-04-17

### Sprint 1.2: /connectors editor + deprecate action

**Estimated effort:** 2 hours.

**Deliverables:**
- [x] `admin/src/app/(operator)/connectors/new/page.tsx` — `+ New connector` form. Accepts `?from=<connectorId>` for Clone prefill (shortcut when bumping version).
- [x] `admin/src/app/(operator)/connectors/[connectorId]/edit/page.tsx` — editor; refuses when status ≠ active.
- [x] `admin/src/app/(operator)/connectors/actions.ts` — Server Actions: `createConnector`, `updateConnector`, `deprecateConnector`, `goToCloneForm`.
- [x] `admin/src/components/connectors/connector-form.tsx` — shared form for new/edit. Connector code + display name + vendor + version + supported purposes (comma-separated) + webhook endpoint template (validated URL template) + required credentials JSON schema (textarea, JSON validation) + documentation URL + retention lock toggle.
- [x] `admin/src/components/connectors/detail-actions.tsx` — status-aware action bar. Active → Edit + Deprecate. Deprecated → Clone as new version (link to `/connectors/new?from=<id>`) + read-only notice. Deprecate modal takes replacement connector (select from active list) + cutover date + reason.

**Testing plan:**
- [x] Existing RPC tests in `tests/admin/rpcs.test.ts` cover the three RPCs.
- [x] `cd admin && bun run lint` — zero warnings.
- [x] `cd admin && bun run build` — new routes compile.
- [x] `bun run test:rls` — no regression.

**Status:** `[x] complete` — 2026-04-17

### Sprint 2.1: /signatures list + detail (read-only)

**Estimated effort:** 1 hour.

**Deliverables:**
- [x] `admin/src/app/(operator)/signatures/page.tsx` — list with category pill filter (All / Analytics / Marketing / Advertising / Social / Functional / Critical severity). Status filter (active / deprecated). Row-click → detail.
- [x] `admin/src/app/(operator)/signatures/[signatureId]/page.tsx` — detail with metadata, pattern preview (monospace), notes (operator-only).
- [x] `admin/src/components/signatures/filter-bar.tsx` — category pill bar + status select.
- [x] Nav item `Tracker Signatures` live, `href=/signatures`.

**Testing plan:**
- [x] `cd admin && bun run build` — routes compile.
- [x] `cd admin && bun run lint` — zero warnings.
- [x] `bun run test:rls` — no regression.

**Status:** `[x] complete` — 2026-04-17

### Sprint 2.2: /signatures editor + import pack

**Estimated effort:** 1.5 hours.

**Deliverables:**
- [x] `admin/src/app/(operator)/signatures/new/page.tsx` — `+ New signature` form.
- [x] `admin/src/app/(operator)/signatures/[signatureId]/edit/page.tsx` — in-place edit.
- [x] `admin/src/app/(operator)/signatures/actions.ts` — Server Actions: `createSignature`, `updateSignature`, `deprecateSignature`, `importPack`.
- [x] `admin/src/components/signatures/signature-form.tsx` — shared new/edit form.
- [x] `admin/src/components/signatures/detail-actions.tsx` — active → Edit + Deprecate; deprecated → read-only notice.
- [x] `admin/src/app/(operator)/signatures/import/page.tsx` + `import-form.tsx` — paste JSON array → `importPack` → shows count inserted. Platform-operator only (RPC enforces `require_admin('platform_operator')`).

**Testing plan:**
- [x] `cd admin && bun run lint` — zero warnings.
- [x] `cd admin && bun run build` — new routes compile.
- [ ] Existing `tests/admin/rpcs.test.ts` covers the three write RPCs; smoke-import an empty array to assert the `0` return path.
- [x] `bun run test:rls` — no regression.

**Status:** `[x] complete` — 2026-04-17

---

## Acceptance Criteria

- `/connectors` + `/signatures` nav items live; "soon" pills removed.
- All four sprints ship with zero build warnings, zero lint warnings.
- `bun run test:rls` stays 178/178 (no regression).
- Deprecating a connector persists replacement + cutover. Adding a new signature is immediately visible to the KV-sync cron (no deploy needed).
- Changelogs updated: `CHANGELOG-dashboard.md` with one entry per sprint (admin app lives in the same changelog as customer-facing dashboard changes for now; admin split slated for ADR-0026 Sprint 4.1 follow-up).

## Notes

- Reason field uses the existing `ReasonField` component (live counter, ≥10 chars). Same modal shell as ADR-0030.
- JSON schema textarea validates JSON on blur + on submit; shape validation (must be `type:"object"`, have `required` array, etc.) is deferred to the RPC which is permissive.
- Pattern regex validation: test-compile the pattern with `new RegExp()` on the server before calling the RPC; show "Invalid regex: <message>" if it throws.
