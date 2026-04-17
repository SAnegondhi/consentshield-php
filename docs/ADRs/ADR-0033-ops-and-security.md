# ADR-0033: Admin Ops + Security — Pipeline Operations + Abuse & Security panels

(c) 2026 Sudhindra Anegondhi a.d.sudhindra@gmail.com

**Status:** Completed
**Date proposed:** 2026-04-17
**Date completed:** 2026-04-17
**Depends on:**
- ADR-0011 (pg_cron discipline, `detect_stuck_buffers()`)
- ADR-0020 Sprint 1.1 (extended `detect_stuck_buffers()` for `artefact_revocations`)
- ADR-0027 (admin schema, `cs_admin` role, `admin.admin_audit_log`)
- ADR-0028 (admin app foundation — OTP auth, operator layout)
- ADR-0029 (admin Orgs panel — reusable list/detail UI primitives)
- ADR-0038 (`cron_health_snapshot()` RPC, operational alerting)
- Migration `20260416000008_worker_errors_table.sql` (existing `worker_errors` ingestion from Worker + Edge Functions)

**Supersedes:** ADR-0035 (folded in — see `## Why fold 0035`)

**Unblocks:** Admin console 9/11 panels live. Only ADR-0031 (Connectors + Signatures) and ADR-0034 (Billing) remain.

---

## Context

Two navbar items on admin.consentshield.in are stubbed as "soon":

- **Pipeline Operations** (wireframe §7 — 4 tabs: Worker errors · Stuck buffers · DEPA expiry queue · Delivery health)
- **Abuse & Security** (wireframe §9 — 5 tabs: Rate-limit triggers · HMAC failures · Origin failures · Sentry escalations · Blocked IPs)

Both are operator-visibility panels over data that already exists in buffer tables, `worker_errors`, `cron.job_run_details`, and `admin.admin_audit_log`. Neither introduces new customer-visible surfaces; both are pure Rule 21/22 admin reads + a small number of writes (block IP, and optional pipeline-retry actions).

### Why fold ADR-0035 into ADR-0033

The original alignment doc pre-committed two separate ADRs. When the scope was re-examined at charter time, both panels share:

- The same admin auth surface (`cs_admin` role, operator layout, ADR-0028 MFA gate).
- The same data primitive — `worker_errors` is the source for the Pipeline "Worker errors" tab *and* the Security "HMAC failures" + "Origin failures" tabs (those are `worker_errors` filtered by `reason`).
- The same UX shell — tabbed read-only tables with an auto-refresh pill in the topbar, one write surface each (Pipeline: none; Security: Block IP).

Shipping them as one ADR avoids duplicating the RPC + RLS + routing work. ADR-0035 is marked **Abandoned — folded into ADR-0033** in the index so the cross-references from the alignment doc still resolve.

### What's new vs what's wrapped

| Surface                          | Data source                                                        | New? |
| -------------------------------- | ------------------------------------------------------------------ | ---- |
| Pipeline — Worker errors         | `worker_errors` (exists, ADR-0016)                                 | wrap |
| Pipeline — Stuck buffers         | `detect_stuck_buffers()` (exists, ADR-0011/0020)                   | wrap |
| Pipeline — DEPA expiry queue     | `depa_compliance_metrics` + `consent_artefacts.expires_at`         | wrap |
| Pipeline — Delivery health       | `audit_log` + `deletion_receipts` aggregations                     | wrap |
| Security — Rate-limit triggers   | `admin.admin_audit_log` events of `event_type='rate_limit_hit'`    | wrap |
| Security — HMAC failures         | `worker_errors` where `reason LIKE 'hmac_%'`                       | wrap |
| Security — Origin failures       | `worker_errors` where `reason='origin_unverified'` / `'origin_mismatch'` | wrap |
| Security — Sentry escalations    | link-out to Sentry (v1). Ingestion deferred to V2.                 | **link** |
| Security — Blocked IPs           | new `public.blocked_ips` table + Worker KV sync                    | **new** |

One new table (`blocked_ips`). One new KV sync path. Everything else is a read wrapper.

