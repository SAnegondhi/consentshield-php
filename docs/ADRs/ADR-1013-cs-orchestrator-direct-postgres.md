# ADR-1013: `cs_orchestrator` direct-Postgres migration (Next.js runtime)

(c) 2026 Sudhindra Anegondhi a.d.sudhindra@gmail.com

**Status:** Completed
**Date proposed:** 2026-04-21
**Date completed:** 2026-04-21
**Supersedes:** —
**Depends on:** ADR-1009 (v1 API role hardening — established the direct-Postgres pattern for `cs_api`).

---

## Context

ADR-1009 Phase 2 migrated the v1 API path (`/api/v1/*`) from a PostgREST + HS256 JWT connection as `cs_api` to a direct-Postgres pool via `postgres.js`. The motivation was Supabase's rotation of legacy HS256 signing secrets — scoped-role JWTs are on a kill-timer. That ADR amended its own scope mid-flight when the JWT-mint strategy hit the rotation wall; it ended up only migrating `cs_api`.

The same reasoning applies to every other Next.js-runtime caller of a scoped role. Today the only remaining caller in customer-app code is `cs_orchestrator`:

- `app/src/app/api/public/signup-intake/route.ts` — creates `createClient(SUPABASE_URL, CS_ORCHESTRATOR_ROLE_KEY)` and calls `rpc('create_signup_intake', …)`.
- `app/src/app/api/internal/invitation-dispatch/route.ts` and its extracted helper `app/src/lib/invitations/dispatch.ts` — same pattern, read/write `public.invitations`.

`CS_ORCHESTRATOR_ROLE_KEY` is an HS256 JWT signed with the legacy key — unusable after Supabase completes its rotation. Edge Functions already use direct-Postgres connections as `cs_orchestrator`; the Next.js runtime never got the same treatment because at the time of ADR-1009 only `/api/v1/*` was in scope.

The signup-intake flow (ADR-0058) exposed this gap: without a valid `CS_ORCHESTRATOR_ROLE_KEY` set, `createClient(url, undefined)` throws at first call, the 500 omits CORS headers, and the browser surfaces a generic "Network error" with no visibility into the actual issue.

## Decision

Mirror ADR-1009 Phase 2's `cs_api` migration for `cs_orchestrator` in the Next.js runtime:

1. Rotate `cs_orchestrator`'s placeholder password (seed migration set `cs_orchestrator_change_me`).
2. Connect from the Next.js runtime via `postgres.js` against the Supavisor transaction pooler as `cs_orchestrator.<project-ref>`.
3. Keep all data access through existing SECURITY DEFINER RPCs — `cs_orchestrator` continues to have the grants it needs; no table-level permissions change.
4. Retire `CS_ORCHESTRATOR_ROLE_KEY` from Next.js envs once both callers (signup-intake + dispatcher) land on the new client.
5. Edge Functions are out of scope — they already use direct-Postgres through their Deno pool.

**Why not expand ADR-1009 in place?** ADR-1009 is Completed; re-opening it to extend scope muddies the completion record. A fresh ADR keeps the migration history honest and surfaces that the v1-only scope of 1009 was a known gap being finished later.

## Implementation Plan

### Phase 1 — Client + callers

#### Sprint 1.1 — cs-orchestrator-client.ts + migrate signup-intake and dispatcher

**Deliverables:**

