# ADR-0055 — Account-scoped impersonation

(c) 2026 Sudhindra Anegondhi a.d.sudhindra@gmail.com

**Status:** Completed — 2026-04-20
**Date:** 2026-04-20
**Phases:** 1
**Sprints:** 1

**Depends on:** ADR-0027 (admin schema + `admin.impersonation_sessions`), ADR-0029 (admin impersonation lifecycle + customer `support-sessions` viewer), ADR-0044 (account → orgs hierarchy).

## Context

ADR-0027/0029 shipped **org-scoped impersonation** — the operator picks an organisation and starts a time-boxed, reason-bound session. The audit footprint is captured in `admin.impersonation_sessions` and surfaced to the customer at `/dashboard/support-sessions`.

That's the right scope when an operator is investigating a specific org's banner behaviour, consent events, or rights requests. It's the **wrong** scope for **account-level concerns**:

- Billing posture (invoicing, GST, disputes) is account-scoped post-ADR-0044 / ADR-0050 — it spans all orgs under the account.
- Suspension / restore fans out across all child orgs (ADR-0048).
- Enterprise accounts (per the `project_customer_segment_enterprise` memory) hold multiple orgs as legal entities; support queries often span the whole account, not one division.

When the operator needs an account-level view, today they either:
- Impersonate into one org arbitrarily (wrong audit trail), or
- Use their admin-tier RLS privileges directly without an impersonation session (no time-box, no customer notification, no audit ledger entry).

Neither is correct. This ADR adds a second target shape to `admin.impersonation_sessions`: account-scoped.

## Decision

`admin.impersonation_sessions.target_org_id` becomes nullable; a new `target_account_id` column is added; a CHECK constraint enforces that **exactly one** of the two is set per row. New RPC `admin.start_impersonation_account` mirrors the existing `start_impersonation` contract but targets an account. The existing `end_impersonation` / `force_end_impersonation` / auto-expiry paths work unchanged — they key on `id`, not scope.

Customer visibility: `public.list_org_support_sessions` RPC is extended to also return account-scoped sessions for account_owners. The return shape grows a `target_scope` text field (`'org'` | `'account'`). The existing `/dashboard/support-sessions` page surfaces the scope as a small pill next to the operator name so the account_owner can tell which lens was used.

Admin UI: `/accounts/[accountId]` gets an "Impersonate account" button alongside the existing Suspend / Restore actions. Reuses the existing `ModalShell` + `ReasonField` + `FormFooter` primitives for consistency. The admin cookie + banner infra from ADR-0029 Sprint 3.1 handles the session lifecycle unchanged (one active session at a time across both scopes).

### Out of scope

- Switching between active sessions (start-an-account-session-while-an-org-session-is-active): blocked by the same cookie-level guard that already refuses overlapping org sessions.
- Cross-org navigation UI during an account-scoped session (e.g., a "jump to org X" menu that picks which org's dashboard to view): out of scope; admin uses their own RLS-aware admin client.
- A new "account impersonation" entry on the admin dashboard (vs. the existing org-centric "recent impersonations" list): out of scope; surfaces through `/audit-log` and the account detail page.

## Implementation — Sprint 1.1 (shipped)

**Deliverables:**

- [x] `supabase/migrations/20260725000001_account_scoped_impersonation.sql`:
  - `admin.impersonation_sessions`:
    - `target_org_id` — nullable
    - `target_account_id` — new nullable FK to `public.accounts(id) on delete cascade`
    - `impersonation_target_scope_check` — exactly one of `target_org_id` / `target_account_id` is set
    - Partial index on `(target_account_id, started_at desc)` for the new query path
    - RLS policy `impersonation_sessions_account_view` — account_owners of the target account can SELECT account-scoped rows
  - `admin.start_impersonation_account(p_account_id, p_reason, p_reason_detail, p_duration_minutes)` — SECURITY DEFINER, `require_admin('support')`, same validation as the org-scoped RPC (reason whitelist, reason_detail ≥ 10 chars, 1..120 min, account must exist). Inserts with `target_account_id` set + audit row with action `impersonate_start_account`.
  - `public.list_org_support_sessions` — dropped + recreated with an added `target_scope` return column. Now also returns account-scoped sessions when the caller is an account_owner of the target account.
- [x] `admin/src/app/(operator)/accounts/actions.ts` — new `startAccountImpersonationAction` server action.
- [x] `admin/src/app/(operator)/accounts/[accountId]/action-bar.tsx` — new "Impersonate account" button + `ImpersonateAccountModal` with reason selector + detail + duration dropdown.
- [x] `admin/src/app/(operator)/accounts/[accountId]/page.tsx` — passes `accountName` through to the action bar.
- [x] `app/src/app/(dashboard)/dashboard/support-sessions/page.tsx` — SessionRow shape gets `target_scope`; renders a small purple "account" pill next to the operator name for account-scoped rows.
- [x] `tests/billing/account-scoped-impersonation.test.ts` — 8/8 PASS: start happy path, support tier allowed, read_only denied, short reason_detail rejected, invalid reason rejected, non-existent account rejected, CHECK constraint rejects both-set / neither-set, `list_org_support_sessions` returns `target_scope=account` for account_owner.

**Status:** `[x] complete — 2026-04-20`

## Acceptance criteria

- An operator opens `/accounts/[accountId]`, clicks "Impersonate account", fills in reason + detail + duration, and a row is inserted with `target_account_id` set / `target_org_id` null. Audit row action is `impersonate_start_account`.
- An account_owner viewing `/dashboard/support-sessions` sees the new session with a small `account` pill next to the operator name.
- A member of one of the account's orgs (without account_owner role) does NOT see the account-scoped session — only org-scoped ones targeting their current org.
- Attempting to insert a row with both `target_org_id` and `target_account_id` set (or neither) is rejected at the DB layer by the CHECK constraint.
- Starting an account-scoped session while an org-scoped session is still active is refused by the existing cookie guard (same behaviour as two overlapping org sessions).

## Consequences

- **Enables:** operators have a first-class audit trail for account-level investigation sessions. Customer account_owners get equivalent visibility into account-scoped support events.
- **Small schema delta:** one nullable column + one CHECK. Existing org-scoped behaviour untouched.
- **No new CLAUDE.md rules.** Rule 23 (impersonation) stays the canonical policy; this ADR only expands the target shape.
