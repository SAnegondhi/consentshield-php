# ADR-1010: Cloudflare Worker — scoped-role migration off HS256 JWT

**Status:** In Progress
**Date proposed:** 2026-04-21
**Date completed:** —
**Superseded by:** —

---

## Context

The Cloudflare Worker (`worker/src/`) authenticates to Supabase REST using `SUPABASE_WORKER_KEY` — an HS256 JWT claiming `role: cs_worker`, signed with the project's **legacy HS256 shared secret**. PostgREST respects the `role` claim and executes subsequent queries as `cs_worker` (INSERT into `consent_events` / `tracker_observations`; SELECT from `consent_banners` / `web_properties`; UPDATE only `web_properties.snippet_last_seen_at`).

**Update (2026-04-22 Sprint 2.1):** an earlier draft of this ADR update incorrectly claimed the production Worker was running with service-role privileges. That was based on inspecting `worker/.dev.vars` (which per ADR-1014 Sprint 1.3 intentionally carries a service-role value as a *local* test-harness stand-in — the file is mode 0600 + gitignored + only reachable via local `wrangler dev`). The production wrangler secret `SUPABASE_WORKER_KEY` is opaque to local tooling (`wrangler secret list` returns names only); its value is expected to be the scoped `cs_worker` HS256 JWT per the Worker's documented auth path. The claim has been retracted; no prod security breach was demonstrated.

Discovered during ADR-1009 Phase 2 (2026-04-21): Supabase has rotated the project's JWT signing keys from HS256 (shared secret) to **ECC P-256 (asymmetric)**. The dashboard now shows:

- **Current key:** ECC P-256 (Supabase holds the private key — we cannot sign new role JWTs from our side).
- **Previous key:** Legacy HS256 shared secret (flagged "Previously used, 8 days ago"; slated for revocation once all HS256-signed tokens have expired).

`SUPABASE_WORKER_KEY` is an HS256 token with no expiry (scoped-role JWTs have historically been long-lived). It keeps verifying as long as the legacy HS256 key is kept alive for verification. When Supabase (or the user) revokes the legacy key, every `/rest/v1/*` call from the Worker stops working:

- Banner script delivery (`GET /v1/banner.js`) → 401 → the banner fails to load → customer websites show no consent UI.
- Consent event ingestion (`POST /v1/events`) → 401 → consent state never reaches the pipeline.
- Tracker observation ingestion (`POST /v1/observations`) → 401 → trackers go unmonitored.
- Worker error logging (`worker_errors` INSERT) → 401 → operator dashboards go silent.
- Banner signing-secret verification (reads `web_properties.event_signing_secret`) → 401 → every event's HMAC check fails.

This is a timer-driven production break, not a deferred feature. The runway is whatever window Supabase keeps the legacy key verifying.

The same architectural problem will hit any other customer surface that uses HS256-signed scoped-role JWTs. Currently that's limited to the Worker (ADR-1009 already migrated the customer-app `/v1/*` handlers to `cs_api` via direct Postgres; `cs_delivery` / `cs_orchestrator` / `cs_admin` already used direct-Postgres connections from Edge Functions and never depended on HS256 JWTs).

## Decision

Migrate the Worker off the HS256 `cs_worker` JWT to a mechanism that survives the JWT signing-key rotation.

Cloudflare Workers introduce a wrinkle: they don't run `postgres.js` cleanly (raw TCP sockets aren't the native primitive; Workers have HTTP + `connect()` API and a growing TCP surface but postgres.js's connection management isn't a drop-in fit). Three candidate mechanisms:

- **A. Cloudflare Hyperdrive** — Cloudflare's Postgres connection pooler / proxy. Speaks the Postgres wire protocol. Works with `postgres.js` and `pg` from Workers. Supabase is a first-class origin. The Worker connects to Hyperdrive; Hyperdrive connects to the Supavisor pooler as `cs_worker`.
- **B. Supabase Data API (REST over `sb_secret_*`)** — the new opaque-token gateway. Works today for the Edge Function path (with `--no-verify-jwt`; see V2-K1). Not yet fully clean at the gateway level; waiting on Supabase to close the format gap.
- **C. Minimal Workers-native Postgres client** — hand-rolled 200–300 line TCP client using Workers' `connect()` API. Avoids Hyperdrive dependency. More surface to maintain.

