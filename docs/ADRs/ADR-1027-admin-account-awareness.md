# ADR-1027: Admin Account-Awareness Pass

**Status:** Proposed
**Date proposed:** 2026-04-24
**Date completed:** —
**Superseded by:** —
**Upstream dependency:** ADR-0044 (customer RBAC — 4-level hierarchy), ADR-0048 (Admin Accounts panel + `admin.account_detail` envelope), ADR-0050 (account-aware billing), ADR-0055 (account-scoped impersonation), ADR-0056 (per-account feature flags).

---

## Context

### The gap

ADR-0044 moved the tenancy centre of gravity from `organisations` to `accounts`: `accounts` is now the billing subject, the Razorpay identity, the plan-holder, and the composition root for organisations. `organisations` became children. ADR-0048 shipped the operator-facing `/accounts` panel + `admin.account_detail(p_account_id)` envelope + `admin.suspend_account` / `restore_account`; ADR-0055 added account-scoped impersonation; ADR-0056 added per-account feature-flag targeting; ADR-0050/0051 anchored billing to the account tier. The `organisations` list + detail pages already embed `accounts(plan_code, trial_ends_at, ...)` via FK join (`admin/src/app/(operator)/orgs/page.tsx:47`, `…/orgs/[orgId]/page.tsx:37`), so the most obvious two surfaces are account-aware.

The other operator surfaces still treat orgs as the top-level entity:

| # | Surface | Drift |
|---|---------|-------|
| 1 | Admin audit log (`admin.admin_audit_log`) | `target_id` + `org_id` columns only. Filtering by account requires joining through `organisations`. No `account_id` column on the table or the `/audit-log` panel's filter bar. |
| 2 | Pipeline panel (`/pipeline`) — Sentry events, worker_errors, rate-limit events | Joined on `org_id`. Operators can filter by org, not by "show me everything for this enterprise account". |
| 3 | Support tickets (`/support` — ADR-0032) | `org_id` scoped. Reply threads don't surface the parent account name + plan; ticket filters don't offer account grouping. |
| 4 | Org notes (`admin.org_notes`) | Per-org. No account-level notes for "notes on the whole holding group" that apply to every org in an account. |
| 5 | Sectoral templates (`/templates` — ADR-0030) | Global catalogue only. Account-level "default template for this holding group" is a common enterprise ask. |
| 6 | Admin dashboard tiles (`/`) | Metric tiles count orgs, tickets, etc. No account count, no plan distribution across accounts, no trial-conversion metric. |
| 7 | Impersonation session audit (admin.impersonation_sessions) | Logs `target_org_id` only (ADR-0055 added account-scoped start RPC, but the historical log view still groups by org). |

These aren't safety bugs — every surface works for the single-org SMB case. They're operator-ergonomics gaps that surface under the enterprise scenario. Per memory `project_customer_segment_enterprise`, the target customer is Tata-scale corporates with divisions as legal entities → one account, many orgs, decentralised ops + central billing. Operators need to reason about the account as a unit, not just the organisations beneath it.

### Why now

The foundation shipped end of April:
- `admin.account_detail(p_account_id)` returns the canonical operator envelope (account row + effective plan + child orgs + active adjustments + 50 recent audit rows) — this is the "what do operators want to see for an account" contract.
- Account-scoped impersonation (ADR-0055) + per-account feature flags (ADR-0056) already work.
- Account-aware billing (ADR-0050/0051) ships invoice history / GST / disputes at the account tier.

Without a deliberate pass across the remaining surfaces, operators handling a multi-org account have to mentally re-aggregate org-level views every time. That's invisible until a Tata-scale customer signs — at which point the ergonomics cliff is too late to fix.

### Scoping constraints

