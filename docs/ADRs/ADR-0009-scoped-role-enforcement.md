# ADR-0009: Scoped-Role Enforcement in REST Paths

(c) 2026 Sudhindra Anegondhi a.d.sudhindra@gmail.com

**Status:** In Progress
**Date proposed:** 2026-04-14

---

## Context

The 2026-04-14 codebase review raised B-4 and B-8: thirteen call sites in the
Next.js app and a library layer create Supabase clients with
`SUPABASE_SERVICE_ROLE_KEY` in running application code, violating
non-negotiable rule #5 ("the service role key is for migrations only"). The
`cs_worker`, `cs_delivery`, and `cs_orchestrator` roles exist in Postgres but
cannot be the identity on a Supabase REST JWT (documented in ADR-0002). The
encryption RPC `decrypt_secret` also grants execute only to `service_role`,
forcing every decrypt path through the master-privileged key.

Net effect: every route handler and library function with a mutation runs with
full DB privileges. A single input-validation bug anywhere in the stack
escalates into cross-org data exposure or buffer corruption.

## Decision

Replace in-process service-role mutations with **PL/pgSQL security-definer RPCs
owned by the appropriate scoped role**. Supabase's PostgREST endpoint accepts
`POST /rest/v1/rpc/<function>` calls with `anon` or `authenticated` JWTs. Each
RPC runs with its owner's privileges (scoped role), validates inputs, enforces
caller identity, and performs the mutation.

Pattern per RPC:

```sql
create or replace function public.rpc_<op>(...)
returns <return type>
language plpgsql
security definer
set search_path = public, extensions
as $$ ... $$;

alter function public.rpc_<op>(...) owner to cs_orchestrator;  -- or cs_delivery
revoke all on function public.rpc_<op>(...) from public;
grant execute on function public.rpc_<op>(...) to anon;        -- or authenticated
```

Application code:

```ts
const supabase = createClient(url, anonKey, { global: { headers: { ... } } })
const { data, error } = await supabase.rpc('rpc_<op>', { ... })
```

The service role key remains available for migrations and the one-shot secret
rotation tools, never for runtime requests.

## Consequences

- Every mutating path gains a named, reviewable SQL function. Changes to DB
  writes become schema changes (tracked in migrations) rather than scattered TS
  updates.
- `cs_orchestrator` and `cs_delivery` become real runtime principals, not
  documentation. Per-role grant audits (GRANT/REVOKE listings) now have
  meaning.
- Public RPCs must be hardened — rate limits (S-1), input validation, Turnstile
  gating where appropriate — because they are reachable from any browser.
- The library layer (`billing/gate.ts`, `rights/deletion-dispatch.ts`,
  `encryption/crypto.ts`) needs threading of the correct Supabase client
  instance; no more module-level service-role client.
- `decrypt_secret` gets an explicit grant to `cs_delivery` (the role that
  dispatches deletion webhooks) and the `service_role` grant is revoked.

---

## Implementation Plan

### Phase 1: Public-surface buffer writes

**Goal:** Remove service-role usage from public-facing POST endpoints that
mutate buffer tables. These are the hottest items in B-4 because the endpoints
are reachable without authentication.

#### Sprint 1.1: RPCs for rights-request intake and OTP verification

**Deliverables:**
- [ ] Migration `20260414000005_scoped_rpcs_public.sql` — adds
  `rpc_rights_request_create`, `rpc_rights_request_verify_otp`,
  `rpc_deletion_receipt_confirm`. Each security-definer, owned by the
  matching scoped role, granted to `anon`.
- [ ] `src/app/api/public/rights-request/route.ts` — replace service-role
  client + direct inserts with `supabase.rpc('rpc_rights_request_create', ...)`
  using anon key.
- [ ] `src/app/api/public/rights-request/verify-otp/route.ts` — same pattern
  with `rpc_rights_request_verify_otp`.