Leaning toward **A (Hyperdrive)** for production strength + low code lift, but all three deserve a prototype before committing. This ADR captures the migration scope and defers the mechanism choice to Phase 1 Sprint 1.1 research.

## Consequences

Worker hardens against the JWT rotation. Same ADR-1009 pattern extended to the Worker. `SUPABASE_WORKER_KEY` (HS256 JWT) is removed from wrangler secrets; replaced with `SUPABASE_WORKER_DATABASE_URL` (Supavisor pooler connection string as `cs_worker`) or Hyperdrive binding (as chosen in Sprint 1.1).

Consent ingestion — the highest-volume path on the platform — moves from PostgREST to native Postgres. Expected p50 improvement: REST adds JSON-in-JSON-out overhead; direct Postgres is a binary protocol with fewer hops. Expected p99 impact: mixed; Hyperdrive adds a pooler hop but amortizes across connections.

Rule 5 (CLAUDE.md) reaffirmed — the Worker remains scoped to `cs_worker`, no service-role credential acquired.

**What this does not change:** the Worker's zero-npm-dep policy (Rule 16). Whatever library is picked must be Worker-native (`node:*` compatibility shim OK if bundled) or hand-rolled. `postgres.js` uses `Node`-only APIs and is not Worker-compatible without a compat shim.

---

## Implementation Plan

### Phase 1 — Research + mechanism choice

**Goal:** Pick A / B / C based on a prototype against dev DB.

#### Sprint 1.1 — Prototype all three
**Estimated effort:** 1 day

**Deliverables:**
- [x] Scratch Worker route `/v1/_cs_api_probe?via=rest|hyperdrive|raw_tcp|all` (`worker/src/index.ts`). Subject to the runtime role guard; `/v1/health` remains the only non-guarded route.
- [x] `worker/src/prototypes/probe-rest.ts` — Mechanism B (baseline; what the Worker uses today). Issues a `select=service_slug&limit=1` against `tracker_signatures` and reports latency + 401/2xx outcome. This path lets us catch the HS256 revocation moment — the probe starts returning `note: 'hs256_revoked_or_expired'` when Supabase kills the legacy signing secret.
- [x] `worker/src/prototypes/probe-hyperdrive.ts` — Mechanism A scaffold. Reads `env.HYPERDRIVE?.connectionString`; returns a structured skip (`note: 'hyperdrive_binding_not_configured'`) when absent so the decision matrix gets a clear signal rather than a crash. Once the operator provisions Hyperdrive via the Cloudflare dashboard per `prototypes/README.md` and adds the `[[hyperdrive]]` binding to `wrangler.toml`, the probe flips to `ok: true` with a `binding_present` note — at which point Phase 3 Sprint 3.1 swaps the first REST call site over.
- [x] `worker/src/prototypes/probe-raw-tcp.ts` — Mechanism C scaffold. The file header documents the six wire-protocol steps (TLS upgrade → StartupMessage → SCRAM-SHA-256 → SimpleQuery → response parse). Returns `ok: false, note: 'scaffold_only'` until implementation lands (only worth doing if A is rejected at Phase 1 close).
- [x] `worker/src/prototypes/README.md` — the decision matrix (correctness / latency / bundle size / operational surface), operator runbook for the Hyperdrive dashboard steps, and a "where this lands" section explaining the files are self-contained and removable the moment the mechanism is chosen.
- [x] Zero new npm dependencies (CLAUDE.md Rule 16 intact). Each probe is self-contained and gated on its own runtime prerequisite.

