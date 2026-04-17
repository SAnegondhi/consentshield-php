// ADR-0023 Sprint 1.2 — expiry pipeline integration tests.
//
// Priority 10 §6 from consentshield-testing-strategy.md:
//   - Test 10.6:  enforce_artefact_expiry (time-travel) — flips status,
//                 removes index entry, audit-logs, stages R2 delivery_buffer
//                 row only when auto_delete_on_expiry=true.
//   - Test 10.6b: send_expiry_alerts — stages an alert delivery_buffer row
//                 when notify_at has lapsed; dedupes via notified_at.
//
// Both tests hit the live hosted dev Supabase and call the helpers directly
// via rpc(). Time-travel is achieved by UPDATE-ing expires_at / notify_at
// on already-created rows (the ADR-0021 pipeline creates them with future
// timestamps via purpose_definitions.default_expiry_days).

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import {
  createTestOrg,
  cleanupTestOrg,
  getServiceClient,
  TestOrg,
} from '../rls/helpers'

const POLL_TIMEOUT_MS = 15_000
const POLL_INTERVAL_MS = 500

interface Fixtures {
  marketingPurposeId: string  // auto_delete_on_expiry = true
  analyticsPurposeId: string  // auto_delete_on_expiry = false
  propertyId: string
  bannerId: string
}

let org: TestOrg
let f: Fixtures

beforeAll(async () => {
  org = await createTestOrg('expiry-pipeline')
  const admin = getServiceClient()

  const seedPurpose = async (
    code: string,
    scope: string[],
    autoDelete: boolean,
  ): Promise<string> => {
    const { data, error } = await admin
      .from('purpose_definitions')
      .insert({
        org_id: org.orgId,
        purpose_code: code,
        display_name: code,
        description: `${code} purpose for expiry tests`,
        data_scope: scope,
        default_expiry_days: 365,
        auto_delete_on_expiry: autoDelete,
        framework: 'dpdp',
      })
      .select('id')
      .single()
    if (error) throw new Error(`seed purpose ${code}: ${error.message}`)
    return data.id as string
  }

  const marketingPurposeId = await seedPurpose('marketing', ['email_address', 'name'], true)
  const analyticsPurposeId = await seedPurpose('analytics', ['session_identifier'], false)

  const { data: prop, error: pErr } = await admin
    .from('web_properties')
    .insert({
      org_id: org.orgId,
      name: 'Expiry Pipeline Test Site',
      url: 'https://expiry-pipeline-test.example.com',
    })
    .select('id')
    .single()
  if (pErr) throw new Error(`seed web_property: ${pErr.message}`)

  const { data: banner, error: bErr } = await admin
    .from('consent_banners')
    .insert({
      org_id: org.orgId,
      property_id: prop.id,
      version: 1,
      is_active: true,
      headline: 'Expiry test',
      body_copy: 'Accept or reject',
      purposes: [
        {
          id: 'marketing',
          purpose_definition_id: marketingPurposeId,
          name: 'Marketing',
          description: 'Marketing',
          data_scope: ['email_address', 'name'],
          default_expiry_days: 365,
          required: false,
          default: false,
        },
        {
          id: 'analytics',
          purpose_definition_id: analyticsPurposeId,
          name: 'Analytics',
          description: 'Analytics',
          data_scope: ['session_identifier'],
          default_expiry_days: 365,
          required: false,
          default: false,
        },
      ],
    })
    .select('id')
    .single()
  if (bErr) throw new Error(`seed banner: ${bErr.message}`)

  f = {
    marketingPurposeId,
    analyticsPurposeId,
    propertyId: prop.id,
    bannerId: banner.id,
  }
}, 60_000)

afterAll(async () => {
  if (org) await cleanupTestOrg(org)
}, 30_000)

// ═══════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════

async function insertConsentEvent(fingerprint: string, accepted: string[]): Promise<string> {
  const admin = getServiceClient()
  const { data, error } = await admin
    .from('consent_events')
    .insert({
      org_id: org.orgId,
      property_id: f.propertyId,
      banner_id: f.bannerId,
      banner_version: 1,
      session_fingerprint: fingerprint,
      event_type: 'consent_given',
      purposes_accepted: accepted,
      purposes_rejected: [],
    })
    .select('id')
    .single()
  if (error) throw new Error(`insert consent_event: ${error.message}`)
  return data.id
}