- [ ] `src/app/api/v1/deletion-receipts/[id]/route.ts` — same pattern with
  `rpc_deletion_receipt_confirm`, which enforces
  `status = 'awaiting_callback'` (also closes B-6).

**Testing plan:**
- [x] `bun run lint`, `bun run build`, `bun run test` — all green (39/39).
- [ ] Manual: submit rights request via public form → OTP sent; verify with
  correct code → `email_verified=true`, `rights_request_events` row present.
  Pending live migration apply.
- [ ] Manual: replay deletion callback with the same receipt_id → 409.
  Pending live migration apply.

**Status:** `[x] complete`

### Phase 2: Authenticated buffer/operational writes

**Goal:** Remove service-role usage from authenticated routes.

#### Sprint 2.1: RPCs for rights event append, banner publish, integrations

**Deliverables:**
- [ ] Migration `20260414000006_scoped_rpcs_authenticated.sql` —
  `rpc_rights_event_append`, `rpc_banner_publish`,
  `rpc_integration_upsert`, each granted to `authenticated` with `auth.uid()`
  → `org_members` check inside.
- [ ] Refactor the three route handlers to call RPCs with the user's JWT.

**Testing plan:**
- [ ] RLS isolation test suite still passes (39/39).
- [ ] New tests: user in org A cannot call RPC targeting org B.

**Status:** `[ ] planned`

### Phase 3: Webhooks, signup, and libraries

**Goal:** Remove the remaining service-role usages.

#### Sprint 3.1: Razorpay webhook, signup, deletion-dispatch, encryption, gate

**Deliverables:**
- [ ] Migration `20260414000007_scoped_rpcs_webhooks.sql` —
  `rpc_razorpay_apply_subscription`, `rpc_signup_bootstrap_org`.
  `razorpay` RPC granted to `anon`; `signup_bootstrap_org` granted to
  `authenticated` (runs right after supabase.auth.signUp).
- [ ] Migration `20260414000008_encryption_rpc_grants.sql` — revoke
  `decrypt_secret`/`encrypt_secret` execute from `service_role`; grant to
  `cs_delivery` (for dispatch) and `cs_orchestrator` (for management reads
  from integrations routes).
- [ ] `src/lib/rights/deletion-dispatch.ts`, `src/lib/encryption/crypto.ts`,
  `src/lib/billing/gate.ts` — accept a Supabase client parameter (anon or
  authenticated), stop reading the service role key directly.
- [ ] Public server components (`/rights/[orgId]`, `/privacy/[orgId]`) — use
  anon key (they already only read public columns).

**Testing plan:**
- [ ] `grep -r SUPABASE_SERVICE_ROLE_KEY src/` returns zero matches.
- [ ] Razorpay signed webhook end-to-end: subscription.activated → plan row
  updated, audit event written.

**Status:** `[ ] planned`

---

## Architecture Changes

- `docs/architecture/consentshield-definitive-architecture.md` — runtime
  principal matrix (anon / authenticated / service_role / cs_worker /
  cs_delivery / cs_orchestrator) updated to reflect the RPC pattern. The
  scoped roles are now reachable via PostgREST through security-definer
  functions, closing the loop that ADR-0002 flagged open.

---

## Test Results

### Sprint 1.1 — 2026-04-14

```
Test: bun run lint
Expected: zero warnings
Actual:   zero warnings
Result: PASS

Test: bun run build
Expected: build succeeds, all API routes compile
Actual:   all 38 routes compile
Result: PASS

Test: bun run test
Expected: 39/39 RLS isolation tests pass (baseline preserved)
Actual:   39/39 pass
Result: PASS
```

Live tests (submit real rights request + replay deletion callback) deferred
until the migration is applied to the live database.

---

## Changelog References

- `CHANGELOG-schema.md` — each sprint adds RPC migrations
- `CHANGELOG-api.md` — each sprint refactors routes
