// Supabase Edge Function: process-consent-event
// ADR-0021 — DEPA artefact fan-out on every consent_events INSERT.
//
// Primary path: called by the AFTER INSERT trigger
//   trg_consent_event_artefact_dispatch on consent_events.
// Safety-net path: called by safety_net_process_consent_events()
//   pg_cron every 5 minutes for events with empty artefact_ids.
//
// Idempotency (§11.12 guard S-7) is enforced at three layers:
//   1. UNIQUE (consent_event_id, purpose_code) on consent_artefacts.
//   2. ON CONFLICT DO NOTHING on every INSERT here.
//   3. Fast-path skip when consent_events.artefact_ids is non-empty.
//
// Runs as cs_orchestrator. NEVER use SUPABASE_SERVICE_ROLE_KEY (Rule 5).

import { createClient, SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const ORCHESTRATOR_KEY = Deno.env.get('CS_ORCHESTRATOR_ROLE_KEY')
if (!ORCHESTRATOR_KEY) {
  throw new Error(
    'CS_ORCHESTRATOR_ROLE_KEY is required. Set it via `supabase secrets set CS_ORCHESTRATOR_ROLE_KEY=<value>`.',
  )
}

interface DispatchRequest {
  consent_event_id?: string
}

interface ConsentEvent {
  id: string
  org_id: string
  property_id: string
  banner_id: string
  banner_version: number
  session_fingerprint: string
  purposes_accepted: string[] | null
  artefact_ids: string[] | null
}

interface BannerPurpose {
  id: string
  purpose_definition_id?: string
  // Additional fields like name, description, required — ignored here.
}

interface PurposeDefinition {
  id: string
  purpose_code: string
  data_scope: string[]
  default_expiry_days: number
  framework: string
}

interface DispatchResult {
  event_id: string
  created: number
  skipped: boolean
  reason?: string
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') {
    return jsonResponse({ error: 'method_not_allowed' }, 405)
  }

  let body: DispatchRequest
  try {
    body = await req.json()
  } catch {
    return jsonResponse({ error: 'invalid_json' }, 400)
  }

  const consentEventId = body.consent_event_id
  if (!consentEventId) {
    return jsonResponse({ error: 'missing_consent_event_id' }, 400)
  }

  const supabase = createClient(SUPABASE_URL, ORCHESTRATOR_KEY)

  try {
    const result = await processEvent(supabase, consentEventId)
    return jsonResponse(result, 200)
  } catch (error) {
    console.error('[process-consent-event] failed', {
      consent_event_id: consentEventId,
      error: error instanceof Error ? error.message : String(error),
    })
    return jsonResponse(
      {
        event_id: consentEventId,
        error: 'processing_failed',
        message: error instanceof Error ? error.message : 'unknown',
      },
      500,
    )
  }
})

