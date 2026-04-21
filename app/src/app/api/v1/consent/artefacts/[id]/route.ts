import { NextRequest } from 'next/server'
import { problemJson } from '@/lib/api/auth'
import { readContext, respondV1, gateScopeOrProblem, requireOrgOrProblem } from '@/lib/api/v1-helpers'
import { getArtefact } from '@/lib/consent/read'

// ADR-1002 Sprint 3.1 — GET /v1/consent/artefacts/{id}
//
// Returns the artefact + revocation record (if any) + replacement chain
// (chronological array of artefact_ids). Scope: read:artefacts.

const ROUTE = '/api/v1/consent/artefacts/[id]'

export async function GET(_request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params
  const { context, t0 } = await readContext()

  const scopeGate = gateScopeOrProblem(context, 'read:artefacts')
  if (scopeGate) return respondV1(context, ROUTE, 'GET', scopeGate.status, scopeGate.body, t0, true)

  const orgGate = requireOrgOrProblem(context, '/api/v1/consent/artefacts/{id}')
  if (orgGate) return respondV1(context, ROUTE, 'GET', orgGate.status, orgGate.body, t0, true)

  if (!id) {
    return respondV1(
      context, ROUTE, 'GET', 422,
      problemJson(422, 'Unprocessable Entity', 'artefact id path parameter is required'),
      t0, true,
    )
  }

  const result = await getArtefact({ keyId: context.key_id, orgId: context.org_id!, artefactId: id })

  if (!result.ok) {
    if (result.error.kind === 'api_key_binding') {
      return respondV1(context, ROUTE, 'GET', 403,
        problemJson(403, 'Forbidden', 'API key does not authorise access to this organisation'), t0, true)
    }
    return respondV1(context, ROUTE, 'GET', 500,
      problemJson(500, 'Internal Server Error', 'Lookup failed'), t0, true)
  }

  if (result.data === null) {
    return respondV1(
      context, ROUTE, 'GET', 404,
      problemJson(404, 'Not Found', 'No artefact with that id belongs to your org'),
      t0, true,
    )
  }

  return respondV1(context, ROUTE, 'GET', 200, result.data, t0)
}