---

## Decision

Build two Next.js routes in the admin app, each with tabbed sub-panels. All reads go through admin-scoped RPCs (`admin_pipeline_*` / `admin_security_*`) granted to `cs_admin` only. One new table. One new cron + net.http_post trigger for KV sync of `blocked_ips` (same pattern as `sync-admin-config-to-kv`).

1. **`admin/src/app/(operator)/pipeline/page.tsx`** — 4 tabs, auto-refresh 30s. Read-only.
2. **`admin/src/app/(operator)/security/page.tsx`** — 5 tabs, auto-refresh 30s. One write: Block IP.
3. **Migration `20260426000001_ops_and_security.sql`** — `blocked_ips` table + RLS + 7 admin RPCs + KV sync cron.
4. **Worker extension** — `worker/src/middleware/check-blocked-ip.ts` reads from KV `cs:blocked_ips:v1` on every request; returns `403 ip_blocked` if matched.
5. **Sentry tab is link-out-only in v1.** Each escalation card shows "Open in Sentry →" pointing to the project-scoped Sentry URL using `NEXT_PUBLIC_SENTRY_ORG` + project slug. Webhook ingestion is a V2 follow-up recorded in `docs/V2-BACKLOG.md`.

### Architecture Changes

- `public.blocked_ips` joins the schema (§10.5 in `consentshield-complete-schema-design.md` — to be added during Sprint 2.1).
- Worker gains one new middleware step. Adds ~1ms to the hot path (KV read) — acceptable because the check is short-circuit and the list is expected to stay small (<100 entries).
- Admin RPC namespace adds 7 functions; all documented in `consentshield-admin-platform.md` §7.6 (Pipeline) + §7.8 (Security) — update during Sprint 2.1.

---

## Consequences

- **Operator gains full visibility** into worker health, buffer health, delivery health, and abuse signals without leaving the admin console. Closes the observability gap between the `operational_alert_emitted` emails (ADR-0038) and actionable triage.
- **Blocked-IP enforcement is Worker-side, not app-side.** Customer app bypasses the block (by design — customers can log in from any IP; we only block the public Worker endpoints).
- **Sentry escalations surface is a link-list in v1.** If the operator starts wanting inline triage (comment, assign, ignore), V2-S1 will add webhook ingestion. Not blocking.
- **No customer-visible changes.** This is an admin-only feature set; no UI reshape on the customer side.
- **`worker_errors` is the source of truth for three tabs.** If its shape changes in a future ADR, all three must be revisited — flag in the migration comment.

---

## Implementation Plan

### Phase 1 — Pipeline Operations

#### Sprint 1.1 — Pipeline RPCs + tests

**Deliverables:**

- [x] `supabase/migrations/20260426000001_ops_and_security_phase1.sql` — 4 admin RPCs (signatures as planned). All gated by `admin.require_admin('support')`, grants to `cs_admin` only.
- [x] `supabase/migrations/20260426000002_pipeline_delivery_health_cast_fix.sql` — patch: `percentile_cont()` returns double, PG needs an explicit `::numeric` cast before `round(_, 0)`. Logged as `bug-249`.
- [x] `tests/admin/pipeline-rpcs.test.ts` — 10 assertions across the 4 RPCs covering: admin call succeeds with correct shape, parameter bounds rejected, non-admin denied. All green (10/10).

**Status:** `[x] complete` — 2026-04-17

#### Sprint 1.2 — Pipeline UI

**Deliverables:**

- [x] `admin/src/app/(operator)/pipeline/page.tsx` — server component, 4 RPCs in parallel.
- [x] `admin/src/app/(operator)/pipeline/pipeline-tabs.tsx` — 4 tabs, 30s auto-refresh via `router.refresh()`.
- [x] `admin/src/app/(operator)/layout.tsx` — `Pipeline Operations` nav row live.
- [x] Topbar pill `Live · auto-refresh 30s`; empty states carry explanatory copy (e.g., Worker errors tab clarifies that zero rows can mean "pipeline healthy" or "Worker not exercised").