async function processEvent(
  supabase: SupabaseClient,
  consentEventId: string,
): Promise<DispatchResult> {
  // Step 1 — fetch the consent_events row.
  const { data: event, error: eventErr } = await supabase
    .from('consent_events')
    .select(
      'id, org_id, property_id, banner_id, banner_version, session_fingerprint, purposes_accepted, artefact_ids',
    )
    .eq('id', consentEventId)
    .maybeSingle()

  if (eventErr) throw new Error(`consent_events lookup: ${eventErr.message}`)
  if (!event) return { event_id: consentEventId, created: 0, skipped: true, reason: 'event_not_found' }

  const typedEvent = event as ConsentEvent

  // Step 2 — fast-path: already processed.
  if (typedEvent.artefact_ids && typedEvent.artefact_ids.length > 0) {
    return { event_id: consentEventId, created: 0, skipped: true, reason: 'already_processed' }
  }

  // Step 3 — fetch the banner's purpose list.
  const { data: banner, error: bannerErr } = await supabase
    .from('consent_banners')
    .select('purposes')
    .eq('id', typedEvent.banner_id)
    .maybeSingle()

  if (bannerErr) throw new Error(`consent_banners lookup: ${bannerErr.message}`)
  if (!banner) return { event_id: consentEventId, created: 0, skipped: true, reason: 'banner_not_found' }

  const bannerPurposes = ((banner as { purposes: BannerPurpose[] | null }).purposes ?? []) as BannerPurpose[]
  const accepted = typedEvent.purposes_accepted ?? []
  if (accepted.length === 0) {
    return { event_id: consentEventId, created: 0, skipped: true, reason: 'no_accepted_purposes' }
  }

  // Step 4 — for each accepted purpose_id, find the banner entry,
  // look up the purpose_definition, and insert an artefact.
  const artefactIds: string[] = []
  let created = 0

  for (const acceptedPurposeId of accepted) {
    const bannerEntry = bannerPurposes.find((p) => p.id === acceptedPurposeId)
    if (!bannerEntry) {
      console.warn('[process-consent-event] accepted purpose not found in banner', {
        consent_event_id: consentEventId,
        accepted_purpose_id: acceptedPurposeId,
      })
      continue
    }
    if (!bannerEntry.purpose_definition_id) {
      // Legacy banner — pre-DEPA. ADR-0024 enforces 422 at save time so
      // this path will eventually vanish; for now we skip + log.
      console.warn('[process-consent-event] banner purpose missing purpose_definition_id', {
        consent_event_id: consentEventId,
        accepted_purpose_id: acceptedPurposeId,
      })
      continue
    }

    const { data: pd, error: pdErr } = await supabase
      .from('purpose_definitions')
      .select('id, purpose_code, data_scope, default_expiry_days, framework')
      .eq('id', bannerEntry.purpose_definition_id)
      .maybeSingle()

    if (pdErr) throw new Error(`purpose_definitions lookup: ${pdErr.message}`)
    if (!pd) {
      console.warn('[process-consent-event] purpose_definition not found', {
        purpose_definition_id: bannerEntry.purpose_definition_id,
      })
      continue
    }

    const typedPd = pd as PurposeDefinition

    const expiresAt =
      typedPd.default_expiry_days === 0
        ? 'infinity'
        : new Date(Date.now() + typedPd.default_expiry_days * 86_400_000).toISOString()

    // Insert consent_artefacts; UNIQUE (consent_event_id, purpose_code)
    // guarantees no duplicates across concurrent trigger + cron races.
    const { data: art, error: artErr } = await supabase
      .from('consent_artefacts')
      .insert({
        org_id: typedEvent.org_id,
        property_id: typedEvent.property_id,
        banner_id: typedEvent.banner_id,
        banner_version: typedEvent.banner_version,
        consent_event_id: typedEvent.id,
        session_fingerprint: typedEvent.session_fingerprint,
        purpose_definition_id: typedPd.id,
        purpose_code: typedPd.purpose_code,
        data_scope: typedPd.data_scope,
        framework: typedPd.framework,
        expires_at: expiresAt,
      })
      .select('artefact_id')
      .maybeSingle()

    if (artErr) {
      // Unique violation → a sibling invocation already created it. Fetch
      // the existing row so we can populate artefact_ids coherently.
      if (artErr.code === '23505') {
        const { data: existing } = await supabase
          .from('consent_artefacts')
          .select('artefact_id')
          .eq('consent_event_id', typedEvent.id)
          .eq('purpose_code', typedPd.purpose_code)
          .maybeSingle()
        if (existing) {
          artefactIds.push((existing as { artefact_id: string }).artefact_id)
        }
        continue
      }
      throw new Error(`consent_artefacts insert: ${artErr.message}`)
    }

    if (art) {
      const artefactId = (art as { artefact_id: string }).artefact_id
      artefactIds.push(artefactId)
      created++

      // Populate the validity cache. ON CONFLICT protects against
      // concurrent inserts (the unique is (org_id, artefact_id)).
      // ADR-1002 Sprint 1.1 — also stamp property_id and consent_event_id
      // so /v1/consent/verify can resolve artefacts by property. Mode B's
      // identifier_hash + identifier_type are populated by the record
      // endpoint (Sprint 2.1), not here — web-channel consent is anonymous.
      await supabase.from('consent_artefact_index').insert({
        org_id: typedEvent.org_id,
        property_id: typedEvent.property_id,
        artefact_id: artefactId,
        consent_event_id: typedEvent.id,
        validity_state: 'active',
        expires_at: expiresAt === 'infinity' ? null : expiresAt,
        framework: typedPd.framework,
        purpose_code: typedPd.purpose_code,
      })
    }
  }

  // Step 5 — populate consent_events.artefact_ids. Guarded with the
  // empty-array filter so a sibling invocation's write isn't clobbered.
  if (artefactIds.length > 0) {
    await supabase
      .from('consent_events')
      .update({ artefact_ids: artefactIds })
      .eq('id', typedEvent.id)
      .eq('artefact_ids', '{}')
  }

  return {
    event_id: consentEventId,
    created,
    skipped: created === 0,
  }
}

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}
