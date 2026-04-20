# ADR-0056 — Per-account feature-flag targeting

(c) 2026 Sudhindra Anegondhi a.d.sudhindra@gmail.com

**Status:** In Progress (Sprint 1.1 shipped 2026-04-20; UI selector Sprint 1.2 planned)
**Date:** 2026-04-20
**Phases:** 1
**Sprints:** 2

**Depends on:** ADR-0027 (admin schema + `admin.feature_flags` + `get_feature_flag`), ADR-0036 (admin feature-flags UI), ADR-0044 (accounts → orgs hierarchy).

## Context

ADR-0036 shipped feature flags at two scopes: `global` + `org`. The resolver `public.get_feature_flag(p_flag_key)` picks org-scoped first, else falls back to global.

For enterprise accounts that hold many orgs (ADR-0044 + the enterprise-customer memory: Tata-scale with divisions as legal entities), the operator wants a third scope — **account** — so rolling out a beta to "all of Acme Group" doesn't require stamping each org separately. Account-scope sits between global and org in specificity.

## Decision

Add an `account` scope between `global` and `org`. Resolver fallback order:

1. Org-scoped for caller's current org (most specific)
2. Account-scoped for caller's current account (ADR-0056 — new)
3. Global default (least specific)

Same precedence that ADR-0027's two-level resolver already implied — just with one additional layer between them.

### Schema

- `admin.feature_flags.account_id` nullable FK → `public.accounts(id)`.
- `scope` CHECK extended to allow `'account'`.
- Shape CHECK: `(scope, account_id, org_id)` tuple must be one of:
  - `'global'` + both null
  - `'account'` + account_id set / org_id null
  - `'org'` + org_id set / account_id null
- Unique index expanded: `(flag_key, scope, coalesce(account_id, zero-uuid), coalesce(org_id, zero-uuid))`.

### RPCs

`admin.set_feature_flag` + `admin.delete_feature_flag` get a new optional `p_account_id` parameter with full validation (account scope requires account_id; other scopes forbid it). Both RPCs are dropped-and-recreated because signature changes.

### UI

Sprint 1.1 wires the schema + server actions + RPC plumbing. Sprint 1.2 adds the admin UI selector (account picker when scope='account'). Existing callers pass `accountId: null` in the meantime — the current UI continues to work for global + org scopes without any UX regression.

## Implementation

### Sprint 1.1 — Schema + RPCs + resolver (shipped)

**Deliverables:**

- [x] `supabase/migrations/20260730000001_account_scoped_feature_flags.sql`:
  - `admin.feature_flags.account_id` column + `feature_flags_scope_shape_check` CHECK + expanded unique index.
  - `public.get_feature_flag` — fallback order extended: org → account → global.
  - `admin.set_feature_flag(..., p_account_id, ...)` — validates account scope shape; rejects cross-shape inputs.
  - `admin.delete_feature_flag(..., p_account_id, ...)` — mirror.
- [x] `admin/src/app/(operator)/flags/actions.ts` — `setFeatureFlag` + `deleteFeatureFlag` accept `accountId`; validate scope shape; forward to RPC.
- [x] `admin/src/components/flags/feature-flags-tab.tsx` — existing UI callers pass `accountId: null` (Sprint 1.2 follow-up will add the account selector).
- [x] `tests/billing/account-feature-flags.test.ts` — 9/9 PASS: create, required-field validation (account scope needs account_id; account scope forbids org_id; global scope forbids account_id; support tier denied), resolver fallback (org > account > global), delete.

**Status:** `[x] complete — 2026-04-20`

### Sprint 1.2 — Admin UI account picker (planned)

**Deliverables:**

- [ ] Extend `FeatureFlag` interface in `feature-flags-tab.tsx` with `account_id`, `account_name`.
- [ ] Flags page server component fetches accounts + joins `account_name` into rows.
- [ ] Scope selector adds 'account' option. Account-scope flags reveal an account picker (dropdown of `{accountId → name}`).
- [ ] Flag list shows account-scoped rows with an account badge.
- [ ] Delete flow extended for account-scoped rows.

**Status:** `[ ] planned`

## Acceptance criteria

- `admin.set_feature_flag(flag_key, 'account', value, description, null, account_id, null, reason)` creates a flag scoped to the account. Same RPC with `scope='account'` but no `account_id` raises.
- A customer in an org under that account calls `public.get_feature_flag(flag_key)` and sees the account-scoped value (unless an org override exists, which wins).
- Org overrides continue to work — precedence is org > account > global.
- Deleting an account-scoped flag removes only that row; global + org rows for the same key stay intact.
- `support` tier cannot create or delete flags (role gate enforced at RPC layer).
- Existing global + org flags shipped before this migration keep their semantics — the new `account_id` column is nullable and existing rows get `null`.

## Consequences

**Enables:** operators can roll out beta features to entire enterprise accounts in one write, without stamping each child org. Simplifies rollout tracking in the audit log.

**Introduces:**
- New nullable column + two CHECK constraints on `admin.feature_flags`. Zero data migration — existing rows keep `null` account_id.
- Resolver now does three SELECTs instead of two. All three are indexed point-lookups on the unique key; latency impact is negligible at dev scale.
- Sprint 1.2 will finish the UI — until then, the admin panel can manage global + org flags exactly as before, and operators create account-scoped flags via direct RPC if needed.
