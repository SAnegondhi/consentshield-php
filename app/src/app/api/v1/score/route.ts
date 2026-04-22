import { problemJson } from '@/lib/api/auth'
import {
  readContext,
  respondV1,
  gateScopeOrProblem,
  requireOrgOrProblem,
} from '@/lib/api/v1-helpers'
import { getDepaScore } from '@/lib/api/score'

// ADR-1016 Sprint 1.3 — GET /v1/score
//
// Returns the cached DEPA compliance score (ADR-0025) for the caller's
// org. All four dimension scores are 0..5; total_score is 0..20;
// max_score is a fixed constant (20). Null-envelope returned for an org
// whose nightly refresh has not yet run.
//
// Scope: read:score. Account-scoped keys → 400.

const ROUTE = '/api/v1/score'

export async function GET() {
  const { context, t0 } = await readContext()

  const scopeGate = gateScopeOrProblem(context, 'read:score')
  if (scopeGate) return respondV1(context, ROUTE, 'GET', scopeGate.status, scopeGate.body, t0, true)

  const orgGate = requireOrgOrProblem(context, ROUTE)
  if (orgGate) return respondV1(context, ROUTE, 'GET', orgGate.status, orgGate.body, t0, true)

  const result = await getDepaScore({ keyId: context.key_id, orgId: context.org_id! })

  if (!result.ok) {
    if (result.error.kind === 'api_key_binding') {
      return respondV1(context, ROUTE, 'GET', 403,
        problemJson(403, 'Forbidden', 'API key does not authorise access to this organisation'),
        t0, true)
    }
    return respondV1(context, ROUTE, 'GET', 500,
      problemJson(500, 'Internal Server Error', 'Score read failed'), t0, true)
  }

  return respondV1(context, ROUTE, 'GET', 200, result.data, t0)
}