- **Surface budget.** Seven surfaces × four sprints each = too big for one ADR. Pick the highest-impact minimum subset. Keep the rest as a follow-up ADR when warranted.
- **Wireframe-first discipline.** Per the project rule, each UI sprint starts with a wireframe update to `docs/admin/design/consentshield-admin-screens.html` + an entry in its alignment doc. The ADR references the wireframe panel as the acceptance criterion.
- **Backwards-compat.** Every drift is additive — add `account_id` to audit log (backfilled from `org_id` → `organisations.account_id`), add sidebar cards that surface parent-account context on existing org-scoped panels, add filter options without removing the current org-level filters. No existing URL, no existing RPC contract breaks.
- **`account_detail` envelope as the contract.** Panels that want a "parent account context" sidebar should call `admin.account_detail(p_account_id)` — one RPC, known shape, already fenced by `require_admin('support')`. Don't drift per-panel envelope shapes.

## Decision

Land a single cross-cutting ADR that closes the five highest-impact drifts, keeping two for a follow-up. Scope:

| Sprint | Surface | Deliverable |
|---|---|---|
| 1.1 | Admin audit log | Add `account_id` column to `admin.admin_audit_log` (nullable + backfilled); `/audit-log` panel filter bar gains an "Account" dropdown; list rows surface parent-account name next to org. |
| 1.2 | Admin dashboard tiles (`/`) | Rework tile row: account count, orgs per account distribution (histogram), accounts-by-plan breakdown, trial-to-paid conversion rate (last 30d). Org-level tiles (total events, stuck buffers) stay. |
| 2.1 | Pipeline panel sidebar | Every org-filtered Pipeline view (Sentry, worker_errors, rate-limit) gains a "Parent account" sidebar card driven by `admin.account_detail`. Adds "group by account" toggle that aggregates per-org metrics into an account-level roll-up. |
| 2.2 | Support ticket account context | Ticket detail adds a parent-account header strip (account name, plan, current adjustment if any). Filter bar adds "Account" — selecting it lists every ticket for every org in that account. |
| 3.1 | Impersonation session audit | `/admin/operator/audit-log` impersonation view gains per-account rollups. Cross-org impersonation within one account reads as a single "account session" with org breadcrumbs, not N unrelated org sessions. |

**Deferred to a follow-up (ADR-1028 when warranted):** org_notes account-tier, sectoral-templates account-default. Neither is load-bearing for operator ergonomics today; both are nice-to-haves for the enterprise roadmap and can bundle into a later pass.

### Shape of the work

- **Sprint 1.1** — schema migration adds `admin_audit_log.account_id uuid` (nullable; FK to `public.accounts`); backfill via `update … set account_id = o.account_id from public.organisations o where admin_audit_log.org_id = o.id`; partial index on `account_id where account_id is not null`. `admin.admin_audit_log_query` RPC extended with `p_account_id uuid default null` parameter. Panel adds a typeahead account-picker next to the org filter.
- **Sprint 1.2** — wireframe updates in `docs/admin/design/consentshield-admin-screens.html` (Dashboard panel). New admin RPC `admin.admin_dashboard_tiles()` returns `{accounts_total, accounts_by_plan: [{plan_code, count}], orgs_per_account_p50/p90, trial_to_paid_rate_30d, ...}`. Existing `/` page swaps the tile renderer.
- **Sprint 2.1** — `<AccountContextCard accountId={…} />` React component that calls `admin.account_detail` via the admin RPC proxy + renders plan, status, child-org count, active adjustments. Drop into `/pipeline`, `/security`, `/billing` org-scoped views. "Group by account" toggle is a client-side aggregation over the org-level rows (same query, different render).
- **Sprint 2.2** — ticket-row query already carries `org_id`; the detail page gains a `admin.account_detail`-backed header strip + a new `p_account_id` parameter on the list RPC. Wireframe updates in `docs/admin/design/consentshield-admin-screens.html` (Support panel).
- **Sprint 3.1** — impersonation log query gains a per-account aggregation view. RPC surfaces `{account_id, orgs_touched, total_duration, started_at}` rows. UI adds a "Group by account" button toggle that swaps the row shape.

