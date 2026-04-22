# ADR-1010 Phase 1 Sprint 1.1 — cs_worker migration prototype

The Cloudflare Worker currently authenticates to Supabase REST using
`SUPABASE_WORKER_KEY` — an HS256 JWT claiming `role: cs_worker`, signed
with the project's legacy HS256 shared secret. Supabase is rotating
HS256 → ECC P-256; once the legacy key is revoked, every PostgREST
call from the Worker 401s.

This directory holds the Phase 1 Sprint 1.1 prototypes that let us
compare three replacement mechanisms head-to-head. Each probe is
invoked via the scratch Worker route `/v1/_cs_api_probe?via=<mechanism>`.
Each returns a small JSON envelope:

```json
{
  "mechanism": "rest | hyperdrive | raw_tcp",
  "ok": true | false,
  "latency_ms": 123,
  "current_user": "cs_worker",
  "note": "…"
}
```

Decision criteria (recorded in the ADR amendment after the sprint):

1. **Correctness** — does the probe return `current_user = cs_worker`?
2. **Latency** — p50 of 10 consecutive probes from the Cloudflare
   edge; want sub-250ms against the Mumbai region.
3. **Bundle-size impact** — how many KB the mechanism adds to the
   Worker's compiled output.
4. **Operational surface** — what new Cloudflare dashboard config or
   wrangler secrets the mechanism requires.

## Mechanism shortlist

### A — Hyperdrive (Cloudflare-native Postgres pooler)

Cloudflare Hyperdrive speaks the Postgres wire protocol and works with
`postgres.js` from Workers. First-class Supabase origin support.

**Operator action required** (not yet completed):

1. Open Cloudflare Dashboard → Workers → Hyperdrive → Create.
2. Origin: `postgresql://cs_worker.xlqiakmkdjycfiioslgs:$CS_WORKER_PASSWORD@aws-1-ap-northeast-1.pooler.supabase.com:6543/postgres?sslmode=require`.
3. Name: `cs-worker-hyperdrive`.
4. Bind to the Worker via `wrangler.toml`:
   ```toml
   [[hyperdrive]]
   binding = "HYPERDRIVE"
   id = "<hyperdrive-id-from-dashboard>"
   ```
5. Redeploy. `env.HYPERDRIVE.connectionString` is now populated at runtime.

Until the operator provisions Hyperdrive, `probe-hyperdrive.ts`
returns `{ ok: false, note: "hyperdrive_binding_not_configured" }`.

### B — REST over `sb_secret_*` (opaque-token gateway)

Supabase's new opaque API-key format (`sb_secret_*`) is the forward-
compatible replacement for the HS256 service-role key. It does NOT let
us mint role-claimed JWTs — PostgREST uses the token's associated role
directly. Because all `sb_secret_*` keys are service-role-equivalent,
using this for the Worker would violate CLAUDE.md Rule 5 unless Supabase
ships per-role opaque tokens (which they haven't as of 2026-04-22).

**Status:** documented for completeness; not viable for Rule 5. The probe
is scaffolded as a reference call site but flagged `retained: false` in
the decision matrix.

### C — Hand-rolled TCP Postgres client

Implements the minimal subset of the Postgres wire protocol needed to:
issue a `SELECT` over TLS, authenticate with SCRAM-SHA-256, and return
the scalar result. ~300 lines of binary-protocol code. Avoids the
Hyperdrive dependency. More surface to maintain.

**Skeleton only** — `probe-raw-tcp.ts` stubs the entry point with a
TODO block listing each wire-protocol step. Full implementation lives
in its own ADR amendment if A is rejected.

## Where this lands

- The scratch route `/v1/_cs_api_probe` is wired in `worker/src/index.ts`
  and intended to be removed the moment the mechanism is chosen
  (Phase 1 close).
- Each `probe-*.ts` file is self-contained: remove the file + the route
  dispatch and nothing else breaks.
- No new npm dependencies (CLAUDE.md Rule 16 — the Worker stays vanilla
  TypeScript).
