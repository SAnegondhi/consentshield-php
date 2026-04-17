# ADR-0042: Signup Idempotency Regression Test

(c) 2026 Sudhindra Anegondhi a.d.sudhindra@gmail.com

**Status:** Completed
**Date proposed:** 2026-04-17
**Date completed:** 2026-04-17
**Depends on:** ADR-0013 (signup bootstrap).
**Unblocks:** Closes V2-T1.

---

## Context

ADR-0013's signup bootstrap path creates an org for a new user on first callback. The idempotency guard — "skip bootstrap if the user is already a member of some org" — lives inline inside `app/src/app/auth/callback/route.ts`. A regression that drops or inverts that guard would silently create a second org for a returning user. No test catches it today.

The backlog option was to adopt a Next.js route-handler mock harness for a one-test dependency. This ADR picks the cheaper alternative: **lift the guard into a pure helper** (`ensureOrgBootstrap(supabase, user)`) and unit-test the helper directly. The route calls the helper; the test mocks the supabase client surface and asserts both branches (existing member → no-op, new user with metadata → bootstrap call).

---

## Decision

One file moved, one file added, one test file added. No runtime behaviour change.

- `app/src/lib/auth/bootstrap-org.ts` — exports `ensureOrgBootstrap(supabase, user) → { action: 'skipped' | 'bootstrapped', error?: string }`.
- `app/src/app/auth/callback/route.ts` — delegates to the helper.
- `app/tests/auth/bootstrap-org.test.ts` — 3 cases: existing membership, missing metadata, successful bootstrap.

---

## Consequences

- **Runtime equivalent.** The helper has the same query + RPC shape as before. The route's redirect logic is unchanged.
- **One new unit test file.** No new dep.
- V2-T1 closed.

---

## Implementation Plan

### Sprint 1.1 — Extract + test

**Deliverables:**

- [x] `app/src/lib/auth/bootstrap-org.ts` — pure helper returning a typed discriminator.
- [x] `app/src/app/auth/callback/route.ts` — route delegates.
- [x] `app/tests/auth/bootstrap-org.test.ts` — 3 assertions against a minimal supabase mock.

**Status:** `[x] complete` — 2026-04-17

---

## Test Results

```
Test: ensureOrgBootstrap unit tests
Method: cd app && bunx vitest run tests/auth/bootstrap-org.test.ts
Result: 4/4 PASS (existing-member skip, no-metadata skip, bootstrap
        success with RPC called exactly once + correct params, RPC
        failure returns failed discriminator).

App test suite: bunx vitest run
Result: 9 files, 53/53 PASS.
```

---

## Changelog References

- `CHANGELOG-api.md` — helper extracted.
- `CHANGELOG-docs.md` — ADR authored; V2-T1 closed.
