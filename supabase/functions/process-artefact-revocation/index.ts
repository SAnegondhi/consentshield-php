// Supabase Edge Function: process-artefact-revocation
// ADR-0022 — DEPA out-of-database revocation cascade. Fans out a
// revocation to deletion_receipts rows, one per active connector mapped
// to the artefact's purpose_definition.
//
// ADR-1004 Sprint 1.4 — consults applicable_exemptions(org_id,
// purpose_code) before creating receipts. Categories covered by an
// active regulatory exemption (e.g. RBI KYC 10-year retention, CICRA
// 7-year credit data) are stripped from every receipt's data_scope and
// logged in a retention_suppressions audit row per (revocation,
// exemption). If after subtraction a mapping has zero categories left,
// no receipt is created for that connector — the suppression row alone
// satisfies the audit trail.
//
// Primary path: called by the AFTER INSERT trigger
//   trg_artefact_revocation_dispatch on artefact_revocations (fires
//   AFTER trg_artefact_revocation cascade so the in-DB state is
//   already consistent — status='revoked', index entry removed,
//   audit_log row written).
// Safety-net path: called by safety_net_process_artefact_revocations()
//   pg_cron every 5 minutes for revocations with dispatched_at IS NULL.
//
// Idempotency enforced at four layers (mirrors ADR-0021):
//   1. UNIQUE (trigger_id, connector_id) WHERE trigger_type =
//      'consent_revoked' on deletion_receipts.
//   2. UNIQUE (revocation_id, exemption_id) WHERE revocation_id IS NOT
//      NULL on retention_suppressions (ADR-1004 Sprint 1.4).
//   3. ON CONFLICT detection on insert (code '23505' → already dispatched
//      by a sibling invocation; continue).
//   4. Fast-path skip when artefact_revocations.dispatched_at is non-null.
//
// Scope note (per ADR-0022): this function only *creates* pending
// deletion_receipts rows. The actual connector call (webhook / Mailchimp
// API / HubSpot API) is the existing rights-dispatcher path's
// responsibility; ADR-0023 will unify the two call sites. Until then,
// revocation-triggered receipts sit in status='pending' until manually
// or programmatically dispatched.
//
// Runs as cs_orchestrator. NEVER use SUPABASE_SERVICE_ROLE_KEY (Rule 5).

import { createClient, SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4'
import { createHash } from 'node:crypto'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const ORCHESTRATOR_KEY = Deno.env.get('CS_ORCHESTRATOR_ROLE_KEY')
if (!ORCHESTRATOR_KEY) {
  throw new Error(
    'CS_ORCHESTRATOR_ROLE_KEY is required. Set it via `supabase secrets set CS_ORCHESTRATOR_ROLE_KEY=<value>`.',
  )
}

interface DispatchRequest {
  artefact_id?: string
  revocation_id?: string
}

interface Artefact {
  id: string
  artefact_id: string
  org_id: string
  purpose_code: string
  purpose_definition_id: string
  data_scope: string[] | null
  session_fingerprint: string
  status: string
  replaced_by: string | null
}

interface Exemption {
  id: string
  statute: string
  statute_code: string
  data_categories: string[] | null
  source_citation: string | null
}

interface Revocation {
  id: string
  reason: string
  dispatched_at: string | null
}

interface ConnectorMapping {
  connector_id: string
  data_categories: string[] | null
}

interface Connector {
  id: string
  connector_type: string
  display_name: string
  status: string
}

interface DispatchResult {
  revocation_id: string
  artefact_id: string
  dispatched: number
  skipped: number
  suppressed: number
  retained_categories?: string[]
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

  const artefactId = body.artefact_id
  const revocationId = body.revocation_id
  if (!artefactId || !revocationId) {
    return jsonResponse({ error: 'missing_artefact_id_or_revocation_id' }, 400)
  }

  const supabase = createClient(SUPABASE_URL, ORCHESTRATOR_KEY)

  try {
    const result = await processRevocation(supabase, artefactId, revocationId)
    return jsonResponse(result, 200)
  } catch (error) {
    console.error('[process-artefact-revocation] failed', {
      artefact_id: artefactId,
      revocation_id: revocationId,
      error: error instanceof Error ? error.message : String(error),
    })
    return jsonResponse(
      {
        revocation_id: revocationId,
        artefact_id: artefactId,
        error: 'processing_failed',
        message: error instanceof Error ? error.message : 'unknown',
      },
      500,
    )
  }
})

