# ADR-0048: Admin Accounts panel + ADR-0033/34 deviation closeout

(c) 2026 Sudhindra Anegondhi a.d.sudhindra@gmail.com

**Status:** Completed
**Date proposed:** 2026-04-18
**Depends on:**
- ADR-0027 (admin schema, `cs_admin`, `admin.admin_audit_log`, `admin.require_admin`)
- ADR-0029 (admin Orgs panel — list+detail pattern reused here for accounts)
- ADR-0033 (Ops + Security panels — Worker HMAC/Origin failure logging closes this deviation)
- ADR-0034 (Billing Operations — Payment Failures `Suspend account` button + Adjustment modal account picker close these deviations)
- ADR-0044 (accounts/organisations hierarchy — all of this sits on that layer)

**Related deviations closed:**
- ADR-0034 Sprint 2.1 deviation — "Suspend-org shortcut deferred" (needs `admin.suspend_account`).
- ADR-0034 Sprint 2.1 deviation — "Account id is a UUID textbox in Adjustment modal" (needs admin accounts list + picker).
- ADR-0033 Security HMAC / Origin tabs — empty because the Worker 403s without writing to `worker_errors`.

---

## Context

Three rough edges, one ADR:

1. **No `admin.suspend_account`.** Billing Payment Failures lists accounts; the wireframe's "Suspend" action has no RPC backing it. Manually suspending via `admin.suspend_org` doesn't scale — an account can hold N orgs, and a single billing failure should shut them all off consistently.

2. **No Admin Accounts panel.** The Orgs panel (ADR-0029) shows organisations; the Billing panel (ADR-0034) references accounts but has no operator view of them. The Adjustment modal takes the account id as a raw UUID textbox — one typo and the operator grants a plan to the wrong account. Operators also can't see "which orgs belong to this account" without running SQL.

3. **Worker HMAC + Origin failures don't surface.** The Security HMAC Failures + Origin Failures tabs (ADR-0033) read from `public.worker_errors`, but the Worker returns 403 early on HMAC / origin rejections without writing a row. The tabs are always empty.

All three are small, independent, and close existing deviations cleanly rather than opening new surfaces.

---

## Decision

One ADR, two phases.

### Phase 1 — Admin Accounts surface (unblocks ADR-0034 deviations)

- New RPCs:
  - `admin.accounts_list(p_status text default null, p_plan_code text default null, p_q text default null)` — list for the `/accounts` index page.
  - `admin.account_detail(p_account_id uuid)` — single account + child orgs + plan fields + current active adjustment.
  - `admin.suspend_account(p_account_id uuid, p_reason text)` — platform_operator. Flips `accounts.status='suspended'` + fans out to child `organisations.status='suspended'`. Audit row with `old_value/new_value` showing both the account transition and the set of child orgs.
  - `admin.restore_account(p_account_id uuid, p_reason text)` — symmetric undo. Restores org statuses that were flipped by the matching prior suspend (tracked via audit-log reversal).
- `admin/src/app/(operator)/accounts/page.tsx` + `admin/src/app/(operator)/accounts/[accountId]/page.tsx` — list + detail, Rhymes with Orgs panel shape.
- Nav: add `Accounts` entry between `Organisations` and `Support Tickets`.
- Billing Operations Adjustment modal (ADR-0034) — UUID textbox replaced with a combobox sourced from `admin.accounts_list`. Required, typeahead-matched.
- Billing Operations Payment Failures tab — add `Suspend` button next to `Retry at Razorpay ↗` / `Refund`, gated on platform_operator.

### Phase 2 — Worker observability closure (unblocks ADR-0033 deviation)

- `worker/src/hmac.ts` + `worker/src/origin.ts` — emit a POST to `SUPABASE_URL/rest/v1/worker_errors` (or the existing `worker-errors.ts` helper if one exists) on every rejection. Category encoded as `upstream_error` prefix: `hmac_timestamp_drift`, `hmac_signature_mismatch`, `origin_missing`, `origin_mismatch`. Reuses `cs_worker` role (already has INSERT on `worker_errors`).
- Regression check: full `app/tests/worker/` suite stays green; the HMAC fail / origin fail Miniflare tests extend to assert the log row.

### Non-goals

- No billing consequence beyond status flip. Razorpay cancellation / refund is out of scope; this ADR just stops the Worker serving the account.
- No customer-facing "you are suspended" UX beyond what ADR-0044's `suspended_by_plan` banner already provides (the Worker serves a no-op via the existing `suspended_org_ids` KV path).
- No account mega-list performance tuning. Phase 1 trusts `accounts_list` to be a sub-second query at dev scale; paging lands in V2 if the table ever grows.

