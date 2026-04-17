// ADR-0021 Sprint 1.1 — process-consent-event pipeline integration tests.
//
// Priority 10 §1–3 from consentshield-testing-strategy.md:
//   - Test 10.1: Artefact creation on consent_given.
//   - Test 10.2: Idempotency under trigger + cron race.
//   - Test 10.3: Trigger failure must not roll back INSERT — manual only.
//     Deferred to operator verification because it mutates Vault state
//     that Terminal A's cron jobs also depend on. The procedure is
//     documented at the bottom of this file.
//
// These tests hit the live hosted dev Supabase. They exercise the
// full stack: trigger → net.http_post → Edge Function → tables.
// Trigger dispatch is asynchronous; tests poll with a timeout.

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import {
  createTestOrg,
  cleanupTestOrg,
  getServiceClient,
  TestOrg,
} from '../rls/helpers'

const POLL_TIMEOUT_MS = 15_000
const POLL_INTERVAL_MS = 500

let org: TestOrg
let marketingPurposeId: string
let analyticsPurposeId: string
let propertyId: string
let bannerId: string

beforeAll(async () => {
  org = await createTestOrg('depa-pipeline')
  const admin = getServiceClient()

  // Two purpose_definitions with populated data_scope.
  const { data: marketing, error: mErr } = await admin
    .from('purpose_definitions')
    .insert({
      org_id: org.orgId,
      purpose_code: 'marketing',
      display_name: 'Marketing',
      description: 'Marketing communications',
      data_scope: ['email_address', 'name'],
      default_expiry_days: 180,
      framework: 'dpdp',
    })
    .select('id')
    .single()
  if (mErr) throw new Error(`seed marketing purpose_definition: ${mErr.message}`)
  marketingPurposeId = marketing.id

  const { data: analytics, error: aErr } = await admin
    .from('purpose_definitions')
    .insert({
      org_id: org.orgId,
      purpose_code: 'analytics',
      display_name: 'Analytics',
      description: 'Product analytics',
      data_scope: ['session_identifier'],
      default_expiry_days: 365,
      framework: 'dpdp',
    })
    .select('id')
    .single()
  if (aErr) throw new Error(`seed analytics purpose_definition: ${aErr.message}`)
  analyticsPurposeId = analytics.id

  // Web property + consent banner with purpose_definition_id on each purpose.
  const { data: prop, error: pErr } = await admin
    .from('web_properties')
    .insert({ org_id: org.orgId, name: 'Pipeline Test Site', url: 'https://pipeline-test.example.com' })
    .select('id')
    .single()
  if (pErr) throw new Error(`seed web_property: ${pErr.message}`)
  propertyId = prop.id

  const { data: banner, error: bErr } = await admin
    .from('consent_banners')
    .insert({
      org_id: org.orgId,
      property_id: propertyId,
      version: 1,
      is_active: true,
      headline: 'We use cookies',
      body_copy: 'Accept or reject to continue.',
      purposes: [
        {
          id: 'marketing',
          purpose_definition_id: marketingPurposeId,
          name: 'Marketing',
          description: 'Marketing communications',
          data_scope: ['email_address', 'name'],
          default_expiry_days: 180,
          required: false,
          default: false,
        },
        {
          id: 'analytics',
          purpose_definition_id: analyticsPurposeId,
          name: 'Analytics',
          description: 'Product analytics',
          data_scope: ['session_identifier'],
          default_expiry_days: 365,
          required: false,
          default: false,
        },
      ],
    })
    .select('id')
    .single()
  if (bErr) throw new Error(`seed consent_banner: ${bErr.message}`)
  bannerId = banner.id
}, 60_000)

afterAll(async () => {
  if (org) await cleanupTestOrg(org)
}, 30_000)

// ═══════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════