- [x] `app/src/lib/api/cs-orchestrator-client.ts` — direct port of `cs-api-client.ts`. Lazy-initialised `postgres.js` pool reading `SUPABASE_CS_ORCHESTRATOR_DATABASE_URL`. Same pool sizing + TLS + prepare:false settings as the cs_api client.
- [x] `app/src/app/api/public/signup-intake/route.ts` — drop the `createClient(url, CS_ORCHESTRATOR_ROLE_KEY)` + `.rpc('create_signup_intake', …)` path. Replace with `csOrchestrator()` call + `sql<…>` tagged-template invocation of the RPC. No change to the explicit-branch contract (added in ADR-0058 follow-up).
- [x] `app/src/lib/invitations/dispatch.ts` — `dispatchInvitationById` takes a direct-Postgres client; route + signup-intake callers pass `csOrchestrator()`. Touches the three `public.invitations` reads/writes the helper already performs (select for read, two updates for success / failure watermarks).
- [x] `app/src/app/api/internal/invitation-dispatch/route.ts` — replace the `createClient(url, CS_ORCHESTRATOR_ROLE_KEY)` scaffolding with `csOrchestrator()` and hand it to the helper.
- [x] Remove `ORCHESTRATOR_KEY = process.env.CS_ORCHESTRATOR_ROLE_KEY!` references across the two routes.
- [x] Add `SUPABASE_CS_ORCHESTRATOR_DATABASE_URL` env var hint to the customer-app env docs (and `.env.local.example` if that file is kept in sync).

**Tested:**
- [x] `cd app && bun run build` — clean.
- [x] `cd app && bun run lint` — 0 errors, 0 warnings.
- [x] End-to-end round-trip — verified 2026-04-21 after Sprint 1.2 landed (see below).

**Status:** `[x] complete — 2026-04-21`

#### Sprint 1.2 — Operator actions + verification

**Operator:**

- [x] Rotate `cs_orchestrator` password in the Supabase dev DB:
  ```sql
  alter role cs_orchestrator with login password '<strong random>';
  ```