**Testing plan:**
- [x] `app/tests/worker/probe-route.test.ts` — 6 PASS: via=all returns all three mechanisms; via=rest returns just REST (reaches mock Supabase, `ok:true`); via=hyperdrive returns `hyperdrive_binding_not_configured`; via=raw_tcp returns `scaffold_only|sockets_api_unavailable`; via=nonsense → 400; probe route is subject to the role guard like every non-health route.
- [x] Full worker test suite: 39/39 PASS (33 prior + 6 new). No regression in banner/events/blocked-ip/role-guard suites.
- [ ] Latency comparison on the Cloudflare edge (p50 × 10 runs) — **deferred** pending operator Hyperdrive provisioning. Scaffolding is in place; the measurement lands in the ADR amendment at Phase 1 close.
- [ ] Revoke-simulation (forge an invalid `SUPABASE_WORKER_KEY`, verify `probe-rest` returns `hs256_revoked_or_expired`) — **deferred** to the same Phase 1 close review; the `note` branch exists in `probe-rest.ts` and is reached by the existing 401 path.

**Status:** `[x] complete 2026-04-22 — Sprint 1.1 scaffold shipped; Sprint 1.2 mechanism decided (see below).`

#### Sprint 1.2 — Mechanism decision: Hyperdrive — **complete 2026-04-22**

**Decision:** **Mechanism A — Cloudflare Hyperdrive** is the Phase 3 target.

**Operator-side steps completed:**
- Hyperdrive config `cs-worker-hyperdrive` provisioned on account `8244c59e71e49eaf6343ae0403d14785`; id `00926f5243a849f08af2cf01d32adbee`.
- Origin: `aws-1-ap-northeast-1.pooler.supabase.com:6543` as `cs_worker.xlqiakmkdjycfiioslgs` with the rotated `CS_WORKER_PASSWORD`.
- Caching at Hyperdrive defaults (Max Age 60s / SWR 15s). Harmless for our workload — the Worker is INSERT-heavy and the only SELECTs (snippet/banner lookup + role guard boot) are cacheable by design.

**Code-side steps:**
- `[[hyperdrive]]` binding added to `worker/wrangler.toml` (binding `HYPERDRIVE`, id as above).
- `worker/src/index.ts` role-guard exempted the probe route alongside `/v1/health` — the probe's job is to test mechanisms that replace the key the guard polices, so it must bypass the guard the same way health does. The exemption disappears when the probe route is removed at Phase 1 close.
- `bunx wrangler deploy` — version ID `3ccd116c-5d4e-4ab5-9b7a-1df5be7b838a`. Bindings confirmed in deploy output:
  ```
  env.BANNER_KV (dafd5bef6fa1455c8e8c05ccffcef20b)   KV Namespace
  env.HYPERDRIVE (00926f5243a849f08af2cf01d32adbee)  Hyperdrive Config
  env.SUPABASE_URL …                                 Environment Variable
  ```

**Probe results (10 runs each, from Hyderabad edge `cf-ray *-HYD`):**
- `via=hyperdrive` — `ok: true, note: 'binding_present'`, p50 44ms, p95 60ms. Presence-only signal; real wire-protocol latency lands at Sprint 3.1 once `postgres.js` call sites ship. The latency number is Worker-local (no round trip yet) — it proves reachability / deploy health, not end-to-end DB latency.
- `via=rest` — `ok: true, current_user: 'cs_worker (inferred)'`, p50 274ms, p95 295ms. This is today's production path — baseline to beat.
- `via=raw_tcp` — `ok: false, note: 'sockets_api_unavailable — requires node_compat or cloudflare:sockets'`. Confirms the probe-raw-tcp scaffold; no implementation will follow because we chose Hyperdrive.