async function insertConsentEvent(fingerprint: string): Promise<string> {
  const admin = getServiceClient()
  const { data, error } = await admin
    .from('consent_events')
    .insert({
      org_id: org.orgId,
      property_id: propertyId,
      banner_id: bannerId,
      banner_version: 1,
      session_fingerprint: fingerprint,
      event_type: 'consent_given',
      purposes_accepted: ['marketing', 'analytics'],
      purposes_rejected: [],
    })
    .select('id')
    .single()
  if (error) throw new Error(`insert consent_event: ${error.message}`)
  return data.id
}

async function pollArtefactsForEvent(eventId: string, expected: number): Promise<string[]> {
  const admin = getServiceClient()
  const deadline = Date.now() + POLL_TIMEOUT_MS
  let lastCount = 0
  while (Date.now() < deadline) {
    const { data, error } = await admin
      .from('consent_artefacts')
      .select('artefact_id')
      .eq('consent_event_id', eventId)
    if (error) throw new Error(`poll artefacts: ${error.message}`)
    lastCount = data?.length ?? 0
    if (lastCount >= expected) {
      return (data as { artefact_id: string }[]).map((r) => r.artefact_id)
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS))
  }
  throw new Error(`timed out waiting for ${expected} artefacts (got ${lastCount})`)
}

// ═══════════════════════════════════════════════════════════
// Test 10.1 — Artefact creation on consent_given
// ═══════════════════════════════════════════════════════════

describe('Test 10.1 — artefact creation on consent_given', () => {
  it('INSERT into consent_events creates one artefact per accepted purpose within 15s', async () => {
    const fingerprint = `test-10-1-${Date.now()}`
    const eventId = await insertConsentEvent(fingerprint)
    const artefactIds = await pollArtefactsForEvent(eventId, 2)

    expect(artefactIds.length).toBe(2)
    expect(artefactIds.every((id) => id.startsWith('cs_art_'))).toBe(true)

    const admin = getServiceClient()

    // Verify the artefact contents (data_scope snapshot, framework, status).
    const { data: artefacts } = await admin
      .from('consent_artefacts')
      .select('artefact_id, purpose_code, data_scope, framework, status, expires_at')
      .eq('consent_event_id', eventId)

    expect(artefacts).toBeTruthy()
    const byCode = Object.fromEntries((artefacts ?? []).map((a) => [a.purpose_code, a]))

    expect(byCode.marketing).toBeTruthy()
    expect(byCode.marketing.data_scope).toEqual(['email_address', 'name'])
    expect(byCode.marketing.framework).toBe('dpdp')
    expect(byCode.marketing.status).toBe('active')

    expect(byCode.analytics).toBeTruthy()
    expect(byCode.analytics.data_scope).toEqual(['session_identifier'])
    expect(byCode.analytics.status).toBe('active')

    // Verify consent_events.artefact_ids was populated.
    const { data: event } = await admin
      .from('consent_events')
      .select('artefact_ids')
      .eq('id', eventId)
      .single()
    expect(event?.artefact_ids?.length).toBe(2)
    expect(new Set(event?.artefact_ids)).toEqual(new Set(artefactIds))

    // Verify consent_artefact_index has matching rows.
    const { data: idx } = await admin
      .from('consent_artefact_index')
      .select('artefact_id, validity_state, framework, purpose_code')
      .in('artefact_id', artefactIds)
    expect(idx?.length).toBe(2)
    expect(idx?.every((r) => r.validity_state === 'active')).toBe(true)

    // Verify consent_expiry_queue has matching rows (from the ADR-0020
    // trg_consent_artefact_expiry_queue trigger).
    const { data: queue } = await admin
      .from('consent_expiry_queue')
      .select('artefact_id, purpose_code, notify_at')
      .in('artefact_id', artefactIds)
    expect(queue?.length).toBe(2)
  }, 30_000)
})

// ═══════════════════════════════════════════════════════════
// Test 10.2 — Idempotency under trigger + cron race
// ═══════════════════════════════════════════════════════════