async function processRevocation(
  supabase: SupabaseClient,
  artefactId: string,
  revocationId: string,
): Promise<DispatchResult> {
  // Step 1 — fetch the revocation row; fast-path if dispatched_at is set.
  const { data: rev, error: revErr } = await supabase
    .from('artefact_revocations')
    .select('id, reason, dispatched_at')
    .eq('id', revocationId)
    .maybeSingle()

  if (revErr) throw new Error(`artefact_revocations lookup: ${revErr.message}`)
  if (!rev) {
    return {
      revocation_id: revocationId,
      artefact_id: artefactId,
      dispatched: 0,
      skipped: 0,
      suppressed: 0,
      reason: 'revocation_not_found',
    }
  }
  const typedRev = rev as Revocation
  if (typedRev.dispatched_at) {
    return {
      revocation_id: revocationId,
      artefact_id: artefactId,
      dispatched: 0,
      skipped: 0,
      suppressed: 0,
      reason: 'already_dispatched',
    }
  }

  // Step 2 — fetch the artefact (the cascade trigger already flipped
  // status to 'revoked'; if it's still 'active' something is ordering
  // wrong and we refuse to dispatch).
  const { data: art, error: artErr } = await supabase
    .from('consent_artefacts')
    .select(
      'id, artefact_id, org_id, purpose_code, purpose_definition_id, data_scope, session_fingerprint, status, replaced_by',
    )
    .eq('artefact_id', artefactId)
    .maybeSingle()

  if (artErr) throw new Error(`consent_artefacts lookup: ${artErr.message}`)
  if (!art) {
    return {
      revocation_id: revocationId,
      artefact_id: artefactId,
      dispatched: 0,
      skipped: 0,
      suppressed: 0,
      reason: 'artefact_not_found',
    }
  }
  const typedArt = art as Artefact

  if (typedArt.status !== 'revoked') {
    console.warn('[process-artefact-revocation] artefact not in revoked state', {
      artefact_id: artefactId,
      status: typedArt.status,
    })
    return {
      revocation_id: revocationId,
      artefact_id: artefactId,
      dispatched: 0,
      skipped: 0,
      suppressed: 0,
      reason: `artefact_not_revoked_status_${typedArt.status}`,
    }
  }

  const artefactScope = typedArt.data_scope ?? []
  if (artefactScope.length === 0) {
    // No data_scope → nothing to delete anywhere. Mark dispatched and exit.
    await markDispatched(supabase, revocationId)
    return {
      revocation_id: revocationId,
      artefact_id: artefactId,
      dispatched: 0,
      skipped: 0,
      suppressed: 0,
      reason: 'empty_data_scope',
    }
  }

  // Step 2a — ADR-1004 Sprint 1.4: consult regulatory exemptions engine.
  // applicable_exemptions returns platform defaults + per-org overrides
  // applicable to this (org, purpose) tuple, ordered by precedence.
  const { data: exemptionRows, error: exErr } = await supabase.rpc(
    'applicable_exemptions',
    { p_org_id: typedArt.org_id, p_purpose_code: typedArt.purpose_code },
  )
  if (exErr) throw new Error(`applicable_exemptions lookup: ${exErr.message}`)

  const exemptions = (exemptionRows ?? []) as Exemption[]

  // Compute the union of exemption categories intersected with this
  // artefact's data_scope. This is the set of categories that MUST be
  // retained and stripped from every deletion_receipts row.
  const retainedByExemption = new Map<string, string[]>()
  const retainedUnion = new Set<string>()
  for (const ex of exemptions) {
    const covers = (ex.data_categories ?? []).filter((c) => artefactScope.includes(c))
    if (covers.length > 0) {
      retainedByExemption.set(ex.id, covers)
      for (const c of covers) retainedUnion.add(c)
    }
  }

  // Write one retention_suppressions row per exemption that actually
  // applied. Idempotent on (revocation_id, exemption_id).
  let suppressed = 0
  for (const ex of exemptions) {
    const covers = retainedByExemption.get(ex.id)
    if (!covers) continue

    const { error: suppErr } = await supabase
      .from('retention_suppressions')
      .insert({
        org_id: typedArt.org_id,
        artefact_id: typedArt.artefact_id,
        artefact_uuid: typedArt.id,
        revocation_id: typedRev.id,
        exemption_id: ex.id,
        suppressed_data_categories: covers,
        statute: ex.statute,
        statute_code: ex.statute_code,
        source_citation: ex.source_citation,
      })

    if (suppErr) {
      // 23505 → already recorded by a sibling invocation.
      if (suppErr.code === '23505') continue
      throw new Error(`retention_suppressions insert: ${suppErr.message}`)
    }
    suppressed++
  }

  // Step 3 — fetch the purpose_connector_mappings for this artefact's purpose.
  const { data: mappings, error: mapErr } = await supabase
    .from('purpose_connector_mappings')
    .select('connector_id, data_categories')
    .eq('purpose_definition_id', typedArt.purpose_definition_id)
    .eq('org_id', typedArt.org_id)

  if (mapErr) throw new Error(`purpose_connector_mappings lookup: ${mapErr.message}`)

  const mappingRows = (mappings ?? []) as ConnectorMapping[]
  if (mappingRows.length === 0) {
    await markDispatched(supabase, revocationId)
    return {
      revocation_id: revocationId,
      artefact_id: artefactId,
      dispatched: 0,
      skipped: 0,
      suppressed,
      retained_categories: Array.from(retainedUnion),
      reason: 'no_connector_mappings',
    }
  }

  // Step 4 — fetch the active connectors we care about (for target_system
  // population). Only active connectors get receipts; inactive mappings are
  // silently skipped.
  const connectorIds = Array.from(new Set(mappingRows.map((m) => m.connector_id)))
  const { data: connectors, error: connErr } = await supabase
    .from('integration_connectors')
    .select('id, connector_type, display_name, status')
    .in('id', connectorIds)

  if (connErr) throw new Error(`integration_connectors lookup: ${connErr.message}`)
  const connectorsById = new Map<string, Connector>(
    ((connectors ?? []) as Connector[]).map((c) => [c.id, c]),
  )

  // Step 5 — for each mapping, compute scoped_fields and insert one
  // pending deletion_receipts row. identifier_hash is derived from the
  // artefact's session_fingerprint (the revocation did not carry a new
  // identifier; the fingerprint is the anchor).
  const identifierHash = createHash('sha256').update(typedArt.session_fingerprint).digest('hex')

  let dispatched = 0
  let skipped = 0

  for (const mapping of mappingRows) {
    const connector = connectorsById.get(mapping.connector_id)
    if (!connector || connector.status !== 'active') {
      skipped++
      continue
    }

    const mappingCategories = mapping.data_categories ?? []
    const scopedFields = mappingCategories.filter((c) => artefactScope.includes(c))

    // ADR-1004 Sprint 1.4: subtract categories retained by any applicable
    // exemption. If nothing is left, this connector's deletion is fully
    // suppressed — retention_suppressions already captured it above.
    const remainingScope = scopedFields.filter((c) => !retainedUnion.has(c))

    if (remainingScope.length === 0) {
      skipped++
      continue
    }

    const { error: insErr } = await supabase
      .from('deletion_receipts')
      .insert({
        org_id: typedArt.org_id,
        trigger_type: 'consent_revoked',
        trigger_id: typedRev.id,
        connector_id: connector.id,
        target_system: connector.display_name,
        identifier_hash: identifierHash,
        artefact_id: typedArt.artefact_id,
        status: 'pending',
        request_payload: {
          artefact_id: typedArt.artefact_id,
          data_scope: remainingScope,
          reason: 'consent_revoked',
          revocation_reason: typedRev.reason,
          retained_data_categories: scopedFields
            .filter((c) => retainedUnion.has(c)),
        },
      })

    if (insErr) {
      // 23505 → the UNIQUE (trigger_id, connector_id) WHERE trigger_type =
      // 'consent_revoked' partial index fired. A sibling invocation already
      // wrote this receipt. Count as skipped, not a failure.
      if (insErr.code === '23505') {
        skipped++
        continue
      }
      throw new Error(`deletion_receipts insert: ${insErr.message}`)
    }
    dispatched++
  }

  // Step 6 — mark the revocation as dispatched. Guarded update prevents
  // a later invocation from resetting dispatched_at.
  await markDispatched(supabase, revocationId)

  return {
    revocation_id: revocationId,
    artefact_id: artefactId,
    dispatched,
    skipped,
    suppressed,
    retained_categories: Array.from(retainedUnion),
  }
}

async function markDispatched(supabase: SupabaseClient, revocationId: string): Promise<void> {
  await supabase
    .from('artefact_revocations')
    .update({ dispatched_at: new Date().toISOString() })
    .eq('id', revocationId)
    .is('dispatched_at', null)
}

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}