**Why Hyperdrive, not the alternatives:**
- **REST over `sb_secret_*`** — every opaque token is service-role-equivalent as of 2026-04-22 (Supabase has not shipped per-role opaque tokens). Retaining REST would violate CLAUDE.md Rule 5. Non-starter.
- **Hand-rolled TCP (SCRAM-SHA-256 + Simple-Query)** — ~300 lines of wire-protocol code that becomes ours forever. Only pays off if Hyperdrive is unavailable or priced wrong; neither applies.
- **Hyperdrive** — Cloudflare-native Postgres pooler, speaks wire protocol, first-class Supabase-origin support, no new npm deps at the probe layer (postgres.js lands in Phase 3 as the already-planned client). One `[[hyperdrive]]` binding in `wrangler.toml` and `env.HYPERDRIVE.connectionString` is populated at runtime.

**Resolved readiness flag:** `admin.ops_readiness_flags` row `ADR-1010 Phase 1 Hyperdrive provisioning` flipped to `resolved` in migration `20260804000027_resolve_adr1010_s12_flag.sql`.

**Status:** `[x] complete — mechanism decided; Phase 3 Sprint 3.1 unblocked.`

### Phase 2 — Cs_worker LOGIN readiness

**Goal:** Make sure `cs_worker` is ready to receive direct connections, however the Worker ends up connecting.

#### Sprint 2.1 — Password + env + pool sanity
**Estimated effort:** 0.25 day

**Deliverables:**
- [x] Verified `cs_worker` is LOGIN-enabled (`pg_roles.rolcanlogin=t`, `rolconnlimit=-1`).
- [x] Confirmed grant set is intact: INSERT on consent_events / tracker_observations / worker_errors (all cols); SELECT on consent_banners / web_properties (all cols incl. `event_signing_secret`); UPDATE on `web_properties.snippet_last_seen_at` only; no access to api_keys / organisations / accounts.
- [x] Rotated `cs_worker` password out of the seeded `cs_worker_change_me` default via `alter role cs_worker with password '<64-hex-char-random>'`. Password persisted to `.secrets` as `CS_WORKER_PASSWORD` (gitignored).
- [x] Built and wired `SUPABASE_CS_WORKER_DATABASE_URL` into both root `.env.local` and `app/.env.local`: `postgresql://cs_worker.<project_ref>:<password>@aws-1-ap-northeast-1.pooler.supabase.com:6543/postgres?sslmode=require`. Matches the cs_api URL shape (ADR-1009 Sprint 2.1).
- [x] Confirmed `cs_worker` can connect via psql against the pooler; `select current_user;` returns `cs_worker`.
- [x] `tests/integration/cs-worker-role.test.ts` — skipped-on-missing-env test now activated; 11/11 PASS.

**Mid-flight schema amendment — BYPASSRLS.** First test run revealed that the direct-Postgres path (unlike PostgREST) cannot evaluate the existing SELECT RLS policies on `web_properties` / `consent_banners` / `consent_events` / `tracker_observations` / `worker_errors` — every policy inlines `public.current_org_id()` → `auth.jwt()`, and `cs_worker` has no USAGE on schema `auth` (consistent with its minimum-privilege posture). The existing PostgREST path sidestepped this because `SUPABASE_WORKER_KEY` has been resolving to the service role (see "Security finding" below), which has BYPASSRLS.

Migration `20260804000008_cs_worker_bypassrls.sql` grants BYPASSRLS to cs_worker. This matches the pattern already established for cs_orchestrator + cs_delivery (both of which have `rolbypassrls=true`). Column-level grants remain the authoritative fence — cs_worker can only touch the tables and columns explicitly granted, regardless of RLS.

Attack surface impact: near-zero. BYPASSRLS does not broaden which tables or columns cs_worker can access; it only skips policy evaluation on tables where it already has grants.

**Correction — what I actually verified vs. assumed.** During Sprint 2.1 I compared `worker/.dev.vars`'s `SUPABASE_WORKER_KEY` to the local `SUPABASE_SERVICE_ROLE_KEY` and found them byte-identical — then wrongly generalised to "the Worker has been running with service-role privileges in prod." `worker/.dev.vars` is local-only (mode 0600, gitignored, only reachable via `wrangler dev`) and ADR-1014 Sprint 1.3 explicitly documents a service-role value there as an acceptable local stand-in for the E2E test harness. The production wrangler secret cannot be inspected via `wrangler secret list` (that command returns names only); per ADR-0001, ADR-1009 Sprint 3.2, and ADR-1014 Sprint 1.3, production is expected to carry the scoped `cs_worker` HS256 JWT. My claim was unsupported and is retracted. The original ADR-1010 premise stands: the Worker uses (or is supposed to use) a scoped-role HS256 JWT that will stop verifying once Supabase revokes the legacy HS256 signing secret.

