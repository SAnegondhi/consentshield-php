import { getAdminConfig } from './admin-config'
import { handleBannerScript } from './banner'
import { getClientIp, ipBlockedResponse, isIpBlocked } from './blocked-ip'
import { handleConsentEvent } from './events'
import { handleObservation } from './observations'
import { probeViaHyperdrive } from './prototypes/probe-hyperdrive'
import { probeViaRawTcp } from './prototypes/probe-raw-tcp'
import { probeViaRest } from './prototypes/probe-rest'
import type { ProbeMechanism, ProbeResult } from './prototypes/types'
import { assertWorkerKeyRole, WorkerRoleGuardError } from './role-guard'

export interface Env {
  BANNER_KV: KVNamespace
  SUPABASE_URL: string
  SUPABASE_WORKER_KEY: string
  // ADR-1010 Sprint 2.1 follow-up — local-dev opt-in for sb_secret_*
  // stand-in per ADR-1014 Sprint 1.3. Never set in production.
  ALLOW_SERVICE_ROLE_LOCAL?: string
}

// ADR-1010 Sprint 2.1 follow-up — Rule-5 runtime enforcement.
// assertWorkerKeyRole() is cheap (in-memory base64 decode + JSON.parse) but
// we still cache the verdict so it runs at most once per Worker instance.
// null = not yet checked; Error = failure to surface on every request.
let roleGuardVerdict: { ok: true } | { ok: false; error: Error } | null = null

function runRoleGuard(env: Env): { ok: true } | { ok: false; error: Error } {
  if (roleGuardVerdict !== null) return roleGuardVerdict
  try {
    assertWorkerKeyRole(env)
    roleGuardVerdict = { ok: true }
  } catch (e) {
    roleGuardVerdict = {
      ok: false,
      error: e instanceof Error ? e : new Error(String(e)),
    }
  }
  return roleGuardVerdict
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url)
    const { pathname } = url

    // Rule-5 runtime guard. If SUPABASE_WORKER_KEY doesn't carry a
    // role='cs_worker' JWT (and the local-dev opt-in is not set), every
    // request returns 503 with a diagnostic. Health endpoint is exempt so
    // operators can still probe the Worker to see WHY it's degraded.
    if (pathname !== '/v1/health') {
      const verdict = runRoleGuard(env)
      if (!verdict.ok) {
        const isGuardErr = verdict.error instanceof WorkerRoleGuardError
        return new Response(
          JSON.stringify({
            error: 'worker_misconfigured',
            reason: isGuardErr ? verdict.error.message : 'role_guard_failed',
          }),
          {
            status: 503,
            headers: {
              'Content-Type': 'application/json',
              'Cache-Control': 'no-store',
            },
          },
        )
      }
    }

    // CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type',
          'Access-Control-Max-Age': '86400',
        },
      })
    }

    // Blocked-IP enforcement (ADR-0033 Sprint 2.3). Health + CORS above
    // are exempt — a blocked IP should still see a loopback probe if an
    // operator is diagnosing. Everything route-specific goes through
    // the check. Reads from the shared admin_config snapshot in KV.
    if (pathname !== '/v1/health') {
      const clientIp = getClientIp(request)
      const config = await getAdminConfig(env)
      if (isIpBlocked(clientIp, config.blocked_ips)) {
        return ipBlockedResponse()
      }
    }

    // Route dispatch
    if (pathname === '/v1/banner.js' && request.method === 'GET') {
      return handleBannerScript(request, env)
    }

    if (pathname === '/v1/events' && request.method === 'POST') {
      return handleConsentEvent(request, env, ctx)
    }

    if (pathname === '/v1/observations' && request.method === 'POST') {
      return handleObservation(request, env, ctx)
    }

    if (pathname === '/v1/health' && request.method === 'GET') {
      return new Response(JSON.stringify({ status: 'ok', ts: Date.now() }), {
        headers: { 'Content-Type': 'application/json' },
      })
    }

    // ADR-1010 Phase 1 Sprint 1.1 — scratch probe route. Runs one or
    // all three candidate mechanisms for the cs_worker direct-Postgres
    // migration and returns a latency-comparison envelope. Removed at
    // Phase 1 close once the mechanism is decided.
    if (pathname === '/v1/_cs_api_probe' && request.method === 'GET') {
      const via = (url.searchParams.get('via') ?? 'all') as ProbeMechanism | 'all'
      const runners: Record<ProbeMechanism, (env: Env) => Promise<ProbeResult>> = {
        rest: probeViaRest,
        hyperdrive: probeViaHyperdrive,
        raw_tcp: probeViaRawTcp,
      }

      let results: ProbeResult[]
      if (via === 'all') {
        results = await Promise.all(
          (Object.keys(runners) as ProbeMechanism[]).map((m) => runners[m](env)),
        )
      } else if (via in runners) {
        results = [await runners[via](env)]
      } else {
        return new Response(
          JSON.stringify({
            error: 'invalid_via',
            allowed: ['rest', 'hyperdrive', 'raw_tcp', 'all'],
          }),
          { status: 400, headers: { 'Content-Type': 'application/json' } },
        )
      }

      return new Response(
        JSON.stringify({ ok: true, probed_at: Date.now(), results }),
        {
          status: 200,
          headers: {
            'Content-Type': 'application/json',
            'Cache-Control': 'no-store',
          },
        },
      )
    }

    return new Response('Not found', { status: 404 })
  },
}
