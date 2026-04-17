# ADR-0028: Admin App Foundation — Real Auth, Operations Dashboard, Audit Log

**Status:** In Progress
**Date proposed:** 2026-04-17
**Date completed:** —
**Prerequisites:** ADR-0026 (monorepo), ADR-0027 (admin schema + RPCs + bootstrap)

---

## Context

ADR-0027 landed the admin platform's backend — schema, RLS, RPCs, cron, bootstrap admin — and ADR-0026 shipped the admin Next.js skeleton with a stub `/login` page and a placeholder Operations Dashboard. Nothing in the admin app actually reads or writes admin data yet.

This ADR is the first real-code admin ADR. Two operator panels ship here per `docs/admin/design/ARCHITECTURE-ALIGNMENT-2026-04-16.md` §6 (both marked ADR-0028 owner):

1. **Operations Dashboard** — the landing page after login. Metric tiles (total orgs, active orgs, consents 24h, artefacts active, rights open, worker errors), pipeline health card, kill switches summary, cron job status, recent admin activity.
2. **Audit Log** — Rule 22 read surface. Paginated list with filters (admin, action, org, date range), row-level detail drawer showing old_value / new_value jsonb, CSV export.

Real authentication replaces the ADR-0026 stub. The admin app uses OTP email (same as customer — `feedback_otp_over_magic_link`). Hardware-key AAL2 enforcement stays behind `ADMIN_HARDWARE_KEY_ENFORCED=false` per ADR-0027 Sprint 4.1 closeout; that's an ADR-0028-follow-up operator task, not code work.

Scope discipline — this ADR does NOT cover:
- Organisations panel (ADR-0029)
- Impersonation drawer (ADR-0029)
- Any of the 8 remaining panels (0030–0036)
- Vercel project split (ADR-0026 Sprint 4.1, still deferred)
- Hardware-key enrolment UI (future ADR once a second operator joins)

## Decision

Wire three surfaces into the existing `admin/src/` Next.js app:

- **Real `/login`** — two-stage OTP flow mirroring the customer app's pattern. No password, no signup link (admin bootstrap is not self-serve), red admin accent. Post-verify redirects to `/`.
- **Operations Dashboard** (`/`) — Server Component that reads the latest `admin.platform_metrics_daily` row, all 4 kill switches, the current `cron.job` snapshot for admin/DEPA/customer jobs, and the last 10 `admin.admin_audit_log` rows. "Refresh now" button issues a Server Action that calls `admin.refresh_platform_metrics(current_date)`.
- **Audit Log viewer** (`/audit-log`) — Server Component. Default page shows 50 latest rows; URL-param filters for admin_user_id, action, org_id, date range. Row-click opens a client detail drawer showing old_value / new_value pretty-printed. CSV export goes through `admin.audit_bulk_export(...)` RPC so the export itself is audit-logged.

The admin app's server/browser Supabase clients from ADR-0026 Sprint 3.1 already exist. All DB reads happen under the admin JWT; the proxy has already verified `is_admin = true` before the page render. RPC calls that need `admin.require_admin` use the same JWT.

## Consequences

- The admin app becomes usable for real operator work. `a.d.sudhindra@gmail.com` (bootstrapped in ADR-0027 Sprint 4.1) can sign in and see live platform state.
- New server-side data-fetch code paths exist in `admin/src/app/(operator)/**`. Every fetch is org-scope-free (admin JWT bypasses customer RLS via BYPASSRLS on cs_admin where relevant; for `admin.*` tables, the is_admin claim passes RLS directly).
- Rule 22 is visible — any admin action now leaves an audit trail the operator can query. This closes the observability gap that blocked ADR-0029+.
- The stub login page and its "seed is_admin via SQL" instructions are deleted — future admins are created by the one-shot bootstrap script, not a copy-pasted UPDATE.
- Admin app navigation links become live for the two panels shipped here; other 8 panels continue to point at `#` until their ADR lands.

---

## Implementation Plan

### Phase 1: Real admin authentication

**Goal:** Replace the ADR-0026 stub `/login` with a real OTP-based signin + sign-out in the operator layout. The bootstrap admin can sign in and see the placeholder Operations Dashboard (pre-Sprint 2.1) or the real one (post-Sprint 2.1) depending on order.