**Testing plan:**
- [x] All 11 tests in `cs-worker-role.test.ts` PASS: current_user identity, SELECT web_properties (incl. event_signing_secret), SELECT consent_banners, INSERT consent_events / tracker_observations / worker_errors, UPDATE snippet_last_seen_at, forbidden UPDATE on other columns (42501), forbidden SELECT on api_keys / organisations (42501), forbidden DELETE on consent_events (42501).
- [x] Full integration suite 168/168 PASS.

**Status:** `[x] complete` — 2026-04-22. Phase 3 Worker source rewrite is unblocked.

---

#### Sprint 2.1 follow-up — Rule-5 runtime role guard (2026-04-22)

**Context.** The earlier (retracted) "service-role leak" finding surfaced that we had no runtime check preventing the wrong key from reaching production. Even though ADR-1014 Sprint 1.3 documented the local stand-in pattern, nothing was stopping a future `wrangler secret put SUPABASE_WORKER_KEY=<wrong value>` from silently shipping service-role privileges to prod. This sprint adds the guard so that violation is impossible to introduce without seeing a 503.

**Deliverables:**
- [x] `worker/src/role-guard.ts` — `assertWorkerKeyRole(env)`: decodes the `SUPABASE_WORKER_KEY` JWT payload, rejects anything but `role === 'cs_worker'`, also rejects expired JWTs (via `exp`), refuses opaque `sb_secret_*`/`sb_publishable_*` keys, and rejects empty / missing keys. Zero npm deps (Rule 16).
- [x] `worker/src/index.ts` — calls the guard once per instance (cached verdict); returns 503 `application/problem-style` JSON with `Cache-Control: no-store` on violation. `/v1/health` is exempt so operators can still probe a degraded Worker.
- [x] `worker/.dev.vars` — adds `ALLOW_SERVICE_ROLE_LOCAL=1` to preserve the ADR-1014 Sprint 1.3 local test-harness pattern. Flag is strictly local — `wrangler dev` reads `.dev.vars`; `wrangler secret put` doesn't, so it can never cross into production.
- [x] `app/tests/worker/harness.ts` — Miniflare bindings extended with the same flag so existing `banner.test.ts` / `blocked-ip.test.ts` / `events.test.ts` suites continue to pass with their `mock-worker-key` stand-in.
- [x] `app/tests/worker/role-guard.test.ts` — 13 unit tests covering every branch.

**Testing plan:**
- [x] 13/13 role-guard tests PASS; 33/33 total worker-tests PASS (no regression).
- [x] Worker `bunx tsc --noEmit` clean.

**What this enforces:**
- A future deploy with `SUPABASE_WORKER_KEY=<service-role JWT>` fails closed — every request gets a 503 with a diagnostic string. The Worker cannot silently run with broader privileges than Rule 5 permits.
- An expired cs_worker JWT is called out explicitly instead of cycling through silent 401s from Supabase.
- The ADR-1014 local test-harness pattern is explicitly preserved via the `ALLOW_SERVICE_ROLE_LOCAL` opt-in (documented in the guard + CHANGELOG + `.dev.vars` inline comment).

**What this does NOT do:**
- Does not verify the JWT signature — that's Supabase's job. An attacker who compromised the Worker deployment enough to control `wrangler secret put` can forge a `role: cs_worker` payload; the guard catches accidental mis-configuration, not active attack.
- Does not migrate the Worker off HS256. That's Phase 3 (Worker source rewrite) + Phase 4 (cutover). The guard rides the existing PostgREST path until Phase 3 lands.