---

## Implementation plan

### Phase 1 — Admin Accounts surface

#### Sprint 1.1 — RPCs + tests

**Deliverables:**

- [x] `supabase/migrations/20260506000001_admin_accounts.sql` — 4 RPCs as specified; `suspend_account` returns `{flipped_org_count, flipped_org_ids}` envelope; `restore_account` reverses **only** the set of orgs captured in the last `suspend_account` audit row (so orgs suspended separately stay put). Plan-adjustment active rows + recent audit entries included in the `account_detail` envelope.
- [x] `tests/admin/account-rpcs.test.ts` — **11/11 PASS**. Covers list happy path + status filter + unknown-status rejection, detail envelope shape + missing-account, suspend fan-out + double-suspend, restore reverses only the flip set (sibling pre-suspended org unchanged), support-role denial, short-reason rejection, restore-when-not-suspended rejection.

**Status:** `[x] complete` — 2026-04-18

#### Sprint 1.2 — Admin UI + Billing modal upgrade

**Deliverables:**

- [x] `admin/src/app/(operator)/accounts/page.tsx` — server component with filter bar (status / plan / search). Rows linked to detail.
- [x] `admin/src/app/(operator)/accounts/[accountId]/page.tsx` + `action-bar.tsx` — detail envelope renders account, orgs, active adjustments, recent audit. Suspend/restore gated on platform_operator with reason-required modals.
- [x] `admin/src/app/(operator)/accounts/actions.ts` — `suspendAccountAction` / `restoreAccountAction`. `revalidatePath` on `/accounts`, `/accounts/[id]`, `/billing` so the billing panel pill counts stay in sync.
- [x] Nav: `Accounts` between `Organisations` and `Support Tickets`.
- [x] Billing Adjustment modal — UUID textbox replaced with a select of active accounts (loaded once on page render via `admin.accounts_list`). Shows `name · status · id-prefix`.
- [x] Billing Payment Failures tab — `Suspend` button added next to `Retry at Razorpay ↗` / `Refund`, gated on platform_operator AND retries ≥ 3. Confirm modal; post-success modal surfaces `N child orgs flipped` and points at `/accounts/<id>` for restore.
- [x] Admin build + lint clean. `/accounts` + `/accounts/[accountId]` in route manifest.

**Status:** `[x] complete` — 2026-04-18

### Phase 2 — Worker observability

#### Sprint 2.1 — HMAC / Origin failure logging

**Deliverables:**

- [x] `worker/src/worker-errors.ts` — added `Worker403Reason` type union documenting the prefix discipline (`hmac_*` / `origin_*`) the Security tabs filter on.
- [x] `worker/src/events.ts` + `worker/src/observations.ts` — every 403 site now fires a `ctx.waitUntil(logWorkerError(...))` call with the matching category. Four sites × two endpoints = 8 total. Upstream errors swallowed inside `logWorkerError`, so a logging outage never DoSes the customer.
  - `hmac_timestamp_drift: <ts>` on ±5 min window violations
  - `hmac_signature_mismatch` on bad signature (even after previous-secret retry)
  - `origin_missing: unsigned request without Origin/Referer`
  - `origin_mismatch: <origin>` when Origin is present but not allowlisted
- [x] `app/tests/worker/events.test.ts` — extended the wrong-secret case to assert the `worker_errors` REST POST landed with the right category, status_code, and endpoint. Full worker suite **20/20 PASS**.
- [x] Deployed — `wrangler deploy` version `db15f7ea`.

**Status:** `[x] complete` — 2026-04-18

---

## Acceptance criteria

- An operator can see every account, open one, and suspend/restore it. The action fans out to all child orgs in one audit-logged transaction.
- Plan adjustments can be granted without typing a UUID — the operator picks an account by name from a combobox.
- Billing Payment Failures has three actions per row: `Retry at Razorpay ↗`, `Refund`, `Suspend`.
- Security HMAC / Origin tabs start showing rows as soon as a misconfigured customer site hits the Worker — no log gap between failure and visibility.
- Worker tests stay ≥20/20 PASS. Admin build + lint clean.

## Out of scope / V2

- Performance tuning on `accounts_list` (paging, server-side filtering beyond trivial indexes). Add when dev scale > ~500 accounts.
- Account-level billing invoice history (today refunds are listed per account; invoices are in Razorpay dashboard).
- Self-serve account suspension (customer-initiated). Operator-only for now.
- Worker-side deduplication of repeated HMAC failures from the same IP. If the Security tabs get noisy we add a Cloudflare-KV-backed rate limit on logging; today the volume is low enough to log every rejection.
