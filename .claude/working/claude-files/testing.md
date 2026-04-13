---
globs: ["tests/**/*.ts", "tests/**/*.test.ts", "**/*.test.ts", "**/*.spec.ts"]
---

# Testing Rules

## Test priority (from consentshield-testing-strategy.md)

1. Multi-tenant RLS isolation — run every deploy, blocks deployment
2. Consent event integrity — append-only + delivery pipeline
3. Tracker detection accuracy — weekly test pages, monthly real sites
4. Worker reliability — endpoint tests
5. Workflow correctness — SLA timers, breach deadlines
6. Deletion orchestration — real third-party test accounts
7. Security posture scanner — controlled pages

## Writing RLS isolation tests

For every table, test with two org users (Org A and Org B):
- User A cannot SELECT Org B's rows (expect 0 rows)
- User A cannot INSERT with Org B's org_id (expect RLS violation)
- User A cannot UPDATE Org B's rows (expect 0 rows affected)
- User A cannot DELETE Org B's rows (expect 0 rows affected)

For buffer tables, additionally test:
- User A cannot UPDATE their own rows (expect permission denied — REVOKE is active)
- User A cannot DELETE their own rows (expect permission denied)
- User A cannot INSERT into consent_events (expect permission denied)

## Writing scoped role tests

- cs_worker cannot SELECT from organisations (expect permission denied)
- cs_delivery cannot SELECT from organisations (expect permission denied)
- cs_orchestrator cannot SELECT from consent_events (expect permission denied)

## The critical test question

For every test you write, ask: "If this test passes but the underlying compliance requirement is violated, would I know?"

A test that checks "did the function return 200?" is not sufficient.
A test that checks "did the consent event arrive in the customer's R2 bucket with the correct content?" is what matters.

## Test data cleanup

- Always clean up test data after each test
- Never leave test organisations, test consent events, or test rights requests in the database
- Use transactions with rollback for database tests where possible
