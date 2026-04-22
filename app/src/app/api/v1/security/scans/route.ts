import { NextRequest } from 'next/server'
import { problemJson } from '@/lib/api/auth'
import {
  readContext,
  respondV1,
  gateScopeOrProblem,
  requireOrgOrProblem,
} from '@/lib/api/v1-helpers'
import { listSecurityScans, type SecuritySeverity } from '@/lib/api/security'

// ADR-1016 Sprint 1.2 — GET /v1/security/scans
//
// Keyset-paginated view of security_scans for the caller's org. Serves
// recent entries only — the table is a buffer that gets delivered to
// customer R2/S3 and trimmed within ~5 minutes. Populated nightly by the
// run-security-scans Edge Function (ADR-0015).
//
// Scope: read:security. Account-scoped keys → 400.

const ROUTE = '/api/v1/security/scans'
const VALID_SEVERITY: SecuritySeverity[] = ['critical', 'high', 'medium', 'low', 'info']

export async function GET(request: NextRequest) {
  const { context, t0 } = await readContext()

  const scopeGate = gateScopeOrProblem(context, 'read:security')
  if (scopeGate) return respondV1(context, ROUTE, 'GET', scopeGate.status, scopeGate.body, t0, true)

  const orgGate = requireOrgOrProblem(context, ROUTE)
  if (orgGate) return respondV1(context, ROUTE, 'GET', orgGate.status, orgGate.body, t0, true)

  const url = new URL(request.url)
  const propertyId    = url.searchParams.get('property_id')    ?? undefined
  const severity      = url.searchParams.get('severity')       ?? undefined
  const signalKey     = url.searchParams.get('signal_key')     ?? undefined
  const scannedAfter  = url.searchParams.get('scanned_after')  ?? undefined
  const scannedBefore = url.searchParams.get('scanned_before') ?? undefined
  const cursor        = url.searchParams.get('cursor')         ?? undefined
  const limitRaw      = url.searchParams.get('limit')

  if (severity && !VALID_SEVERITY.includes(severity as SecuritySeverity)) {
    return respondV1(context, ROUTE, 'GET', 422,
      problemJson(422, 'Unprocessable Entity', `severity must be one of: ${VALID_SEVERITY.join(', ')}`), t0, true)
  }
  if (scannedAfter && Number.isNaN(Date.parse(scannedAfter))) {
    return respondV1(context, ROUTE, 'GET', 422,
      problemJson(422, 'Unprocessable Entity', 'scanned_after must be a valid ISO 8601 timestamp'), t0, true)
  }
  if (scannedBefore && Number.isNaN(Date.parse(scannedBefore))) {
    return respondV1(context, ROUTE, 'GET', 422,
      problemJson(422, 'Unprocessable Entity', 'scanned_before must be a valid ISO 8601 timestamp'), t0, true)
  }

  let limit: number | undefined
  if (limitRaw !== null) {
    limit = parseInt(limitRaw, 10)
    if (!Number.isFinite(limit) || limit < 1 || limit > 200) {
      return respondV1(context, ROUTE, 'GET', 422,
        problemJson(422, 'Unprocessable Entity', 'limit must be an integer between 1 and 200'), t0, true)
    }
  }

  const result = await listSecurityScans({
    keyId:     context.key_id,
    orgId:     context.org_id!,
    propertyId,
    severity:  severity as SecuritySeverity | undefined,
    signalKey,
    scannedAfter,
    scannedBefore,
    cursor,
    limit,
  })

  if (!result.ok) {
    switch (result.error.kind) {
      case 'api_key_binding':
        return respondV1(context, ROUTE, 'GET', 403,
          problemJson(403, 'Forbidden', 'API key does not authorise access to this organisation'), t0, true)
      case 'invalid_severity':
        return respondV1(context, ROUTE, 'GET', 422,
          problemJson(422, 'Unprocessable Entity', `severity must be one of: ${VALID_SEVERITY.join(', ')}`), t0, true)
      case 'bad_cursor':
        return respondV1(context, ROUTE, 'GET', 422,
          problemJson(422, 'Unprocessable Entity', 'cursor is malformed'), t0, true)
      default:
        return respondV1(context, ROUTE, 'GET', 500,
          problemJson(500, 'Internal Server Error', 'Security-scans listing failed'), t0, true)
    }
  }

  return respondV1(context, ROUTE, 'GET', 200, result.data, t0)
}