## Consequences

### Enables

- Enterprise operator scenarios (Tata-scale customers) stop requiring mental re-aggregation. The account becomes a first-class pivot across five operator surfaces.
- Audit-log account filtering becomes a single-RPC query instead of a client-side join.
- Trial-to-paid metric on the dashboard surfaces the most load-bearing business number the admin console doesn't currently show.

### New constraints

- **`admin.admin_audit_log.account_id` must stay in sync.** Every write path that mutates org-scoped state in `admin_audit_log` must populate both `org_id` and `account_id`. Add a BEFORE INSERT trigger that populates `account_id` from `org_id` if the caller omitted it, so no code path can forget.
- **`admin_dashboard_tiles` RPC is a hot-path query.** Every operator-console landing hit calls it. Index it aggressively; cache where it's safe (no live state outside the 30d trial-conversion window).

### New failure modes

- If the `admin_audit_log.account_id` backfill ever runs against a row with a NULL `org_id`, the backfill leaves that row with NULL `account_id` — expected (e.g., platform-tier actions that apply globally), and the filter semantics tolerate it.
- The "group by account" toggle on the Pipeline panel must handle orgs with no `account_id` cleanly (post-ADR-0044 every org has one, but defensive).

---

## Implementation Plan

### Phase 1 — Audit log + dashboard tiles (foundation)

**Goal:** Land the two lowest-coupling surfaces first — audit log gets a new column, dashboard tiles get a new RPC. Both are additive; no existing query breaks.

#### Sprint 1.1 — Audit log account column + filter

**Estimated effort:** 0.75 day

**Prerequisite wireframe:** Update `docs/admin/design/consentshield-admin-screens.html` audit-log panel to add the account-picker in the filter bar + the "Account" column in the list. Mirror drift into the alignment doc.

**Deliverables:**
- [ ] Migration: `admin_audit_log.account_id uuid references public.accounts(id)` nullable; partial index on `account_id where account_id is not null`; backfill `set account_id = o.account_id from public.organisations o where admin_audit_log.org_id = o.id`; BEFORE INSERT trigger populates `account_id` from `org_id` if NULL.
- [ ] `admin.admin_audit_log_query` RPC gains `p_account_id uuid default null` parameter; unchanged `p_org_id` semantics.
- [ ] `admin/src/app/(operator)/audit-log/page.tsx` — account-picker added to filter bar (typeahead over `public.accounts` via an admin lookup RPC); selecting an account filters rows to that account AND every org beneath it.

**Testing plan:**
- [ ] Unit test: inserting an audit row without `account_id` but with `org_id` populates `account_id` via trigger.
- [ ] Integration: suspend an account → audit rows for every child org's state change all carry the same `account_id`; filter by that account → all rows returned.
- [ ] Integration: NULL-org platform action → `account_id = NULL`; filter by any account → row excluded; filter by "platform" → row included.

#### Sprint 1.2 — Dashboard tiles account-aware

**Estimated effort:** 0.75 day

**Prerequisite wireframe:** Update `docs/admin/design/consentshield-admin-screens.html` Dashboard panel to swap the tile row + add the plan-distribution chart + trial-conversion gauge.

**Deliverables:**
- [ ] `admin.admin_dashboard_tiles()` RPC — single round-trip returns all current tile metrics + new account-tier metrics (account count, accounts-by-plan histogram, orgs-per-account p50/p90, trial-to-paid conversion last 30d).
- [ ] `admin/src/app/(operator)/page.tsx` — tile row reworked. Org-level tiles retained; new account-level tiles sit above them.
- [ ] Basic recharts or CSS-grid histogram for the accounts-by-plan breakdown (no new dep — reuse whatever the ADR-0038 status page uses for its sparkline).

**Testing plan:**
- [ ] Unit: RPC returns shape; no metric returns NaN / infinity under an empty DB.
- [ ] Integration: seed 5 accounts across 3 plans, 10 orgs, 2 trial-to-paid conversions in the last 30d → RPC returns the expected counts.

