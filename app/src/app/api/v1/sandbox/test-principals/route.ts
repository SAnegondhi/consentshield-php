import { problemJson } from '@/lib/api/auth'
import {
  readContext,
  respondV1,
  requireOrgOrProblem,
} from '@/lib/api/v1-helpers'
import { csOrchestrator } from '@/lib/api/cs-orchestrator-client'

// ADR-1003 Sprint 5.1 R2 — POST /api/v1/sandbox/test-principals
//
// (Spec deviation: ADR called for /api/v1/_sandbox/... but Next.js
// App Router treats `_folder` as private and never routes it. Dropped
// the underscore — same semantics, cleaner URL.)
//
// Sandbox-only. Returns the next deterministic test-principal identifier
// for the caller's org. Useful for integration-test scaffolding so a
// customer can run repeatable end-to-end consent flows without burning
// real PII into the system.
//
// Behaviour:
//   * Bearer middleware authenticates the api_key + sets the
//     ApiKeyContext headers. The middleware accepts both cs_live_* and
//     cs_test_* keys; this route is only valid for cs_test_*.
//   * We refuse account-scoped keys (org-scoped only — the test-
//     principal sequence is per-org).
//   * We refuse non-sandbox orgs at the RPC layer
//     (rpc_sandbox_next_test_principal raises 42501 otherwise).
//
// Scope: no explicit scope required. Sandbox is intended to be
// permissive; the rate_tier='sandbox' cap (100/hr per ADR-1001 Sprint
// 2.4) provides the safety rail.

const ROUTE = '/api/v1/_sandbox/test-principals'

export async function POST() {
  const { context, t0 } = await readContext()

  const orgGate = requireOrgOrProblem(context, ROUTE)
  if (orgGate) return respondV1(context, ROUTE, 'POST', orgGate.status, orgGate.body, t0, true)

  // Defense-in-depth: refuse if the api_key isn't a sandbox-tier key.
  // The RPC will also refuse non-sandbox orgs, but checking the rate
  // tier here gives a clearer error to a caller who minted a cs_live_
  // key against what they think is a sandbox org.
  if (context.rate_tier !== 'sandbox') {
    return respondV1(
      context,
      ROUTE,
      'POST',
      403,
      problemJson(
        403,
        'Forbidden',
        'Test-principal generator is sandbox-only. Mint a cs_test_* key against a sandbox org and retry.',
      ),
      t0,
      true,
    )
  }

  try {
    const sql = csOrchestrator()
    const rows = await sql<Array<{ result: { identifier: string; seq: number } }>>`
      select public.rpc_sandbox_next_test_principal(${context.org_id!}::uuid) as result
    `
    return respondV1(context, ROUTE, 'POST', 200, rows[0].result, t0)
  } catch (e) {
    const err = e as { code?: string; message?: string }
    if (err.code === '42501') {
      return respondV1(
        context,
        ROUTE,
        'POST',
        403,
        problemJson(
          403,
          'Forbidden',
          err.message?.includes('not_a_sandbox_org')
            ? 'This endpoint is only available for sandbox orgs.'
            : 'Forbidden',
        ),
        t0,
        true,
      )
    }
    return respondV1(
      context,
      ROUTE,
      'POST',
      500,
      problemJson(500, 'Internal Server Error', 'Failed to generate test principal'),
      t0,
      true,
    )
  }
}
