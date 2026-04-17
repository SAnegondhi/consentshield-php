# ADR-0029: Admin Organisations Panel — List, Detail, Actions, Impersonation

**Status:** In Progress
**Date proposed:** 2026-04-17
**Prerequisites:** ADR-0027 (admin schema + RPCs), ADR-0028 (admin app foundation)

---

## Context

ADR-0028 shipped the admin app's foundation — OTP auth, Operations Dashboard, Audit Log. The second real admin panel per the alignment doc §6 is **Organisations** — where operators see every customer org, drill into one to diagnose support tickets or data issues, and invoke the sensitive actions (suspend/restore, extend trial, start impersonation) that change a customer's reality.

This ADR also owns the cross-cutting **Impersonation drawer** (Rule 23 surface) and the two customer-side cross-references from `docs/admin/design/ARCHITECTURE-ALIGNMENT-2026-04-16.md` §4 — the "Support sessions" tab (W13) and the "Suspended org" banner state (W14).

Scope discipline — this ADR does **not** cover:
- Support Tickets panel (ADR-0032) — "Open support ticket" button on Org detail is a link only
- Sectoral Templates / Connector Catalogue / Tracker Signatures / Pipeline / Billing / Abuse&Security / Feature Flags — ADR-0030..0036

## Decision

Ship four sprints:

1. **Sprint 1.1 (read-only)** — Organisations list panel with filters + search; Org detail page with health/billing/configuration cards + recent activity timeline + operator notes read.
2. **Sprint 2.1 (actions)** — Four action modals on Org detail: Add note, Extend trial, Suspend, Restore. All call existing ADR-0027 Sprint 3.1 RPCs (`admin.add_org_note`, `admin.extend_trial`, `admin.suspend_org`, `admin.restore_org`). Reason ≥ 10 chars enforced client-side for snappy feedback; server RPC still enforces as the true gate.
3. **Sprint 3.1 (impersonation)** — Impersonation drawer (Reason dropdown + Reason detail textarea + Duration). `admin.start_impersonation` returns a session_id; admin app sets a session cookie; every subsequent server-side customer-data read forwards the session_id to the DB via `set_config('app.impersonation_session_id', ...)` so audit rows bind to the session. Active-session banner across the admin shell. End-session button.
4. **Sprint 4.1 (customer-side cross-refs)** — Customer app `/dashboard/settings` gets a "Support sessions" tab reading `public.org_support_sessions`. Cloudflare Worker's `banner.ts` serves the no-op variant when `public.organisations.status='suspended'` (leveraging the `banner_delivery` path without touching the kill switch). Customer dashboard shell shows a visible "Your org is suspended — contact support" banner.

## Consequences

- Operators can actually do customer-support work after this ADR. Before: admin console is observability-only (Ops Dashboard + Audit Log). After: full lifecycle management of customer orgs with audit trail.
- Rule 23 becomes enforceable end-to-end. Every customer-data read during an impersonation session carries the session_id; audit rows reference it; the customer-side Support Sessions tab exposes the same sessions to the customer for accountability.
- `admin.org_notes` ungates from "RPC-only" to "visible in the product" — notes become part of operator shift handovers.
- Customer app gets its first admin-originated UI affordances (suspension banner + support sessions tab). These are small but visible; they need the customer wireframes updated in lockstep.

---

## Implementation Plan

### Phase 1: List + Detail (read-only)

#### Sprint 1.1: Organisations list + Org detail pages

**Estimated effort:** 2.5 hours

**Deliverables:**

- [ ] `admin/src/app/(operator)/orgs/page.tsx` — Server Component. Reads `public.organisations` with `organisation_members` / `consent_events` joins for "last active" + "open rights requests". Supports `?plan=&status=&q=&page=` searchParams. 50 per page.
- [ ] `admin/src/app/(operator)/orgs/[orgId]/page.tsx` — Server Component. Loads the org + Worker-shaped stats (latest consent_event, artefact count, billing state) + the operator notes timeline (from `admin.org_notes`) + the support-sessions timeline (from `admin.impersonation_sessions`).
- [ ] `admin/src/components/orgs/filter-pills.tsx` + `search-bar.tsx` + `org-table.tsx` — client helpers for the list panel.
- [ ] `admin/src/components/orgs/health-card.tsx` + `billing-card.tsx` + `config-card.tsx` + `notes-timeline.tsx` + `recent-activity.tsx` — server-rendered detail cards.
- [ ] Layout nav: flip "Organisations" from `#` to `/orgs`.

**Testing plan:**

- [ ] Build clean / lint clean / admin smoke 1/1.
- [ ] Visit `/orgs` as bootstrap admin; verify list renders with real orgs from `public.organisations`.
- [ ] Apply `?plan=Pro`; URL updates, list filters. Search `?q=acme`; list narrows.
- [ ] Click an org; detail page renders all three cards.
- [ ] Customer-regression — full test suite still 178/178.

**Status:** `[ ] planned`

---

### Phase 2: Actions

#### Sprint 2.1: Add note / extend trial / suspend / restore

**Estimated effort:** 1.5 hours

**Deliverables:**

- [ ] `admin/src/app/(operator)/orgs/[orgId]/actions.ts` — four Server Actions wrapping the four RPCs. Each validates `reason.length >= 10` before calling the RPC (so the user gets a client-side error instantly; the RPC still enforces).
- [ ] `admin/src/components/orgs/action-bar.tsx` — four buttons in the Org detail header. Each opens a modal form (Client Component).
- [ ] Modal components: `add-note-modal.tsx`, `extend-trial-modal.tsx`, `suspend-modal.tsx` (platform_operator-only button; support-role admins see it disabled with tooltip), `restore-modal.tsx` (appears only when `status='suspended'`).