describe('Test 10.2 — idempotency under trigger + cron race', () => {
  it('Insert + immediate manual safety-net fire produces exactly N artefacts, never 2N', async () => {
    const fingerprint = `test-10-2-${Date.now()}`
    const admin = getServiceClient()
    const eventId = await insertConsentEvent(fingerprint)

    // The event is fresh (< 5 min), so the safety-net function wouldn't
    // pick it up by its own filter. Call the Edge Function directly for
    // the race: that way the trigger-path call and our direct call both
    // race on the same UNIQUE constraint.
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
    const cs_orchestrator_key = process.env.SUPABASE_SERVICE_ROLE_KEY
    if (!supabaseUrl || !cs_orchestrator_key) {
      throw new Error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY for race test')
    }

    // Fire 3 concurrent Edge Function invocations; the AFTER INSERT
    // trigger's own dispatch makes it 4.
    const racers = [0, 1, 2].map(() =>
      fetch(`${supabaseUrl}/functions/v1/process-consent-event`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${cs_orchestrator_key}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ consent_event_id: eventId }),
      }),
    )
    await Promise.all(racers)

    // Poll for completion; then assert exactly 2 artefacts exist.
    const artefactIds = await pollArtefactsForEvent(eventId, 2)
    expect(artefactIds.length).toBe(2)

    // Double-check: sleep a short bit and re-count. The UNIQUE constraint
    // + ON CONFLICT DO NOTHING means no further artefacts can appear.
    await new Promise((r) => setTimeout(r, 2_000))
    const { data: finalRows } = await admin
      .from('consent_artefacts')
      .select('artefact_id')
      .eq('consent_event_id', eventId)
    expect(finalRows?.length).toBe(2)
  }, 30_000)
})

/*
 * Test 10.3 — Trigger failure must not roll back the Worker's INSERT.
 *
 * MANUAL VERIFICATION ONLY. This test temporarily breaks the
 * `supabase_url` Vault secret. That secret is shared with every other
 * cron job that calls an Edge Function (sla-reminders-daily,
 * consent-probes-hourly, check-stuck-deletions-hourly, security-scan-
 * nightly, stuck-buffer-detection-hourly). Running this test while any
 * cron is in flight breaks the other jobs for the duration.
 *
 * Procedure (run when no other cron work is active):
 *
 *   -- 1. Break the Vault secret.
 *   update vault.secrets set name = 'supabase_url_broken'
 *    where name = 'supabase_url';
 *
 *   -- 2. Insert a consent_events row (use any existing banner + event).
 *   insert into consent_events (org_id, property_id, banner_id,
 *                                banner_version, session_fingerprint,
 *                                event_type, purposes_accepted)
 *   values ('<org_id>', '<property_id>', '<banner_id>', 1,
 *           '10-3-fp', 'consent_given', '["marketing"]');
 *
 *   -- Expected: INSERT succeeds (returns 1 row). The trigger fires,
 *   -- net.http_post fails (URL lookup returns NULL), EXCEPTION handler
 *   -- swallows it, trigger returns. consent_events row is committed;
 *   -- artefact_ids is '{}'.
 *
 *   -- 3. Verify the event exists with empty artefact_ids:
 *   select id, artefact_ids from consent_events
 *    where session_fingerprint = '10-3-fp';
 *   -- Expected: 1 row, artefact_ids = '{}'.
 *
 *   -- 4. Restore the Vault secret.
 *   update vault.secrets set name = 'supabase_url'
 *    where name = 'supabase_url_broken';
 *
 *   -- 5. Wait up to 5 minutes for the safety-net cron to pick it up,
 *   -- or manually invoke:
 *   select safety_net_process_consent_events();
 *
 *   -- 6. Verify artefacts are now created:
 *   select artefact_ids from consent_events
 *    where session_fingerprint = '10-3-fp';
 *   -- Expected: artefact_ids array of length 1 (marketing artefact).
 *
 *   -- 7. Clean up:
 *   delete from consent_events where session_fingerprint = '10-3-fp';
 *
 * Record the outcome under Test 10.3 in docs/ADRs/ADR-0021-process-
 * consent-event.md § Test Results.
 */