async function pollArtefactsForEvent(
  eventId: string,
  expected: number,
): Promise<Array<{ id: string; artefact_id: string; purpose_code: string }>> {
  const admin = getServiceClient()
  const deadline = Date.now() + POLL_TIMEOUT_MS
  let lastCount = 0
  while (Date.now() < deadline) {
    const { data, error } = await admin
      .from('consent_artefacts')
      .select('id, artefact_id, purpose_code')
      .eq('consent_event_id', eventId)
    if (error) throw new Error(`poll artefacts: ${error.message}`)
    lastCount = data?.length ?? 0
    if (lastCount >= expected) {
      return data as Array<{ id: string; artefact_id: string; purpose_code: string }>
    }
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS))
  }
  throw new Error(`timed out waiting for ${expected} artefacts (got ${lastCount})`)
}

// ═══════════════════════════════════════════════════════════
// Test 10.6 — enforce_artefact_expiry (time-travel)
// ═══════════════════════════════════════════════════════════

describe('Test 10.6 — enforce_artefact_expiry', () => {
  it('flips expired artefacts to status=expired, removes index, stages R2 row only when auto_delete', async () => {
    const admin = getServiceClient()
    const fingerprint = `test-10-6-${Date.now()}`

    const eventId = await insertConsentEvent(fingerprint, ['marketing', 'analytics'])
    const artefacts = await pollArtefactsForEvent(eventId, 2)
    const byCode = Object.fromEntries(artefacts.map((a) => [a.purpose_code, a]))
    const marketing = byCode.marketing
    const analytics = byCode.analytics
    expect(marketing).toBeTruthy()
    expect(analytics).toBeTruthy()

    // Time-travel: backdate both artefacts' expires_at.
    const past = new Date(Date.now() - 60_000).toISOString()
    const { error: travelErr } = await admin
      .from('consent_artefacts')
      .update({ expires_at: past })
      .in('artefact_id', [marketing.artefact_id, analytics.artefact_id])
    if (travelErr) throw new Error(`time-travel artefacts: ${travelErr.message}`)

    // Snapshot delivery_buffer rows pre-call so we can isolate the new ones.
    const { data: preBuffer } = await admin
      .from('delivery_buffer')
      .select('id')
      .eq('org_id', org.orgId)
    const preIds = new Set<string>((preBuffer ?? []).map((r) => r.id as string))

    // Invoke the helper.
    const { error: rpcErr } = await admin.rpc('enforce_artefact_expiry')
    if (rpcErr) throw new Error(`enforce_artefact_expiry rpc: ${rpcErr.message}`)

    // Both artefacts now expired.
    const { data: afterArts } = await admin
      .from('consent_artefacts')
      .select('artefact_id, status')
      .in('artefact_id', [marketing.artefact_id, analytics.artefact_id])
    expect(afterArts?.length).toBe(2)
    expect(afterArts?.every((a) => a.status === 'expired')).toBe(true)

    // Validity index rows removed.
    const { data: afterIdx } = await admin
      .from('consent_artefact_index')
      .select('artefact_id')
      .in('artefact_id', [marketing.artefact_id, analytics.artefact_id])
    expect(afterIdx?.length ?? 0).toBe(0)

    // consent_expiry_queue rows marked processed.
    const { data: afterQueue } = await admin
      .from('consent_expiry_queue')
      .select('artefact_id, processed_at')
      .in('artefact_id', [marketing.artefact_id, analytics.artefact_id])
    expect(afterQueue?.length).toBe(2)
    expect(afterQueue?.every((q) => q.processed_at !== null)).toBe(true)

    // delivery_buffer: exactly ONE new row of event_type='artefact_expiry_deletion'.
    const { data: postBuffer } = await admin
      .from('delivery_buffer')
      .select('id, event_type, payload')
      .eq('org_id', org.orgId)
    const newRows = (postBuffer ?? []).filter((r) => !preIds.has(r.id as string))
    const expiryDeletionRows = newRows.filter(
      (r) => r.event_type === 'artefact_expiry_deletion',
    )
    expect(expiryDeletionRows.length).toBe(1)
    const payload = expiryDeletionRows[0].payload as {
      artefact_id: string
      data_scope: string[]
      reason: string
    }
    expect(payload.artefact_id).toBe(marketing.artefact_id)
    expect(payload.reason).toBe('consent_expired')
    expect(new Set(payload.data_scope)).toEqual(new Set(['email_address', 'name']))

    // audit_log has 2 new 'consent_artefact_expired' entries for our artefacts.
    const { data: audits } = await admin
      .from('audit_log')
      .select('entity_id, event_type, payload')
      .eq('org_id', org.orgId)
      .eq('event_type', 'consent_artefact_expired')
      .in('entity_id', [marketing.id, analytics.id])
    expect(audits?.length).toBe(2)
  }, 45_000)
})

