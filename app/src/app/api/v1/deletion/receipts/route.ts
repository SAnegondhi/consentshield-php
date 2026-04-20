import { NextRequest } from 'next/server'
import { problemJson } from '@/lib/api/auth'
import { readContext, respondV1, gateScopeOrProblem, requireOrgOrProblem } from '@/lib/api/v1-helpers'
import { listDeletionReceipts } from '@/lib/consent/deletion'

// ADR-1002 Sprint 4.1 — GET /v1/deletion/receipts
//
// Paged list of deletion_receipts rows. Filters: status, connector_id,
// artefact_id, issued_after, issued_before. Scope: read:deletion.

const ROUTE = '/api/v1/deletion/receipts'

export async function GET(request: NextRequest) {
  const { context, t0 } = await readContext()

  const scopeGate = gateScopeOrProblem(context, 'read:deletion')
  if (scopeGate) return respondV1(context, ROUTE, 'GET', scopeGate.status, scopeGate.body, t0, true)

  const orgGate = requireOrgOrProblem(context, ROUTE)
  if (orgGate) return respondV1(context, ROUTE, 'GET', orgGate.status, orgGate.body, t0, true)

  const url = new URL(request.url)
  const status       = url.searchParams.get('status')        || undefined
  const connectorId  = url.searchParams.get('connector_id')  || undefined
  const artefactId   = url.searchParams.get('artefact_id')   || undefined
  const issuedAfter  = url.searchParams.get('issued_after')  || undefined
  const issuedBefore = url.searchParams.get('issued_before') || undefined
  const cursor       = url.searchParams.get('cursor')        || undefined

  let limit: number | undefined
  const limitRaw = url.searchParams.get('limit')
  if (limitRaw !== null) {
    const n = parseInt(limitRaw, 10)
    if (isNaN(n) || n < 1 || n > 200) {
      return respondV1(context, ROUTE, 'GET', 422,
        problemJson(422, 'Unprocessable Entity', 'limit must be an integer between 1 and 200'),
        t0, true)
    }
    limit = n
  }

  for (const [name, v] of [['issued_after', issuedAfter], ['issued_before', issuedBefore]]) {
    if (v !== undefined && isNaN(new Date(v).getTime())) {
      return respondV1(context, ROUTE, 'GET', 422,
        problemJson(422, 'Unprocessable Entity', `${name} must be a valid ISO 8601 timestamp`),
        t0, true)
    }
  }

  const result = await listDeletionReceipts({
    orgId:        context.org_id!,
    status,
    connectorId,
    artefactId,
    issuedAfter,
    issuedBefore,
    cursor,
    limit,
  })

  if (!result.ok) {
    if (result.error.kind === 'bad_cursor') {
      return respondV1(context, ROUTE, 'GET', 422,
        problemJson(422, 'Unprocessable Entity', 'cursor is malformed'), t0, true)
    }
    return respondV1(context, ROUTE, 'GET', 500,
      problemJson(500, 'Internal Server Error', 'List failed'), t0, true)
  }

  return respondV1(context, ROUTE, 'GET', 200, result.data, t0)
}