- [x] Add `SUPABASE_CS_ORCHESTRATOR_DATABASE_URL` to `app/.env.local` with the pooler connection string:
  ```
  postgresql://cs_orchestrator.<project-ref>:<password>@<pooler-host>:6543/postgres?sslmode=require
  ```
  (mirrors the host + port + project-ref from `SUPABASE_CS_API_DATABASE_URL` — only the user + password change). Password URL-encoded (URL-safe base64 doesn't require encoding, but the substitution pipeline handles both cases).
- [x] Restart `app/` dev server so the new env is picked up.

**Verification:**

- [x] Marketing `/signup` form end-to-end — visitor submit → app `signup-intake` (direct-Postgres as cs_orchestrator) → RPC returns `branch='created'` → in-process dispatch → marketing send-email relay → Resend → invite email delivered to the recipient inbox (confirmed 2026-04-21).

**Status:** `[x] complete — 2026-04-21`

### Phase 2 — Retire HS256 JWT surface

#### Sprint 2.1 — Env + doc cleanup + migrate small invitation-domain callers

**Deliverables:**

- [x] Migrated `app/src/app/api/public/lookup-invitation/route.ts` from `createClient(…, CS_ORCHESTRATOR_ROLE_KEY)` to `csOrchestrator()` + tagged-template SQL. Same endpoint shape; was in-scope for ADR-1013 because it's in the `/signup` hot path exercised right after the onboarding flow.
- [x] Migrated `app/src/app/api/internal/invites/route.ts` the same way. Catches pg 23505 on the `postgres.js` thrown error (`err.code`) for the "pending invite already exists" 409 branch.
- [x] Updated `docs/architecture/consentshield-definitive-architecture.md` §5.4 — the `cs_orchestrator` block now splits Edge-Function (JWT) vs Next.js-runtime (direct-Postgres) connection patterns explicitly, names the env var, and lists which routes are migrated. §12 env table gained `SUPABASE_CS_ORCHESTRATOR_DATABASE_URL` alongside `SUPABASE_CS_API_DATABASE_URL`.
- [x] Updated `CLAUDE.md` Rule 5 to describe the direct-Postgres pattern for both `cs_api` and `cs_orchestrator` in the Next.js runtime, and to call out `/api/internal/run-probes` as the last JWT-path Next.js surface pending Sprint 2.2.
- [ ] ~~Add `SUPABASE_CS_ORCHESTRATOR_DATABASE_URL` to `scripts/check-env-isolation.ts` expected-keys list~~ — the original deliverable description was off. That script is a forbidden-name check (Rule 5 / Rule 12 isolation), not an expected-keys whitelist. No change needed; the env var is documented in the architecture doc's §12 env table instead.

**Tested:**
- [x] `cd app && bun run build / lint` — clean after both route migrations.

**Status:** `[x] complete — 2026-04-21`

#### Sprint 2.2 — Migrate `/api/internal/run-probes` off CS_ORCHESTRATOR_ROLE_KEY

**Deliverables:**

- [x] `app/src/app/api/internal/run-probes/route.ts` — rewrote off `createClient(…, CS_ORCHESTRATOR_ROLE_KEY)` onto `csOrchestrator()` + tagged-template SQL. Five operations migrated: `consent_probes` select (due-probe scan with `is_active = true and (next_run_at is null or next_run_at <= now())`), `tracker_signatures` select, `web_properties` select, `consent_probe_runs` insert, `consent_probes` update (last_run_at / last_result / next_run_at). `runProbe` signature changed from `(supabase: SupabaseClient, probe, signatures)` to `(sql: Sql, probe, signatures)`. `jsonb` columns (`consent_state`, `result`, `last_result`) serialised via `JSON.stringify` + `::jsonb` cast to satisfy postgres.js's strict template-parameter typing.
- [x] `supabase/migrations/20260803000010_cs_orchestrator_select_tracker_signatures.sql` — `grant select on public.tracker_signatures to cs_orchestrator`. The legacy JWT path was BYPASSRLS so it worked without the table grant; the pooler LOGIN path needs the explicit grant. Audit via `has_table_privilege` confirmed this was the only missing grant across the five tables the route touches (consent_probes column-level UPDATE grant from migration 20260413000010 is intact).
- [x] Removed `SUPABASE_URL` + `ORCHESTRATOR_KEY` consts from the route. Only residual reference to `CS_ORCHESTRATOR_ROLE_KEY` is in the header comment explaining the migration.

**Tested:**
- [x] `cd app && bun run build / lint` — clean.
- [x] `bunx supabase db push` — tracker_signatures grant applied.
- [x] Audit: `grep -rln CS_ORCHESTRATOR_ROLE_KEY app/src` — zero code hits, one comment hit (this header).

**Status:** `[x] complete — 2026-04-21`

---

## ADR close-out (2026-04-21)

With Sprint 2.2 landed, every Next.js-runtime caller of cs_orchestrator is on the direct-Postgres pool. `CS_ORCHESTRATOR_ROLE_KEY` is no longer referenced by any customer-app source code — only by Edge Functions (hosted Supabase pool, separate runtime) and by `docs/architecture/consentshield-definitive-architecture.md` §12 where it's flagged as the Edge-Function-only env var.

The ADR's acceptance criteria are met. Marking **Completed**.

---

## Acceptance criteria

- No Next.js-runtime code path references `CS_ORCHESTRATOR_ROLE_KEY`. ✅ (verified 2026-04-21 via `grep -rln CS_ORCHESTRATOR_ROLE_KEY app/src` — zero code hits)
- `signup-intake` and `invitation-dispatch` both reach their RPCs via direct-Postgres as `cs_orchestrator`.
- `cs_orchestrator` password is rotated off the seed placeholder.
- CI lint + build on `app/` pass.
- `/api/public/signup-intake` end-to-end test returns the expected 202/200/409 per branch.

## Consequences

**Enables:**

- Full independence from the Supabase HS256 JWT rotation kill-timer for customer-app runtime.
- Consistent connection pattern across all customer-app scoped roles (cs_api + cs_orchestrator both direct-Postgres now).
- Signup-intake + admin operator-intake end-to-end flows become testable once the operator runs the two setup steps in Sprint 1.2.

**Introduces:**

- A second pooler connection string (alongside `SUPABASE_CS_API_DATABASE_URL`). Two env vars to manage, not one.
- The `orchestrator` pool is a separate long-lived connection — fine at Fluid Compute scale, noted in case connection-budget accounting is tightened later.

**Out of scope:**

- Edge Functions' cs_orchestrator usage — already direct-Postgres via Deno pool, untouched.
- `cs_delivery` — no Next.js-runtime caller exists today. If one lands later, the same pattern applies and this ADR serves as the template.
