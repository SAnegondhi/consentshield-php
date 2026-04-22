import { NextRequest } from 'next/server'
import { problemJson } from '@/lib/api/auth'
import {
  readContext,
  respondV1,
  gateScopeOrProblem,
  requireOrgOrProblem,
} from '@/lib/api/v1-helpers'
import { listAuditLog } from '@/lib/api/audit'

// ADR-1016 Sprint 1.1 — GET /v1/audit
//
// Keyset-paginated audit_log for the caller's org. The table is a buffer
// (Rule 1) — rows are delivered to customer R2/S3 and deleted within ~5
// minutes. This endpoint therefore serves only the undelivered +
// recently-delivered window. The canonical historical audit lives in the
// customer's own storage.
//
// Scope: read:audit. Account-scoped keys → 400 (needs an org-scoped key).
// ip_address is deliberately excluded from the response envelope (PII).

const ROUTE = '/api/v1/audit'

export async function GET(request: NextRequest) {
  const { context, t0 } = await readContext()

  const scopeGate = gateScopeOrProblem(context, 'read:audit')
  if (scopeGate) return respondV1(context, ROUTE, 'GET', scopeGate.status, scopeGate.body, t0, true)

  const orgGate = requireOrgOrProblem(context, ROUTE)
  if (orgGate) return respondV1(context, ROUTE, 'GET', orgGate.status, orgGate.body, t0, true)

  const url = new URL(request.url)
  const eventType     = url.searchParams.get('event_type')    ?? undefined
  const entityType    = url.searchParams.get('entity_type')   ?? undefined
  const createdAfter  = url.searchParams.get('created_after')  ?? undefined
  const createdBefore = url.searchParams.get('created_before') ?? undefined
  const cursor        = url.searchParams.get('cursor')         ?? undefined
  const limitRaw      = url.searchParams.get('limit')

  if (createdAfter && Number.isNaN(Date.parse(createdAfter))) {
    return respondV1(context, ROUTE, 'GET', 422,
      problemJson(422, 'Unprocessable Entity', 'created_after must be a valid ISO 8601 timestamp'), t0, true)
  }
  if (createdBefore && Number.isNaN(Date.parse(createdBefore))) {
    return respondV1(context, ROUTE, 'GET', 422,
      problemJson(422, 'Unprocessable Entity', 'created_before must be a valid ISO 8601 timestamp'), t0, true)
  }

  let limit: number | undefined
  if (limitRaw !== null) {
    limit = parseInt(limitRaw, 10)
    if (!Number.isFinite(limit) || limit < 1 || limit > 200) {
      return respondV1(context, ROUTE, 'GET', 422,
        problemJson(422, 'Unprocessable Entity', 'limit must be an integer between 1 and 200'), t0, true)
    }
  }

  const result = await listAuditLog({
    keyId: context.key_id,
    orgId: context.org_id!,
    eventType,
    entityType,
    createdAfter,
    createdBefore,
    cursor,
    limit,
  })

  if (!result.ok) {
    switch (result.error.kind) {
      case 'api_key_binding':
        return respondV1(context, ROUTE, 'GET', 403,
          problemJson(403, 'Forbidden', 'API key does not authorise access to this organisation'), t0, true)
      case 'bad_cursor':
        return respondV1(context, ROUTE, 'GET', 422,
          problemJson(422, 'Unprocessable Entity', 'cursor is malformed'), t0, true)
      default:
        return respondV1(context, ROUTE, 'GET', 500,
          problemJson(500, 'Internal Server Error', 'Audit listing failed'), t0, true)
    }
  }

  return respondV1(context, ROUTE, 'GET', 200, result.data, t0)
}
