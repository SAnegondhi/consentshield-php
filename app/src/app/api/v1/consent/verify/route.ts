import { headers } from 'next/headers'
import { NextRequest, NextResponse } from 'next/server'
import { API_HDR } from '@/lib/api/context'
import { problemJson } from '@/lib/api/auth'
import { logApiRequest } from '@/lib/api/log-request'
import { verifyConsent } from '@/lib/consent/verify'
import type { ApiKeyContext } from '@/lib/api/auth'

// ADR-1002 Sprint 1.2 — GET /v1/consent/verify
//
// Query params (all required): property_id, data_principal_identifier,
// identifier_type, purpose_code. Scope required: read:consent.
//
// Responses:
//   200 — §5.1 envelope (granted | revoked | expired | never_consented)
//   403 — missing scope
//   404 — property_id does not belong to the key's org
//   422 — missing param / invalid identifier / unknown identifier_type
//   500 — unexpected DB error

const PROBLEM = { 'Content-Type': 'application/problem+json' }
const ROUTE = '/api/v1/consent/verify'

function respond(
  context: ApiKeyContext,
  status: number,
  body: unknown,
  t0: number,
  isProblem = false,
): NextResponse {
  const latency = t0 ? Date.now() - t0 : 0
  logApiRequest(context, ROUTE, 'GET', status, latency)
  return NextResponse.json(body, {
    status,
    headers: isProblem ? PROBLEM : {},
  })
}

export async function GET(request: NextRequest) {
  const hdrs = await headers()
  const t0 = parseInt(hdrs.get(API_HDR.requestStart) ?? '0', 10)

  const context: ApiKeyContext = {
    key_id:     hdrs.get(API_HDR.keyId) ?? '',
    account_id: hdrs.get(API_HDR.accountId) ?? '',
    org_id:     hdrs.get(API_HDR.orgId) || null,
    scopes:     (hdrs.get(API_HDR.scopes) ?? '').split(',').filter(Boolean),
    rate_tier:  hdrs.get(API_HDR.rateTier) ?? '',
  }

  // Scope gate
  if (!context.scopes.includes('read:consent')) {
    return respond(
      context,
      403,
      problemJson(403, 'Forbidden', 'This key does not have the required scope: read:consent'),
      t0,
      true,
    )
  }

  // Query param validation
  const url = new URL(request.url)
  const property_id     = url.searchParams.get('property_id')
  const identifier      = url.searchParams.get('data_principal_identifier')
  const identifier_type = url.searchParams.get('identifier_type')
  const purpose_code    = url.searchParams.get('purpose_code')

  const missing = [
    ['property_id', property_id],
    ['data_principal_identifier', identifier],
    ['identifier_type', identifier_type],
    ['purpose_code', purpose_code],
  ]
    .filter(([, v]) => !v)
    .map(([k]) => k)

  if (missing.length > 0) {
    return respond(
      context,
      422,
      problemJson(422, 'Unprocessable Entity', `Missing required query params: ${missing.join(', ')}`),
      t0,
      true,
    )
  }

  // Verify org is bound on the key (account-scoped keys can't resolve
  // property ownership — they need the org).
  if (!context.org_id) {
    return respond(
      context,
      400,
      problemJson(
        400,
        'Bad Request',
        'API key is account-scoped — /v1/consent/verify requires an org-scoped key',
      ),
      t0,
      true,
    )
  }

  const result = await verifyConsent({
    orgId:          context.org_id,
    propertyId:     property_id!,
    identifier:     identifier!,
    identifierType: identifier_type!,
    purposeCode:    purpose_code!,
  })

  if (!result.ok) {
    if (result.error.kind === 'property_not_found') {
      return respond(
        context,
        404,
        problemJson(404, 'Not Found', 'property_id does not belong to your org'),
        t0,
        true,
      )
    }
    if (result.error.kind === 'invalid_identifier') {
      return respond(
        context,
        422,
        problemJson(422, 'Unprocessable Entity', result.error.detail),
        t0,
        true,
      )
    }
    return respond(
      context,
      500,
      problemJson(500, 'Internal Server Error', 'Verification failed'),
      t0,
      true,
    )
  }

  return respond(context, 200, result.data, t0)
}
