// ADR-1006 Phase 1 Sprint 1.4 — Next.js App Router API route example.
//
// Records a fresh consent event from a mobile-app POST. Trace id from
// the inbound `X-CS-Trace-Id` header round-trips into the SDK call so
// the resulting consent_events row + R2 delivery + downstream pipeline
// all carry the same correlation id (per ADR-1014 Sprint 3.2).
//
// Body shape (mirror of POST /v1/consent/record):
//
//   {
//     "propertyId": "PROP_UUID",
//     "dataPrincipalIdentifier": "user@example.com",
//     "identifierType": "email",
//     "purposeDefinitionIds": ["pd-marketing", "pd-analytics"],
//     "rejectedPurposeDefinitionIds": ["pd-thirdparty"],
//     "capturedAt": "2026-04-25T10:00:00Z",
//     "clientRequestId": "mob-app-uuid-1234"
//   }

import { NextRequest, NextResponse } from 'next/server'
import {
  ConsentShieldApiError,
  ConsentShieldClient,
} from '@consentshield/node'

const apiKey = process.env.CS_API_KEY
if (!apiKey) {
  // Throw at module-load time so misconfiguration surfaces on `next
  // build` / first cold start, not inside a request.
  throw new Error('CS_API_KEY env var is required')
}

const client = new ConsentShieldClient({ apiKey })

interface InboundBody {
  propertyId?: string
  dataPrincipalIdentifier?: string
  identifierType?: string
  purposeDefinitionIds?: string[]
  rejectedPurposeDefinitionIds?: string[]
  capturedAt?: string
  clientRequestId?: string
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const traceId = request.headers.get('x-cs-trace-id') ?? undefined

  let body: InboundBody
  try {
    body = (await request.json()) as InboundBody
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 422 })
  }

  if (!body.propertyId || !body.dataPrincipalIdentifier || !body.identifierType ||
      !body.purposeDefinitionIds || !body.capturedAt) {
    return NextResponse.json({ error: 'missing_required_fields' }, { status: 422 })
  }

  try {
    const envelope = await client.recordConsent({
      propertyId: body.propertyId,
      dataPrincipalIdentifier: body.dataPrincipalIdentifier,
      identifierType: body.identifierType,
      purposeDefinitionIds: body.purposeDefinitionIds,
      rejectedPurposeDefinitionIds: body.rejectedPurposeDefinitionIds,
      capturedAt: body.capturedAt,
      clientRequestId: body.clientRequestId,
      traceId,
    })

    const headers: Record<string, string> = {}
    if (traceId) headers['X-CS-Trace-Id'] = traceId

    return NextResponse.json(envelope, { status: 201, headers })
  } catch (err) {
    if (err instanceof ConsentShieldApiError) {
      return NextResponse.json(
        { error: 'consent_record_failed', status: err.status, problem: err.problem, traceId: err.traceId },
        { status: err.status, headers: err.traceId ? { 'X-CS-Trace-Id': err.traceId } : undefined },
      )
    }
    if (err instanceof TypeError || err instanceof RangeError) {
      // SDK synchronous validation gates (empty purposeDefinitionIds,
      // non-string entries, etc.) — surface as 422.
      return NextResponse.json({ error: 'validation_failed', detail: err.message }, { status: 422 })
    }
    // Network / timeout / unexpected — 502.
    return NextResponse.json({ error: 'consent_record_unavailable' }, { status: 502 })
  }
}
