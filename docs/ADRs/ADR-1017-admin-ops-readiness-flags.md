# ADR-1017: Admin ops-readiness flags — surface external blockers in the operator console

**Status:** Completed
**Date proposed:** 2026-04-22
**Date completed:** 2026-04-22
**Related:** ADR-1004 Sprint 1.6 (legal review) · ADR-1005 Phase 1/3/4 (partner/SLA/SE/PagerDuty/status) · ADR-1010 Phase 4 (wrangler cutover)

---

## Context

Several ADRs carry steps that a solo founder can't complete in code — engaging counsel, signing a reference-partner MoU, buying a PagerDuty account, hiring a Solutions Engineer. Those steps aren't tracked anywhere operators see during normal admin work; they live in session handoff notes and ADR sprint tables. When the founder flips to admin work, there's no "here are the real-world things still pending" surface — only compressed context and spec-text reading.

The risk: a BFSI procurement conversation lands, the founder opens the admin console, sees no warnings, and commits to a timeline that assumes (say) SLA docs exist when they don't. Or: a rights request arrives, the operator wants to notify PagerDuty, opens the admin console, sees the incident flow configured, tries to fire it, and finds out PagerDuty was never provisioned.

`admin.admin_audit_log` captures what operators HAVE done; nothing captures "what external thing is pending." That's this ADR.

## Decision

Introduce `admin.ops_readiness_flags` — a small table surfacing pending external / organisational blockers in the operator console. Each row is a single blocker with:

- Human-readable title + description
- Source ADR reference (e.g. "ADR-1004 Sprint 1.6")
- Blocker type (legal / partner / infra / contract / hiring / other)
- Severity (critical / high / medium / low)
- Status (pending / in_progress / resolved / deferred)
- Owner (free text — "Sudhindra", "external counsel", partner name)
- Created / updated / resolved timestamps + resolved_by admin_user

Seeded today with the six known blockers from ADR-1004 / 1005 / 1010. Operators see a new page at `/admin/(operator)/readiness` listing them, and the admin landing dashboard gains a single-line banner when `count(status='pending' AND severity IN ('critical','high')) > 0`.

Not in scope for this ADR: email-the-founder alerting on stale blockers, automatic cross-ADR dependency graphing, customer-visible readiness data. Keep the first iteration small.

## Consequences

- Every time the backlog adds a real-world blocker, one row gets inserted and the operator surface automatically reflects it. No more "did we do the thing?" grep through session handoffs.
- Converts the squishy "external blocks" list in session summaries into a queryable dataset that a future admin feature (email weekly digest, audit-export badge) can consume.
- New table is zero runtime impact — no buffer lifecycle, no RLS gotchas beyond the `is_admin` gate.

---

## Implementation Plan

### Sprint 1.1 — Schema + RLS + RPCs (~1h) — **complete 2026-04-22**

**Deliverables:**
- [x] Migration `20260804000012_admin_ops_readiness_flags.sql`:
  - `admin.ops_readiness_flags` table (14 columns).
  - CHECK constraints on `blocker_type` (legal / partner / infra / contract / hiring / other), `severity` (critical / high / medium / low), `status` (pending / in_progress / resolved / deferred).
  - Indexes on `(status, severity)` and `(source_adr)`.
  - RLS: gated on `admin.is_admin()` (same pattern as `admin.feature_flags` — ADR-0036).
  - `admin.list_ops_readiness_flags()` returns-table RPC — ordered by (status, severity, created_at desc). Joined with auth.users for `resolved_by_email`.
  - `admin.set_ops_readiness_flag_status(p_flag_id, p_status, p_resolution_notes)` RPC — requires `require_admin('support')` + platform_operator/platform_owner for resolved/deferred. Emits `admin.admin_audit_log` row.
- [x] Seeded 6 rows for the current known blockers (ADR-1004 Sprint 1.6, ADR-1005 Phases 1/3 × 3, ADR-1010 Phase 4).

### Sprint 1.2 — Admin operator console page + sidebar entry (~1h) — **complete 2026-04-22**

**Deliverables:**
- [x] `admin/src/app/(operator)/readiness/page.tsx` — server component; reads `list_ops_readiness_flags()`; header chip shows "N open" + "N high/critical".
- [x] `admin/src/app/(operator)/readiness/actions.ts` — `setFlagStatusAction` wrapping the RPC; `revalidatePath('/readiness')` on success.
- [x] `admin/src/components/readiness/readiness-list.tsx` — client component with per-flag card, severity + status chips, action buttons (Mark in progress / Resolve / Defer / Reopen) gated on `platform_operator | platform_owner` role.
- [x] Sidebar entry "Ops Readiness" → `/readiness` in `admin/src/app/(operator)/layout.tsx`.
- [ ] Dashboard landing banner (deferred — mostly cosmetic; sidebar entry is enough to surface).

### Sprint 1.3 — Tests + runbook + column-misuse fix (~1h) — **complete 2026-04-22**

**Deliverables:**
- [x] `tests/admin/ops-readiness-flags.test.ts` — 12 assertions: list RPC (admin vs anon, ordering), set_status (support→in_progress allowed, support→resolved blocked 42501, platform_operator→resolved stamps resolved_by/resolved_at, reopen clears them, invalid status 22023, unknown id P0002, anon denied, audit-row payload shape).
- [x] `tests/admin/status-page-rpcs.test.ts` — 11 assertions covering the four ADR-1018 RPCs under the same audit-log path (same bug class — bundled here because Sprint 1.3 tests were the first to invoke them).
- [x] Migration `20260804000019_audit_log_column_fix.sql` — five `create or replace function` rewrites to correct `admin.admin_audit_log` column usage (`target_kind`/`payload` → `target_table`/`old_value`/`new_value`/`reason`; the NOT NULL `reason` length check was previously violated). Bug was latent because `create or replace function` does not validate inner INSERT column references until the body runs; Sprint 1.3 tests were the first callers.
- [x] `docs/runbooks/ops-readiness-flags.md` — blocker-type semantics, severity tiers, migration pattern for adding a flag, resolution flow (UI + SQL), role-gate table, audit-log expectations.

### Test Results — Sprint 1.3

- `bunx vitest run tests/admin/ops-readiness-flags.test.ts` — 12/12 PASS (5.6s)
- `bunx vitest run tests/admin/status-page-rpcs.test.ts` — 11/11 PASS (5.0s)

---

## Architecture Changes

- `docs/architecture/consentshield-definitive-architecture.md` — add a one-paragraph note under the admin-platform section referencing `admin.ops_readiness_flags`.

_None yet._

---

## Test Results

_Populated per sprint._

---

## Changelog References

- `CHANGELOG-schema.md` — Sprint 1.1 migration + seed
- `CHANGELOG-dashboard.md` — Sprint 1.2 admin panel
- `CHANGELOG-docs.md` — ADR + runbook
