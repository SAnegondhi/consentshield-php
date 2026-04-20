// ADR-1002 Sprint 1.2 — server-side helper for /v1/consent/verify.
// Thin wrapper over rpc_consent_verify. Uses the service-role client (same
// carve-out as verifyBearerToken + logApiRequest): the /v1/* middleware path
// has no user JWT, only an API key context, so it must reach the DB via the
// service role to call a SECURITY DEFINER RPC.

import { createClient } from '@supabase/supabase-js'

export type VerifyStatus = 'granted' | 'revoked' | 'expired' | 'never_consented'

export interface VerifyEnvelope {
  property_id: string
  identifier_type: string
  purpose_code: string
  status: VerifyStatus
  active_artefact_id: string | null
  revoked_at: string | null
  revocation_record_id: string | null
  expires_at: string | null
  evaluated_at: string
}

export type VerifyError =
  | { kind: 'property_not_found' }
  | { kind: 'invalid_identifier'; detail: string }
  | { kind: 'unknown'; detail: string }

export async function verifyConsent(params: {
  orgId: string
  propertyId: string
  identifier: string
  identifierType: string
  purposeCode: string
}): Promise<{ ok: true; data: VerifyEnvelope } | { ok: false; error: VerifyError }> {
  const client = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  )

  const { data, error } = await client.rpc('rpc_consent_verify', {
    p_org_id:          params.orgId,
    p_property_id:     params.propertyId,
    p_identifier:      params.identifier,
    p_identifier_type: params.identifierType,
    p_purpose_code:    params.purposeCode,
  })

  if (error) {
    const msg = error.message ?? ''
    if (msg.includes('property_not_found')) {
      return { ok: false, error: { kind: 'property_not_found' } }
    }
    if (error.code === '22023' || msg.includes('identifier') || msg.includes('unknown identifier_type')) {
      return { ok: false, error: { kind: 'invalid_identifier', detail: msg } }
    }
    return { ok: false, error: { kind: 'unknown', detail: msg } }
  }

  return { ok: true, data: data as VerifyEnvelope }
}
