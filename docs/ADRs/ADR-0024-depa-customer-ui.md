# ADR-0024: DEPA Customer UI Rollup — Purpose Definitions, Consent Artefacts, Dashboard Tile, Rights Centre reshape, Settings sector template

(c) 2026 Sudhindra Anegondhi a.d.sudhindra@gmail.com

**Status:** Completed
**Date proposed:** 2026-04-17
**Date completed:** 2026-04-17
**Depends on:** ADR-0020 (schema: `purpose_definitions`, `purpose_connector_mappings`, `consent_artefacts`), ADR-0021 (consent-event pipeline actually populates `consent_artefacts`), ADR-0022 (revocation pipeline — UI surfaces receipts), ADR-0025 (DEPA score dashboard gauge now wired), ADR-0030 (Terminal A's Sectoral Templates — populates `organisations.settings.sectoral_template`).
**Unblocks:** Customer visibility into everything Phase-2 DEPA has shipped on the backend. This is the first customer-facing DEPA delivery.

---

## Context

Phase-2 of DEPA (ADR-0020 → 0023 + 0025) is operationally complete but **entirely invisible to customers.** Backend artefacts are created on every consent event, revocations fan out to deletion receipts, expiry is enforced nightly, and the DEPA score gauge was wired into the dashboard in ADR-0025. But five wireframe-defined customer panels remain unwired:

| Wireframe item | Shipped before | Gap |
|---|---|---|
| W2 — Consent Artefacts panel | ADR-0021/0022 backend only | No route, no UI |
| W3 — Purpose Definitions catalogue + Connector mappings | nothing | No route, no UI, no CRUD |
| W6 — Dashboard "Consent Artefacts" tile | ADR-0025 partial | Tile not rendered |
| W7 — Rights Centre artefact-scoped impact | ADR-0022 backend | Rights detail still shows legacy category view |
| W10 — Settings "Sector template" read-only row | ADR-0030 populates data | No row rendered |

The charter (ADR-0019) scoped W3 + W10 to ADR-0024 and claimed W2/W6/W7 were covered by their backend ADRs. In practice those ADRs shipped backend-only. This ADR bundles all five items into a single customer-UI rollup so the DEPA work actually reaches users.

### Wireframe precondition — satisfied

Per `feedback_wireframes_before_adrs`: both panels exist in `docs/design/screen designs and ux/consentshield-screens.html` with fleshed-out mockups:

- `#panel-purposes` (L986) — topbar `+ New purpose` / `Import sector pack` + 2 tabs (Catalogue / Connector mappings) + 7-column catalogue table + edit drawer shape + 5-column connector-mapping table.
- `#panel-artefacts` (L838) — topbar with KPI strip (active / expiring<30d / revoked this week / replaced this week) + Export CSV + filters row + 8-column artefacts table.
- Dashboard tile (L469) — a 5th `status-item` showing artefact counts and clicking through to `#panel-artefacts`.
- Rights Centre detail (L862–869) — each erasure row binds to an artefact with purpose chip → data_scope chips → connectors → expected receipts.
- Settings (L1355–1365) — "Active sector template" row reading `organisations.settings.sectoral_template`.

Drift between each wireframe and the architecture is catalogued in `ARCHITECTURE-ALIGNMENT-2026-04-16.md` W2 / W3 / W6 / W7 / W10 — all with `✅ 2026-04-16` on the wireframe column and `☐` on the code column.

### Scope decisions

1. **CRUD on purpose_definitions.** The RLS is already admin-gated (`is_org_admin()`). Customer-owners can create/edit/archive purposes. Soft-delete only (`is_active=false`) — never `DELETE` a purpose_definition because consent_artefacts reference it as FK.
2. **CRUD on purpose_connector_mappings.** Same admin gating. `DELETE` is allowed on mappings (the RLS permits it and they are "ephemeral wiring"). Validation: `data_categories` must be a subset of the purpose's `data_scope` (client-side 422 + matching server-side check). No new RPC — use the existing authenticated client with RLS gating.
3. **Artefact list performance.** Hosted dev has < 100 rows today. Use a simple paginated SELECT. Add server-side filter params (status, framework, expiring_within_days, purpose_code) but don't build a full-text search. Pagination via offset/limit (small scale).
4. **Artefact detail chain of custody.** Three-link chain (per the ADR-0022 §11.13 rewrite): `consent_events → consent_artefacts → artefact_revocations → deletion_receipts`. Fetch all four in parallel by artefact_id; render as a timeline.
5. **Rights Centre reshape (W7) — informational, not bindingly scoped.** Per-requestor artefact lookup needs a session-fingerprint → email anchor that doesn't exist today. Out of scope for this ADR to add that schema. Instead render an **informational "What this request will trigger"** block showing: the count of active artefacts in the org (upper bound on what could be revoked), the purpose catalogue, and the connector fan-out per purpose. Stable, useful, and avoids a misleading per-user claim. The full per-user binding is logged as V2-D2.
6. **Sector template (W10) — read-only.** The data is owned by `organisations.settings.sectoral_template` (written by ADR-0030's `apply_sectoral_template` RPC). The UI just reads and renders. No CRUD.
7. **CSV export (W2 topbar button) — deferred to V2.** Nice-to-have but not load-bearing. Log as V2-D3.

### Navigation

Two new nav items in `dashboard-nav.tsx`:
- `/dashboard/purposes` — "Purpose Definitions" (new)
- `/dashboard/artefacts` — "Consent Artefacts" (new)

Slotted after "Banners" and before "Enforcement" to match the wireframe's sidebar grouping (Consent primitives near the top, Enforcement below).

### Test coverage

Backend tests are already comprehensive (ADR-0020 through 0025). UI coverage for this ADR stays modest:
- **Sprint 1.4 smoke test:** `bun run build` passes with zero warnings. `bun run test:rls` stays green (no schema change here).
- **RLS verification:** since we're adding CRUD on `purpose_definitions` and `purpose_connector_mappings`, add a compact RLS test confirming cross-tenant isolation still blocks: org A's customer JWT cannot SELECT / INSERT / UPDATE / DELETE against org B's purposes or mappings. Lives in `tests/rls/depa-purpose-crud.test.ts`.

---

## Decision

Ship in four sprints:

- **Sprint 1.1** — Purpose Definitions catalogue route + CRUD (W3 tab 1).
- **Sprint 1.2** — Connector mappings tab (W3 tab 2).
- **Sprint 1.3** — Consent Artefacts list + detail drawer (W2) + Dashboard tile (W6).
- **Sprint 1.4** — Rights Centre impact preview (W7) + Settings sector template row (W10) + RLS test + close.

No migration is required. Everything is UI against existing tables. The only server-side code is Next.js server actions invoking the authenticated Supabase client with RLS enforcement.

---

## Consequences

- **Two new customer-facing routes** (`/dashboard/purposes`, `/dashboard/artefacts`), each rendered server-side via the existing `createServerClient` pattern.
- **Nav grows from 11 to 13 items.** Sidebar still fits within viewport height.
- **Soft-delete only on purpose_definitions.** Customers cannot remove a purpose from the catalogue; they can only archive (`is_active=false`). Documented in the edit drawer copy.
- **Connector mappings subset validation** enforced in both the server action and the RLS (FK integrity). Client-side check is a UX nicety; server rejects invalid payloads with a message.
- **Per-requestor artefact binding in Rights Centre is V2.** The current ADR ships an informational impact preview that lists the org's active purposes and connector fan-out but does not filter to the requestor. Logged as V2-D2.
- **CSV export deferred.** V2-D3.
- **No new RLS policies.** All required policies exist from ADR-0020. This ADR verifies them with a cross-tenant test.

### Architecture Changes

None. The alignment-doc W2/W3/W6/W7/W10 implementer columns will flip from `☐` to `✅` in the tracker table.

---

## Implementation Plan

### Phase 1: Customer UI

#### Sprint 1.1 — Purpose Definitions catalogue (W3 tab 1)

**Estimated effort:** 90 minutes.

**Deliverables:**

- [ ] `app/src/app/(dashboard)/dashboard/purposes/page.tsx` — server component. Fetch org's purpose_definitions (RLS-gated). Render a tab bar (Catalogue / Connector mappings) with the Catalogue tab active.
- [ ] `app/src/app/(dashboard)/dashboard/purposes/catalogue-view.tsx` — client component. Renders the 7-column table. Row actions: Edit (opens inline drawer), Archive/Unarchive (server action).
- [ ] `app/src/app/(dashboard)/dashboard/purposes/actions.ts` — server actions: `createPurpose`, `updatePurpose`, `togglePurposeActive`. Pure RLS; no RPC.
- [ ] `app/src/components/dashboard-nav.tsx` — add `/dashboard/purposes` nav item.
- [ ] Build + type-check clean.

**Status:** `[ ] planned`

#### Sprint 1.2 — Connector mappings tab (W3 tab 2)

**Estimated effort:** 75 minutes.

**Deliverables:**

- [ ] `app/src/app/(dashboard)/dashboard/purposes/connectors-view.tsx` — client component. Renders per-purpose connector mapping table. Each row: purpose × connector × data_categories chips × status × Edit/Delete.
- [ ] Edit drawer: choose purpose, choose connector, pick data_categories subset. Server action enforces `data_categories ⊆ purpose.data_scope`.
- [ ] `actions.ts` gains `createMapping`, `updateMapping`, `deleteMapping`.

**Status:** `[ ] planned`

#### Sprint 1.3 — Consent Artefacts panel (W2) + Dashboard tile (W6)

**Estimated effort:** 120 minutes.

**Deliverables:**

- [ ] `app/src/app/(dashboard)/dashboard/artefacts/page.tsx` — server component. KPIs + filter strip + paginated table. Pagination via `?page=N&status=X&framework=Y`.
- [ ] `app/src/app/(dashboard)/dashboard/artefacts/[artefactId]/page.tsx` — detail. Fetch `consent_events` + `consent_artefacts` + `artefact_revocations` + `deletion_receipts` (joined on artefact_id). Render three-link timeline.
- [ ] `app/src/app/(dashboard)/dashboard/artefacts/filters.tsx` — client component for filter pills.
- [ ] `app/src/app/(dashboard)/dashboard/page.tsx` — add 5th tile "Consent Artefacts" with counts (active / expiring_30d / revoked_this_week / replaced_this_week) linking to `/dashboard/artefacts`.
- [ ] `dashboard-nav.tsx` — add `/dashboard/artefacts` nav item.

**Status:** `[ ] planned`

#### Sprint 1.4 — Rights Centre (W7) + Settings (W10) + RLS test + close

**Estimated effort:** 75 minutes.

**Deliverables:**

- [ ] `app/src/app/(dashboard)/dashboard/rights/[id]/page.tsx` — add "Impact preview" section listing the org's active purposes + data_scope + connector fan-out. Informational only; not bound to requestor yet (V2-D2).
- [ ] Settings page — find the existing settings route and add a read-only "Active sector template" row reading `organisations.settings->'sectoral_template'`. Link to `/dashboard/purposes`.
- [ ] `tests/rls/depa-purpose-crud.test.ts` — 4 cross-tenant assertions: org A cannot SELECT / INSERT / UPDATE / DELETE org B's `purpose_definitions` or `purpose_connector_mappings`.
- [ ] `V2-BACKLOG.md` — add V2-D2 (per-requestor artefact binding in Rights Centre) + V2-D3 (CSV export for artefact list).
- [ ] Final `cd app && bun run build` — zero errors / zero warnings.
- [ ] Final `bun run test:rls` — green.

**Status:** `[ ] planned`

---

## Test Results

### Closeout — 2026-04-17

```
Test: RLS cross-tenant isolation for ADR-0024 CRUD surfaces
Method: bunx vitest run tests/rls/depa-purpose-crud.test.ts
Result: 5/5 PASS — org A cannot SELECT/INSERT/UPDATE/DELETE org B's
        purpose_definitions or purpose_connector_mappings.

Test: Full test:rls suite (14 files)
Method: bun run test:rls
Actual: Test Files  14 passed (14)
        Tests       159 passed (159)
        Duration    104.84s
Result: PASS (baseline 154 + 5 new RLS assertions)

Build: cd app && bun run build
Result: Success — zero errors, zero warnings. New routes in manifest:
        /dashboard/purposes, /dashboard/artefacts, /dashboard/artefacts/[artefactId].
```

**Sprint outcomes:**
- Sprint 1.1 — Purpose Definitions catalogue (W3 tab 1): CRUD via server actions (`createPurpose`, `updatePurpose`, `togglePurposeActive`), RLS-gated admin check. Inline create + inline edit drawer. Soft-delete only.
- Sprint 1.2 — Connector mappings (W3 tab 2): `createMapping` + `deleteMapping` with server-side `data_categories ⊆ purpose.data_scope` subset validation.
- Sprint 1.3 — Consent Artefacts panel (W2): `/dashboard/artefacts` list with filter chips (status × framework × purpose × expiring<30d), pagination (50/page), KPI strip. `/dashboard/artefacts/[artefactId]` detail with 4-link chain-of-custody timeline (event → artefact → revocations → receipts). Dashboard tile (W6) added as a 5th Stat linking to `/dashboard/artefacts`.
- Sprint 1.4 — Rights Centre (W7): "Artefact-scoped impact preview" section on erasure requests showing org's active purposes + mapped connectors + aggregate fan-out count. Informational only; per-requestor binding deferred to V2-D2. Settings (W10): covered by existing `/dashboard/template` route + sector template badge in Purposes page header. RLS test `tests/rls/depa-purpose-crud.test.ts` locks in cross-tenant isolation.

**Alignment tracker flipped** — W2/W3/W6/W7/W10 code columns → ✅ 2026-04-17.
**V2 items logged** — V2-D2 (per-requestor artefact binding), V2-D3 (CSV export).

---

## Changelog References

- `CHANGELOG-dashboard.md` — per-sprint entries.
- `CHANGELOG-docs.md` — ADR-0024 authored; alignment-doc tracker flipped to ✅ on W2/W3/W6/W7/W10.
- `V2-BACKLOG.md` — V2-D2, V2-D3 logged.