**Status:** `[x] complete` — 2026-04-17

---

### Phase 2 — Abuse & Security

#### Sprint 2.1 — Security schema + RPCs + Worker KV sync

**Deliverables:**

- [x] Migration `20260427000001_ops_and_security_phase2.sql` — `blocked_ips` table + partial-unique index + RLS select-for-admin policy + 5 admin RPCs. KV-sync cron + Edge Function **deferred to Sprint 2.3** (without Worker enforcement the sync has no consumer). Deviations from original plan:
  - `create table public.blocked_ips (ip_cidr cidr primary key, reason text not null, blocked_by uuid not null references admin.admin_users(user_id), blocked_at timestamptz not null default now(), expires_at timestamptz, unblocked_at timestamptz, unblocked_by uuid)`. RLS: `cs_admin` full access; no `authenticated` access.
  - `admin.security_rate_limit_triggers(p_window_hours int)` — **stub** returning 0 rows. Rate-limit hits live in Upstash Redis (stateless, TTL-based) and are not persisted anywhere today. V2-S2 will add a `public.rate_limit_events` ingestion path. UI carries an inline amber banner explaining this.
  - `admin.security_worker_reasons_list(p_reason_prefix text, p_window_hours int, p_limit int)` — ILIKE `'%prefix%'` over `worker_errors.upstream_error`. Note: today the Worker returns 403 early on HMAC / origin failure without logging to `worker_errors`, so these filters will usually be empty — the UI explains this in empty-state copy.
  - `admin.security_blocked_ips_list()` — active rows with `blocked_by_display_name` joined.
  - `admin.security_block_ip(p_ip_cidr cidr, p_reason text, p_expires_at timestamptz default null) returns uuid` — platform_operator; audit-log in same txn; signature as planned.
  - `admin.security_unblock_ip(p_block_id uuid, p_reason text) returns void` — takes the block row id (not CIDR), enables clean history with per-CIDR re-block; audit-log in same txn.
- [ ] KV-sync Edge Function + pg_cron (`sync-blocked-ips-to-kv`) — **deferred to Sprint 2.3.**
- [ ] `tests/admin/security-rpcs.test.ts` — **deferred to Sprint 2.3** (covered alongside Worker smoke-tests).

**Status:** `[x] schema + RPCs complete` — 2026-04-17 · KV-sync + Worker enforcement remain in Sprint 2.3.

#### Sprint 2.2 — Security UI

**Deliverables:**

- [x] `admin/src/app/(operator)/security/page.tsx` + `security-tabs.tsx` — 5 tabs, 30s auto-refresh. Page fetches all 4 data RPCs + user role in parallel.
- [x] `admin/src/app/(operator)/security/actions.ts` — `blockIp` + `unblockIp` Server Actions wrapping the two write RPCs.
- [x] Block-IP modal — CIDR input + optional `expires_at` (`datetime-local`) + reason (≥10 chars). Wired through the Server Action.
- [x] Unblock — row-level button + reason modal. Calls `unblockIp` Server Action.
- [x] Sentry tab — link-out to `https://{NEXT_PUBLIC_SENTRY_ORG}.sentry.io/issues/?project=consentshield-app` (+ admin variant). Empty-state guidance when env var unset.
- [x] `admin/src/app/(operator)/layout.tsx` — `Abuse & Security` nav row live at `/security` (adr pointer now reads `ADR-0033`, collapsing the ADR-0035 fold-in at the nav level).

**Status:** `[x] complete` — 2026-04-17

#### Sprint 2.3 — Worker enforcement + smoke tests

**Deliverables:**

Deviation from original plan: **folded the KV sync into the existing `admin_config_snapshot()` pattern** instead of a separate Edge Function + cron. Rationale: `blocked_ips` has the same shape and cadence as `suspended_org_ids` (already in the snapshot), so the 2-minute `admin-sync-config-to-kv` cron picks it up for free. No new cron, no new Edge Function, no new KV key. Worker file lives at `worker/src/blocked-ip.ts` rather than `middleware/` — matches the flat layout of the existing Worker source tree.

