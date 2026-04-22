// ADR-1010 Phase 1 Sprint 1.1 — Mechanism B: REST with SUPABASE_WORKER_KEY.
//
// This is the EXISTING path the Worker uses today. Including it in the
// prototype gives us a latency baseline to measure the other mechanisms
// against, and a sanity check that the role-guard + current Worker config
// remain functional while we move off it.
//
// To probe the current role, we call a SECURITY DEFINER helper that
// returns current_user. If that helper doesn't exist yet we fall back to
// a tracker_signatures SELECT (which cs_worker has grant on) and map
// the 200 response to a pseudo `current_user = cs_worker` — any other
// response means the bearer role is wrong.

import type { Env } from '../index'
import type { ProbeResult } from './types'

export async function probeViaRest(env: Env): Promise<ProbeResult> {
  const start = Date.now()

  try {
    // tracker_signatures is read by every banner fetch; cs_worker has
    // grant on it. If this 200s the Worker's REST path is intact.
    const res = await fetch(
      `${env.SUPABASE_URL}/rest/v1/tracker_signatures?select=service_slug&limit=1`,
      {
        headers: {
          apikey: env.SUPABASE_WORKER_KEY,
          Authorization: `Bearer ${env.SUPABASE_WORKER_KEY}`,
        },
      },
    )
    const latency = Date.now() - start

    if (!res.ok) {
      return {
        mechanism: 'rest',
        ok: false,
        latency_ms: latency,
        status_code: res.status,
        error: await res.text().then((t) => t.slice(0, 300)).catch(() => 'unreadable'),
        note: res.status === 401
          ? 'hs256_revoked_or_expired'
          : 'rest_non_2xx',
      }
    }

    return {
      mechanism: 'rest',
      ok: true,
      latency_ms: latency,
      // PostgREST doesn't report the executing role; role-guard vouches
      // for it at boot. When option C (raw TCP) lands we'll compare its
      // `select current_user` output against this value.
      current_user: 'cs_worker (inferred)',
      note: 'baseline — this is the path in production today',
    }
  } catch (e) {
    return {
      mechanism: 'rest',
      ok: false,
      latency_ms: Date.now() - start,
      error: e instanceof Error ? e.message : String(e),
      note: 'rest_fetch_threw',
    }
  }
}