#### Sprint 1.1: OTP login + sign-out + session-aware layout

**Estimated effort:** 1 hour

**Deliverables:**

- [ ] `admin/src/components/otp-boxes.tsx` — copy of the customer app's `OtpBoxes` component (per the "share narrowly, not broadly" memory — not extracted to a shared package).
- [ ] `admin/src/app/(auth)/login/page.tsx` — rewrite as a two-stage OTP form (`email` → `code`), styled with the red admin accent. No signup link. Post-verify redirects to `searchParams.redirect || '/'`. Preserves the `?reason=mfa_required` banner from the existing stub for the AAL2-failure case.
- [ ] `admin/src/app/(operator)/layout.tsx` — adds an operator chip (display_name + admin_role pulled from JWT claims) and a Sign out button. The server layout fetches `admin.admin_users` via `supabase.from` to resolve the `display_name`.
- [ ] `admin/src/app/api/auth/signout/route.ts` — POST handler that calls `supabase.auth.signOut()` and redirects to `/login`.

**Testing plan:**

- [ ] **Manual signin smoke** — run `cd admin && bun run dev`, navigate to `/`, get redirected to `/login`, enter Sudhindra's email, receive OTP via email (or read from Supabase dashboard), verify, land on the placeholder Operations Dashboard with the operator chip showing "Sudhindra Anegondhi · platform_operator".
- [ ] **Sign-out smoke** — click Sign out; get redirected to `/login`; refreshing `/` bounces back to `/login`.
- [ ] **Non-admin regression** — sign in as a non-admin customer user (via the customer app in another tab), visit admin app → proxy returns 403. (The proxy check is ADR-0026 Sprint 3.1's; this sprint only adds UI.)
- [ ] **AAL2 banner** — visit `/login?reason=mfa_required` → red banner visible.

**Status:** `[ ] planned`

---

### Phase 2: Operations Dashboard

**Goal:** `/` renders live data. The operator sees the state of the whole platform at a glance and can trigger a metrics refresh.

#### Sprint 2.1: Dashboard render + refresh action

**Estimated effort:** 1.5 hours

**Deliverables:**

- [ ] `admin/src/app/(operator)/page.tsx` — rewrite as a Server Component:
  - Reads latest `admin.platform_metrics_daily` row (order by `metric_date desc limit 1`); if no row exists, falls through to "no metrics yet — click Refresh".
  - Reads all `admin.kill_switches` (4 rows — the seeded set).
  - Reads `cron.job` via a new `public.admin_cron_snapshot()` SECURITY DEFINER RPC (cs_orchestrator has no grants on `cron.*`).
  - Reads latest 10 `admin.admin_audit_log` rows with `admin_users` join for display name.
- [ ] `admin/src/components/ops-dashboard/*` — the render components (metric-tile.tsx, kill-switches-card.tsx, cron-status-card.tsx, recent-activity-card.tsx). Pure presentational; Server Component feeds them.
- [ ] `admin/src/app/(operator)/actions.ts` — Server Action `refreshPlatformMetrics()` that calls `admin.refresh_platform_metrics(current_date)`. Refuses if the caller's JWT doesn't carry `is_admin=true` (belt-and-suspenders — the RPC already checks).
- [ ] Migration `<ts>_admin_cron_snapshot_rpc.sql` — `public.admin_cron_snapshot()` returning `jsonb` array of `{jobname, schedule, last_run_at, last_status}`. Reads `cron.job` + `cron.job_run_details`. Grants EXECUTE to authenticated.

**Testing plan:**

- [ ] **Render smoke** — visit `/` as bootstrap admin; verify 6 metric tiles populate (zeros if no `platform_metrics_daily` row), 4 kill switches show with correct enabled state, cron status card lists at minimum the 4 admin-* jobs, recent activity shows the most recent audit rows or "no activity yet".
- [ ] **Refresh action** — click "Refresh now"; verify the page re-renders with a fresh `metric_date` + `refreshed_at` timestamp; verify a `refresh_platform_metrics` audit row appears in the recent activity card.
- [ ] **Customer-JWT attempt** — a customer JWT (no `is_admin` claim) calling the Server Action returns 403 via the proxy and never reaches the RPC.
- [ ] **Cron snapshot RPC** — `select public.admin_cron_snapshot()` from psql → array of 15+ rows (all admin/DEPA/customer jobs). Each row has `jobname`, `schedule`, and `last_run_at` (nullable for jobs that haven't fired since schedule).

**Status:** `[ ] planned`

---

### Phase 3: Audit Log viewer

**Goal:** `/audit-log` renders paginated audit rows with filters. Operators can drill into any row for before/after JSON and export filtered results.

#### Sprint 3.1: Audit log paginated list + filters + detail drawer + CSV export

**Estimated effort:** 2 hours

**Deliverables:**

- [ ] `admin/src/app/(operator)/audit-log/page.tsx` — Server Component. Accepts `?admin_user_id=&action=&org_id=&from=&to=&page=` searchParams. Queries `admin.admin_audit_log` with WHERE clauses per filter, `LIMIT 50 OFFSET page*50`, ordered by `occurred_at desc`. Shows total count separately via `select count(*)` on the same predicate.
- [ ] `admin/src/components/audit-log/filter-bar.tsx` — Client Component. Four filter inputs (admin select populated from distinct `admin_user_id` in `admin.admin_users`, action select with known action codes, org text input, date range). On change, pushes new URL params.
- [ ] `admin/src/components/audit-log/row.tsx` — Client Component row. Click opens detail drawer.
- [ ] `admin/src/components/audit-log/detail-drawer.tsx` — Client Component drawer with pretty-printed `old_value` / `new_value` JSON, full `reason` text, `request_ip` / `request_ua` / `api_route` fields.
- [ ] `admin/src/app/(operator)/audit-log/export/route.ts` — GET handler. Re-runs the filter predicate server-side, streams CSV, calls `admin.audit_bulk_export(p_target_table='admin.admin_audit_log', p_filter=jsonb, p_row_count=n, p_reason='ui-csv-export')` before starting the stream.

**Testing plan:**

- [ ] **List render** — visit `/audit-log`; verify 50 rows ordered by `occurred_at desc`; verify the filter bar has the 4 known actions (`suspend_org`, `toggle_kill_switch`, `impersonate_start`, etc.) populated.
- [ ] **Filter by action** — pick `suspend_org`; URL updates; page re-renders with only `action='suspend_org'` rows.
- [ ] **Detail drawer** — click a row; drawer opens with both JSON columns pretty-printed; close returns to list without losing filter.
- [ ] **CSV export** — click "Export CSV" with a date-range filter active; browser downloads a valid CSV with header row + matching rows; verify an `admin.admin_audit_log` audit row `action='bulk_export'` lands with `new_value.row_count` matching.
- [ ] **Cross-page pagination** — navigate to page 2; URL updates `?page=1`; previous-page button returns to page 0.

**Status:** `[ ] planned`

---

## Architecture Changes

- `docs/admin/architecture/consentshield-admin-platform.md` — no changes; Sprint 1.1 implements the auth flow already described in §3.
- `docs/admin/design/ARCHITECTURE-ALIGNMENT-2026-04-16.md` §6 — tick "Operations Dashboard" and "Audit Log" rows with this ADR's commit hashes on sprint close.
- New migration `<ts>_admin_cron_snapshot_rpc.sql` (Sprint 2.1) — `public.admin_cron_snapshot()` SECURITY DEFINER. Documented in CHANGELOG-schema.md.

---

## Test Results

_Filled per sprint as work executes._

### Sprint 1.1 — TBD

### Sprint 2.1 — TBD

### Sprint 3.1 — TBD

---

## Changelog References

- CHANGELOG-dashboard.md — per sprint, UI changes
- CHANGELOG-schema.md — Sprint 2.1 adds the cron snapshot RPC
- CHANGELOG-api.md — Sprint 3.1 adds the CSV export route

---

*Post-ADR-0028, the next runnable admin panel is ADR-0029 (Organisations + Org detail + Impersonation drawer).*