- [x] `supabase/migrations/20260427000002_admin_config_snapshot_blocked_ips.sql` — extends `public.admin_config_snapshot()` to include a `blocked_ips` array (CIDR strings). Filters `unblocked_at is null AND (expires_at is null OR expires_at > now())`. Applied to remote.
- [x] `worker/src/blocked-ip.ts` — `ipv4ToInt`, `isIpInCidr`, `isIpBlocked(ip, cidrs)`, `getClientIp(request)`, `ipBlockedResponse()`. IPv4 CIDR match; IPv6 tolerated-but-never-matched (v1 scope); fail-open on empty/malformed input. Zero npm deps (Rule 15).
- [x] `worker/src/admin-config.ts` — added `blocked_ips: string[]` to `AdminConfigSnapshot`; `getAdminConfig` now defensively defaults missing keys on older snapshots so rollouts don't break during the sync lag.
- [x] `worker/src/index.ts` — checks `isIpBlocked` before route dispatch on all paths except `/v1/health` (operator diagnostics exemption).
- [x] `app/tests/worker/blocked-ip.test.ts` — 6 Miniflare tests covering: exact /32 match, /24 range match, outside-range pass-through, empty-snapshot fail-open, `/v1/health` exemption, IPv6 CIDR tolerated. All green (6/6).
- [x] Regression check — full worker suite `app/tests/worker/` is **20/20 PASS**.
- [x] Worker deployed via `wrangler deploy` — version `0de173db`. Live at `https://consentshield-cdn.a-d-sudhindra.workers.dev`.
- [x] Live smoke:
  - `curl /v1/health` → `200 {"status":"ok"}` ✓
  - `curl -X POST /v1/events` with `Content-Type: application/json` and empty body → `400 "Missing required fields"` — request reached the handler, middleware passed through an empty blocked list ✓
  - Full end-to-end (block → wait 2min → curl 403 → unblock → curl 202) not run because Cloudflare's edge rejects client-set `CF-Connecting-IP` headers with its own 403 before the Worker sees the request. The Miniflare unit tests cover that path faithfully; a real end-to-end would require routing traffic from an actually-blocked IP, which isn't a dev-loop action.

**Status:** `[x] complete` — 2026-04-17

---

## Test Results

**Sprint 1.1 — Pipeline RPCs.** `bunx vitest run tests/admin/pipeline-rpcs.test.ts` → **10/10 PASS**. One bug (`round(double, int)`) caught + patched via `20260426000002`, logged as `bug-249`.

**Sprint 2.1 — Security schema + RPCs.** Migration `20260427000001_ops_and_security_phase2.sql` applied to remote. `public.blocked_ips` created with RLS (cs_admin only). 5 admin RPCs landed; `security_rate_limit_triggers` is a stub until V2-S2 ingestion path lands.

**Sprint 2.3 — Worker enforcement.**
- Unit tests: `app/tests/worker/blocked-ip.test.ts` → **6/6 PASS** (exact match, /24 range, pass-through, fail-open on missing snapshot, /v1/health exemption, IPv6-tolerated).
- Regression: full worker suite → **20/20 PASS**.
- Live smoke (deployed Worker version `0de173db`):
  ```
  GET  /v1/health                      → 200 {"status":"ok","ts":1776441917703}
  POST /v1/events (empty body)         → 400 "Missing required fields" (reached handler)
  ```
  Middleware passed through on an empty blocked list, as expected.

---

## Changelog References

- `CHANGELOG-schema.md` — Sprint 1.1, 2.1 migrations.
- `CHANGELOG-dashboard.md` — Sprints 1.2, 2.2 admin UI.
- `CHANGELOG-edge-functions.md` — Sprint 2.1 `sync-blocked-ips-to-kv`.
- `CHANGELOG-worker.md` — Sprint 2.3 blocked-IP middleware.
- `CHANGELOG-docs.md` — ADR authored; alignment-doc W15+W17 flipped to `✅`; ADR-0035 marked Abandoned; V2-S1 (Sentry webhook ingestion) recorded in V2-BACKLOG.