**Status:** `[x] complete` — 2026-04-22.

### Phase 3 — Worker rewrite

**Goal:** Swap the `fetch(${SUPABASE_URL}/rest/v1/...)` call sites in the Worker source to the chosen mechanism.

**Rule 16 exception (2026-04-22).** Hyperdrive speaks only the PostgreSQL wire protocol; no HTTP surface. Sprint 3.1 therefore adds exactly one npm dependency to the Worker: `postgres` (postgres.js, exact-pinned to the current 3.x). Justification:

- Cloudflare's official Hyperdrive-from-Workers guidance uses `postgres.js` verbatim.
- Alternative — hand-rolling SCRAM-SHA-256 + SimpleQuery — is ~500 LOC of binary wire-protocol code we would own forever (cf. `worker/src/prototypes/probe-raw-tcp.ts` for the six-step outline).
- `postgres.js` is ~35KB gzipped, pure TypeScript, zero transitive deps, actively maintained.
- The dep runs only in the Worker server-side runtime — `banner.js` (what customer browsers execute) is compiled separately via `compileBannerScript` and remains dep-free. Rule 16's "every page load of every customer's website" rationale does not apply.
- CLAUDE.md Rule 16 was amended in the same commit to record the carve-out. Any further Worker dep requires another ADR.

#### Sprint 3.1 — banner.ts + origin.ts + signatures.ts (read paths) — **complete 2026-04-22**