**Testing plan:**

- [ ] Add a note on a test org → notes timeline updates; an `add_org_note` audit row lands.
- [ ] Extend trial to a date 30 days out → org's `trial_ends_at` updates; audit row lands.
- [ ] Suspend → org's `status='suspended'`; restore reverts it; both audit.
- [ ] Reason < 10 chars → client-side error; no RPC call.
- [ ] Support-role admin sees Suspend disabled.

**Status:** `[ ] planned`

---

### Phase 3: Impersonation

#### Sprint 3.1: Impersonation drawer + session lifecycle

**Estimated effort:** 2 hours

**Deliverables:**

- [ ] `admin/src/components/impersonation/start-drawer.tsx` — Client drawer opened from Org detail. Reason select (5 codes per schema doc §3.3), Reason detail textarea (≥ 10 chars live counter), Duration select (15 / 30 / 60 / 120 min). Submit calls a Server Action → `admin.start_impersonation(...)` → sets an httpOnly cookie `cs_admin_impersonation` = `{session_id, target_org_id, expires_at}`.
- [ ] `admin/src/components/impersonation/active-session-banner.tsx` — Server Component rendered in the operator layout. When the cookie is present, shows a red banner across the top with "Impersonating org X — ends in Y minutes" + End session button.
- [ ] `admin/src/app/(operator)/actions.ts` extends with `startImpersonation`, `endImpersonation`, `forceEndImpersonation` (platform_operator only).
- [ ] `admin/src/lib/impersonation.ts` — helper that every server-side customer-data read pipes through: reads the cookie; if present and not expired, calls `supabase.rpc('exec_sql', {q: "select set_config('app.impersonation_session_id', $1, true)"})` — but that RPC doesn't exist, so instead: add a new SECURITY DEFINER `public.set_impersonation_context(session_id uuid)` RPC that the helper calls once per request. Audit rows from the request inherit the session via `current_setting('app.impersonation_session_id', true)` which the RPC template in ADR-0027 already reads.
- [ ] Migration `<ts>_set_impersonation_context_rpc.sql` — the helper RPC.

**Testing plan:**

- [ ] Start impersonation from Org detail → drawer opens, Reason dropdown + detail required, Duration defaults to 30 min.
- [ ] Submit with reason_detail < 10 chars → client-side error.
- [ ] Valid submit → session row in `admin.impersonation_sessions`, cookie set, red banner shows, `impersonate_start` audit row.
- [ ] While session active, calling a subsequent RPC (e.g. Add note) — the audit row's `impersonation_session_id` is populated.
- [ ] End session → cookie cleared, banner hidden, `impersonate_end` audit row.
- [ ] Expiry — after `expires_at`, banner shows "expired" + cookie clears on next nav.

**Status:** `[ ] planned`

---

### Phase 4: Customer-side cross-references

#### Sprint 4.1: Support sessions tab + suspended-org banner

**Estimated effort:** 1.5 hours

**Deliverables:**

- [ ] `app/src/app/(dashboard)/dashboard/settings/support-sessions/page.tsx` (or a new tab in an existing settings page) — reads `public.org_support_sessions` scoped to the authenticated user's org. Timeline of sessions with start/end/reason/duration.
- [ ] `worker/src/banner.ts` — before serving the real banner, check if `public.organisations.status='suspended'`; serve no-op if yes. Reuses the Sprint 3.2 admin-config snapshot path (kill switch) semantically — but the check here is per-org not global.
- [ ] `app/src/components/dashboard/suspended-banner.tsx` — client component shown in `(dashboard)/layout` when the current org's status is `suspended`. Copy explains the state + "Contact support" link.
- [ ] Update customer-side wireframes (`docs/design/screen designs and ux/consentshield-screens.html`) — add W13 Support sessions tab + W14 suspension banner state.
- [ ] Update customer alignment doc §6 with W13 + W14 ticked.

**Testing plan:**

- [ ] Start an impersonation against a test org → customer tab for that org shows the session row.
- [ ] Suspend the test org → the test org's dashboard shows the suspension banner; their test site's banner served from the Worker returns the no-op.
- [ ] Restore → both return to normal.
- [ ] RLS regression — customer A cannot see customer B's support sessions.

**Status:** `[ ] planned`

---

## Architecture Changes

- `docs/admin/architecture/consentshield-admin-platform.md` §7.1 — no changes; describes the admin API surface already in place.
- `docs/admin/design/ARCHITECTURE-ALIGNMENT-2026-04-16.md` §6 — tick Organisations row + close W-Admin-CustomerVisibility and W-Admin-OrgSuspension on Sprint 4.1.
- New migration `<ts>_set_impersonation_context_rpc.sql` (Sprint 3.1).
- `docs/design/screen designs and ux/consentshield-screens.html` — new W13 Support sessions tab + W14 suspension banner (Sprint 4.1).
- `docs/design/screen designs and ux/ARCHITECTURE-ALIGNMENT-2026-04-16.md` — close W13 + W14 (Sprint 4.1).

---

## Test Results

_Filled per sprint as work executes._

### Sprint 1.1 — TBD

### Sprint 2.1 — TBD

### Sprint 3.1 — TBD

### Sprint 4.1 — TBD

---

## Changelog References

- CHANGELOG-dashboard.md — per sprint (admin UI changes)
- CHANGELOG-schema.md — Sprint 3.1 `set_impersonation_context` RPC
- CHANGELOG-worker.md — Sprint 4.1 suspension check

---

*Post-ADR-0029, next runnable admin panel is ADR-0030 (Sectoral Templates).*