### Phase 2 — Contextual surfaces

#### Sprint 2.1 — Pipeline panel account sidebar + rollup

**Estimated effort:** 1 day

**Prerequisite wireframe:** Update Pipeline panel(s) in `docs/admin/design/consentshield-admin-screens.html` with an "Account" sidebar card + the "Group by account" toggle.

**Deliverables:**
- [ ] `<AccountContextCard>` reusable component in `admin/src/components/` that calls `admin.account_detail` via the RPC proxy, renders account + plan + status + child-org count + active adjustments + last 3 audit lines. Swappable between "full" and "compact" modes.
- [ ] Drop the card into `/pipeline`, `/security`, `/billing` org-scoped views (right sidebar, sticky under the filter bar).
- [ ] "Group by account" toggle on `/pipeline` — client-side aggregation of org-row metrics into account-level rows (sum, p50, last-seen). No new RPC; existing query shape stays.

**Testing plan:**
- [ ] Component snapshot: `<AccountContextCard>` renders known envelope shape.
- [ ] Integration: org-filtered pipeline view displays the correct account card; toggling "group by account" re-renders without a network round-trip.

#### Sprint 2.2 — Support ticket account context

**Estimated effort:** 0.5 day

**Prerequisite wireframe:** Support-panel wireframe gets the account header strip + the account filter option.

**Deliverables:**
- [ ] Ticket list RPC (`admin.support_tickets_list`) gains `p_account_id uuid default null`; existing `p_org_id` semantics unchanged.
- [ ] Ticket detail page adds a parent-account header strip (account name + plan + current adjustment if any).
- [ ] Ticket list filter bar gains an Account filter mirroring Sprint 1.1's picker.

**Testing plan:**
- [ ] Integration: filter by account → every ticket for every org in that account.
- [ ] Detail snapshot: header strip renders correct account metadata.

### Phase 3 — Impersonation log account rollup

#### Sprint 3.1 — Impersonation-log account view

**Estimated effort:** 0.5 day

**Prerequisite wireframe:** Admin audit-log / impersonation view gets a "Group by account" toggle in the wireframe.

**Deliverables:**
- [ ] `admin.impersonation_sessions_by_account()` RPC — per-account aggregation (account_id, orgs_touched, total_duration, started_at, admin_user).
- [ ] Toggle in the impersonation view swaps the row shape between per-session and per-account.

**Testing plan:**
- [ ] Integration: one operator impersonates three orgs in the same account → per-account view returns one row with `orgs_touched = 3`.

---

## Test Results

_To be filled as sprints complete._

## Changelog References

_To be filled as sprints complete._

## Acceptance criteria

- Admin audit log is filterable by account in one click; filtering applies to rows whose org is in the account AND rows where `target_id` is the account itself.
- Admin dashboard `/` shows account count, accounts-by-plan breakdown, and trial-to-paid conversion rate alongside the pre-existing org-tier tiles.
- Every org-scoped Pipeline / Security / Billing view carries a parent-account sidebar card. "Group by account" aggregation works without a network round-trip.
- Support ticket detail surfaces parent-account context; ticket list filters by account.
- Impersonation log has a "per-account" view that collapses cross-org sessions inside one account into a single row.
- No pre-existing URL, RPC contract, or filter option removed. All drift is additive.
- Wireframe + alignment-doc update lands with the code for every UI sprint (1.1, 1.2, 2.1, 2.2, 3.1).

## Open deferrals

- **Account-tier `org_notes`** — deferred to a follow-up ADR (candidate ADR-1028). Not load-bearing for today's operator scenarios.
- **Account-default sectoral template** — deferred. Same follow-up.
- **Flat-org surfaces with no account dimension** — `/flags`, `/templates` (catalogue side), `/signatures`, `/connectors` — these are global catalogues, not per-tenant. Out of scope for this ADR.