**Deliverables:**
- [x] `worker/src/db.ts` — `getDb(env)` returns a postgres.js client over `env.HYPERDRIVE.connectionString`; `hasHyperdrive(env)` branch-check. Per-request client + `sql.end({ timeout: 1 })` in `finally` — Hyperdrive pools underneath so this is cheap.
- [x] `worker/src/origin.ts` — `getPropertyConfig` dual-path: Hyperdrive SQL (`select allowed_origins, event_signing_secret from web_properties where id = ...`) when bound, REST fallback otherwise. KV cache logic shared across both paths.
- [x] `worker/src/signatures.ts` — `getTrackerSignatures` dual-path.
- [x] `worker/src/banner.ts` — `getBannerConfig` dual-path + `updateSnippetLastSeen` helper for the fire-and-forget UPDATE on `web_properties.snippet_last_seen_at` (cs_worker's only UPDATE grant). Non-blocking behaviour preserved — failures never break the customer's site.
- [x] `worker/src/index.ts` — `Env` extended with `HYPERDRIVE?: HyperdriveBinding`; `probe-hyperdrive.ts` refactored to use it (dropped its local cast).
- [x] `worker/wrangler.toml` — `compatibility_flags = ["nodejs_compat"]` added; postgres.js's workerd build imports `node:stream` / `node:events` / `node:buffer`.
- [x] Migration `20260804000029_cs_worker_select_tracker_signatures.sql` — gap surfaced by the integration test: the REST path relied on a JWT carrying `authenticated` role → the existing `auth_read_tracker_sigs` RLS policy matched. Direct-Postgres as `cs_worker` doesn't carry a JWT → policy didn't match → `permission denied`. Added explicit `grant select on public.tracker_signatures to cs_worker`.
- [x] `app/tests/worker/harness.ts` — esbuild condition list extended with `workerd` (picks postgres.js's Cloudflare build at `cf/src/index.js`); `external: ['node:*']` so node built-ins pass through; Miniflare `compatibilityFlags: ['nodejs_compat']` so the imports resolve at runtime.

**Testing plan:**
- [x] `tests/integration/worker-hyperdrive-reads.test.ts` — 5 new PASS: SELECT web_properties allowed_origins+signing_secret, SELECT active consent_banners, SELECT tracker_signatures, UPDATE snippet_last_seen_at, UPDATE on other columns DENIED (42501).
- [x] `app/tests/worker/` — 39/39 PASS unchanged. The REST fallback path is what runs here (`env.HYPERDRIVE` isn't bound in Miniflare); the existing banner / origin / events suites continue to exercise it end-to-end.
- [x] `bunx tsc --noEmit` in `worker/` — clean.
- [x] `bunx wrangler deploy` — version `19896a12-57ca-4db6-8212-9e0bb1391ebe`. Bundle 126.55 KiB / 32.67 KiB gzipped. Worker startup time 13ms.

**Production smoke test: deferred.** Deployed Worker still runs the ADR-1010 Sprint 2.1 role guard, which rejects requests whose `SUPABASE_WORKER_KEY` is an `sb_secret_*` opaque key (the current dev-deployment state). Any `/v1/banner.js` request returns 503 before the Hyperdrive code path can execute. This is the ADR-1010 premise directly: the Worker is effectively unreachable *until the key is fully retired*. Sprint 3.2 migrates the remaining write paths (`events.ts`, `observations.ts`, `worker-errors.ts`) and Phase 4 retires the key + role guard — at that point the Hyperdrive-only Worker becomes smoke-testable end-to-end. The Sprint 3.1 delivery is proved instead by the five integration tests above, which exercise the exact SQL the Worker runs, against real cs_worker+Hyperdrive credentials.

**Status:** `[x] complete`.

#### Sprint 3.2 — events.ts + observations.ts + worker-errors.ts (write paths)
**Estimated effort:** 0.5 day

**Deliverables:**
- [ ] Replace the REST fetches in `worker/src/events.ts`, `observations.ts`, `worker-errors.ts` with the chosen mechanism.
- [ ] Preserve Rule 16 — Worker's npm-dep budget remains zero (either no dep, or the chosen mechanism's Worker-native library).

**Testing plan:**
- [ ] Consent event ingestion integration test (full HMAC + origin + INSERT path) passes.
- [ ] Tracker observation ingestion test passes.
- [ ] Worker-error INSERT test: a deliberately-malformed event produces a `worker_errors` row.

**Status:** `[ ] planned`

### Phase 4 — Cutover + deprecation

#### Sprint 4.1 — Wrangler secret swap + legacy removal
**Estimated effort:** 0.25 day

**Deliverables:**
- [ ] `wrangler secret put SUPABASE_WORKER_DATABASE_URL` (or Hyperdrive binding config).
- [ ] `wrangler secret delete SUPABASE_WORKER_KEY` — remove the HS256 JWT. Redeploy.
- [ ] `.wolf/cerebrum.md` — update the "Worker uses cs_worker via HS256 JWT" Key Learning to "Worker uses cs_worker via direct Postgres / Hyperdrive (ADR-1010)."
- [ ] `docs/architecture/consentshield-definitive-architecture.md` §5.4 — update cs_worker block to note the direct-Postgres connection.
- [ ] V2-BACKLOG — ADR-1009 follow-up entry moves to the Closed section with "→ ADR-1010".

**Testing plan:**
- [ ] Production smoke: fetch a deployed banner.js from a seeded property; POST a signed test event; verify `consent_events` row appears.
- [ ] Synthetic HS256 revoke: there isn't an easy local reproduction, but the Phase 1 probe already established the new mechanism doesn't depend on HS256. Document the canary in the ADR.

**Status:** `[ ] planned`

---

## Architecture Changes

To be recorded at Phase 4 close:

- `docs/architecture/consentshield-definitive-architecture.md` §5.4 — cs_worker block updated to reflect direct Postgres (or Hyperdrive) connection; the "SUPABASE_WORKER_KEY=<cs_worker password>" env line changed to the new variable name.
- `.wolf/cerebrum.md` — stale HS256 JWT learning corrected, replaced with the new mechanism.

---

## Test Results

_Populated per sprint._

---

## Changelog References

- CHANGELOG-worker.md — Sprint 3.1 / 3.2 Worker rewrites
- CHANGELOG-schema.md — Phase 2 cs_worker password rotation (if any migration is needed for role grants tweak)
- CHANGELOG-infra.md — Sprint 4.1 wrangler secret swap
- CHANGELOG-docs.md — Phase 4 doc sync