// ═══════════════════════════════════════════════════════════
// Test 10.6b — send_expiry_alerts
// ═══════════════════════════════════════════════════════════

describe('Test 10.6b — send_expiry_alerts', () => {
  it('stages a consent_expiry_alert delivery_buffer row when notify_at has lapsed; idempotent via notified_at', async () => {
    const admin = getServiceClient()
    const fingerprint = `test-10-6b-${Date.now()}`

    const eventId = await insertConsentEvent(fingerprint, ['analytics'])
    const artefacts = await pollArtefactsForEvent(eventId, 1)
    const artefact = artefacts[0]

    // The queue row is created by trg_consent_artefact_expiry_queue (ADR-0020).
    // Time-travel its notify_at to the past so send_expiry_alerts picks it up.
    const past = new Date(Date.now() - 60_000).toISOString()
    const { data: queueRow, error: qErr } = await admin
      .from('consent_expiry_queue')
      .update({ notify_at: past })
      .eq('artefact_id', artefact.artefact_id)
      .select('id, notified_at')
      .single()
    if (qErr) throw new Error(`time-travel queue: ${qErr.message}`)
    expect(queueRow.notified_at).toBeNull()

    // Snapshot delivery_buffer pre-call.
    const { data: preBuffer } = await admin
      .from('delivery_buffer')
      .select('id')
      .eq('org_id', org.orgId)
    const preIds = new Set<string>((preBuffer ?? []).map((r) => r.id as string))

    // First invocation: should stage one alert.
    const { error: rpc1Err } = await admin.rpc('send_expiry_alerts')
    if (rpc1Err) throw new Error(`send_expiry_alerts rpc (1): ${rpc1Err.message}`)

    const { data: queueAfter1 } = await admin
      .from('consent_expiry_queue')
      .select('id, notified_at')
      .eq('id', queueRow.id)
      .single()
    expect(queueAfter1?.notified_at).toBeTruthy()

    const { data: postBuffer1 } = await admin
      .from('delivery_buffer')
      .select('id, event_type, payload')
      .eq('org_id', org.orgId)
    const newRows1 = (postBuffer1 ?? []).filter((r) => !preIds.has(r.id as string))
    const alerts1 = newRows1.filter((r) => r.event_type === 'consent_expiry_alert')
    expect(alerts1.length).toBe(1)
    const alertPayload = alerts1[0].payload as {
      artefact_id: string
      purpose_code: string
    }
    expect(alertPayload.artefact_id).toBe(artefact.artefact_id)
    expect(alertPayload.purpose_code).toBe('analytics')

    // Second invocation: notified_at guard means no new alert row should land.
    const { error: rpc2Err } = await admin.rpc('send_expiry_alerts')
    if (rpc2Err) throw new Error(`send_expiry_alerts rpc (2): ${rpc2Err.message}`)

    const { data: postBuffer2 } = await admin
      .from('delivery_buffer')
      .select('id, event_type')
      .eq('org_id', org.orgId)
    const newRows2 = (postBuffer2 ?? []).filter((r) => !preIds.has(r.id as string))
    const alerts2 = newRows2.filter((r) => r.event_type === 'consent_expiry_alert')
    expect(alerts2.length).toBe(1) // Still exactly one — second call was a no-op.
  }, 45_000)
})
