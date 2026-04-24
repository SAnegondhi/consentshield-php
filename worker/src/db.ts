// ADR-1010 Phase 3 Sprint 3.1 — postgres.js client over env.HYPERDRIVE.
// ADR-1010 Sprint 4.2 (2026-04-23) — request-scoped client + ctx.waitUntil cleanup.
//
// Single carve-out under CLAUDE.md Rule 16: `postgres` is the only npm
// dependency this Worker is allowed to import. It runs only in the
// Worker's server-side runtime; banner.js (what customer browsers
// execute) is compiled separately via compileBannerScript() and is
// never touched by this import.
//
// Connection lifecycle (corrected 2026-04-23):
//
//   1. Open ONE postgres.js client at the start of the Worker request
//      via openRequestSql(env).
//   2. Share it across every call site within the request (banner /
//      origin / signatures / snippet-update / event inserts / etc.).
//   3. The fetch() handler in index.ts — NOT this module — schedules
//      `ctx.waitUntil(sql.end({timeout:5}))` AFTER the response object
//      has been constructed. Cleanup runs off the hot path.
//
// Earlier iteration scheduled `ctx.waitUntil(sql.end())` inside
// openRequestSql. That was wrong: `sql.end()` creates a promise that
// begins executing immediately, which flips postgres.js into an
// "ending" state and causes the very first `sql\`SELECT ...\`` to
// reject with CONNECTION_ENDED. The outer `try { ... } catch { return
// null }` in banner/origin swallowed the rejection → null config →
// "Banner not found" 404. Confirmed in prod 2026-04-23.
//
// Sprint 3.1/4.1 opened a fresh client at every call site (3–4 per
// banner request) and awaited sql.end() in a finally block. That
// churned Hyperdrive's pool on rapid sequential requests (2.9s cold
// start; 000-timeout streaks under load). Module-scoped singletons
// tripped Workers error 1101 — postgres.js internal state doesn't
// survive reuse across requests. Per-request-scoped is the path that
// both survives AND keeps cleanup off the hot path.

import postgres from 'postgres'
import type { Env, HyperdriveBinding } from './index'

export type Sql = ReturnType<typeof postgres>

/**
 * Open a fresh postgres.js client for one Worker request.
 *
 * Does NOT schedule cleanup — the fetch() handler in index.ts is
 * responsible for `ctx.waitUntil(sql.end({timeout:5}))` after its
 * response is built, so `end()` is not called before queries run.
 *
 * Returns null when env.HYPERDRIVE is not bound (the Miniflare test
 * harness path). Callers treat null as "use REST fallback".
 */
export function openRequestSql(env: Env): Sql | null {
  const binding = env.HYPERDRIVE as HyperdriveBinding | undefined
  const dsn = binding?.connectionString
  if (!dsn) return null

  // max: 5 — matches Cloudflare's Hyperdrive + postgres.js recommended
  //   config. max: 1 seemed safer (one connection per request, no pool
  //   exhaustion on Hyperdrive's upstream), but in practice Workers
  //   closes long-idle sockets, so serialising multiple queries onto a
  //   single socket produces "Network connection lost" errors on the
  //   second query. Five gives postgres.js enough headroom for the
  //   banner path's concurrent tail (updateSnippetLastSeen racing
  //   getTrackerSignatures) while staying well under Hyperdrive's
  //   upstream pool bound.
  //
  // fetch_types: false — postgres.js's first connect would otherwise run
  //   a `SELECT ... FROM pg_type` to cache OIDs, which doubles the cold-
  //   start cost. cs_worker only handles jsonb/uuid/text/timestamptz/
  //   bool; postgres.js ships wire-format defaults for all of those.
  return postgres(dsn, {
    max: 5,
    prepare: false,
    fetch_types: false,
    connect_timeout: 30,
    onnotice: () => {},
  })
}

export function hasHyperdrive(env: Env): boolean {
  const binding = env.HYPERDRIVE as HyperdriveBinding | undefined
  return !!binding?.connectionString
}
