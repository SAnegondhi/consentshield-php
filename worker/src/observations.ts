import type { Env } from './index'
import { sha256 } from './hmac'

interface ObservationPayload {
  org_id: string
  property_id: string
  session_fingerprint?: string
  consent_state: Record<string, boolean>
  trackers_detected: unknown[]
  violations?: unknown[]
  page_url?: string
  signature?: string
  timestamp?: string
}

const CORS_HEADERS = { 'Access-Control-Allow-Origin': '*' }

export async function handleObservation(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
): Promise<Response> {
  let body: ObservationPayload

  try {
    body = (await request.json()) as ObservationPayload
  } catch {
    return new Response('Invalid JSON', { status: 400, headers: CORS_HEADERS })
  }

  if (!body.org_id || !body.property_id || !body.consent_state || !body.trackers_detected) {
    return new Response(
      'Missing required fields: org_id, property_id, consent_state, trackers_detected',
      { status: 400, headers: CORS_HEADERS },
    )
  }

  // TODO (ADR-0002+): HMAC verification against per-property signing secret
  // TODO (ADR-0002+): Origin validation against allowed_origins

  const pageUrlHash = body.page_url ? await sha256(body.page_url) : null

  const observation = {
    org_id: body.org_id,
    property_id: body.property_id,
    session_fingerprint: body.session_fingerprint ?? 'unknown',
    consent_state: body.consent_state,
    trackers_detected: body.trackers_detected,
    violations: body.violations ?? [],
    page_url_hash: pageUrlHash,
  }

  const bufferRes = await fetch(`${env.SUPABASE_URL}/rest/v1/tracker_observations`, {
    method: 'POST',
    headers: {
      apikey: env.SUPABASE_WORKER_KEY,
      Authorization: `Bearer ${env.SUPABASE_WORKER_KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'return=minimal',
    },
    body: JSON.stringify(observation),
  })

  if (!bufferRes.ok) {
    console.error('Observation write failed:', await bufferRes.text())
  }

  return new Response(null, { status: 202, headers: CORS_HEADERS })
}
