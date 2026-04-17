// ADR-0022 Sprint 1.4 — process-artefact-revocation pipeline integration tests.
//
// Priority 10 §4/§7/§10 from consentshield-testing-strategy.md:
//   - Test 10.4: Revocation cascade precision — data-scope subsetting + status flip.
//   - Test 10.7: Replacement chain frozen on revocation (S-5 invariant).
//   - Test 10.10: Artefact-scoped precision against sibling artefacts.
//
// Tests hit the live hosted dev Supabase. They exercise:
//   artefact_revocations INSERT
//     → trg_artefact_revocation cascade (in-DB: status flip, index removal, audit)
//     → trg_artefact_revocation_dispatch (net.http_post to Edge Function)
//     → process-artefact-revocation (deletion_receipts fan-out)
//
// Dispatch is asynchronous; tests poll with a timeout.

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import {
  createTestOrg,
  cleanupTestOrg,
  getServiceClient,
  TestOrg,
} from '../rls/helpers'

const POLL_TIMEOUT_MS = 15_000
const POLL_INTERVAL_MS = 500

// Dummy bytea for integration_connectors.config — not decrypted in tests
// because the Edge Function never decrypts config in the revocation path;
// it only reads id, connector_type, display_name, status.
const DUMMY_CONFIG_HEX = '\\x7b7d' // literal JSON "{}"

interface Fixtures {
  marketingPurposeId: string
  analyticsPurposeId: string
  bureauPurposeId: string
  mailchimpConnectorId: string
  hotjarConnectorId: string
  cibilConnectorId: string
  propertyId: string
  bannerId: string
}

let org: TestOrg
let f: Fixtures

beforeAll(async () => {
  org = await createTestOrg('revocation-pipeline')
  const admin = getServiceClient()

  // ─── Three purpose_definitions ──────────────────────────────
  const seedPurpose = async (code: string, scope: string[]) => {
    const { data, error } = await admin
      .from('purpose_definitions')
      .insert({
        org_id: org.orgId,
        purpose_code: code,
        display_name: code,
        description: `${code} purpose for revocation tests`,
        data_scope: scope,
        default_expiry_days: 365,
        framework: 'dpdp',
      })
      .select('id')
      .single()
    if (error) throw new Error(`seed purpose_definition ${code}: ${error.message}`)
    return data.id as string
  }

  const marketingPurposeId = await seedPurpose('marketing', ['email_address', 'name'])
  const analyticsPurposeId = await seedPurpose('analytics', ['session_identifier'])
  const bureauPurposeId = await seedPurpose('bureau_reporting', ['pan', 'name'])

  // ─── Three integration_connectors ──────────────────────────
  const seedConnector = async (connectorType: string, displayName: string) => {
    const { data, error } = await admin
      .from('integration_connectors')
      .insert({
        org_id: org.orgId,
        connector_type: connectorType,
        display_name: displayName,
        config: DUMMY_CONFIG_HEX,
        status: 'active',
      })
      .select('id')
      .single()
    if (error) throw new Error(`seed connector ${displayName}: ${error.message}`)
    return data.id as string
  }

  const mailchimpConnectorId = await seedConnector('mailchimp', 'Mailchimp')
  const hotjarConnectorId = await seedConnector('webhook', 'Hotjar')
  const cibilConnectorId = await seedConnector('webhook', 'CIBIL')

  // ─── Three purpose_connector_mappings ──────────────────────
  const seedMapping = async (
    purposeId: string,
    connectorId: string,
    dataCategories: string[],
  ) => {
    const { error } = await admin
      .from('purpose_connector_mappings')
      .insert({
        org_id: org.orgId,
        purpose_definition_id: purposeId,
        connector_id: connectorId,
        data_categories: dataCategories,
      })
    if (error) throw new Error(`seed mapping: ${error.message}`)
  }

  await seedMapping(marketingPurposeId, mailchimpConnectorId, ['email_address', 'name'])
  await seedMapping(analyticsPurposeId, hotjarConnectorId, ['session_identifier'])
  await seedMapping(bureauPurposeId, cibilConnectorId, ['pan'])

  // ─── web_property + banner referencing all three purposes ───
  const { data: prop, error: pErr } = await admin
    .from('web_properties')
    .insert({
      org_id: org.orgId,
      name: 'Revocation Pipeline Test Site',
      url: 'https://revocation-pipeline-test.example.com',
    })
    .select('id')
    .single()
  if (pErr) throw new Error(`seed web_property: ${pErr.message}`)
  const propertyId = prop.id

  const { data: banner, error: bErr } = await admin
    .from('consent_banners')
    .insert({
      org_id: org.orgId,
      property_id: propertyId,
      version: 1,
      is_active: true,
      headline: 'Consent for all purposes',
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
        {
          id: 'bureau_reporting',
          purpose_definition_id: bureauPurposeId,
          name: 'Bureau Reporting',
          description: 'Bureau Reporting',
          data_scope: ['pan', 'name'],
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
    bureauPurposeId,
    mailchimpConnectorId,
    hotjarConnectorId,
    cibilConnectorId,
    propertyId,
    bannerId: banner.id,
  }
}, 60_000)

afterAll(async () => {
  if (org) await cleanupTestOrg(org)
}, 30_000)

// ═══════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════

async function insertConsentEvent(fingerprint: string, acceptedPurposes: string[]): Promise<string> {
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
      purposes_accepted: acceptedPurposes,
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
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS))
  }
  throw new Error(`timed out waiting for ${expected} artefacts (got ${lastCount})`)
}

async function pollReceiptsForTrigger(
  triggerId: string,
  expected: number,
): Promise<
  Array<{
    id: string
    connector_id: string
    target_system: string
    artefact_id: string | null
    status: string
    request_payload: Record<string, unknown> | null
  }>
> {
  const admin = getServiceClient()
  const deadline = Date.now() + POLL_TIMEOUT_MS
  let lastCount = 0
  while (Date.now() < deadline) {
    const { data, error } = await admin
      .from('deletion_receipts')
      .select('id, connector_id, target_system, artefact_id, status, request_payload')
      .eq('trigger_id', triggerId)
      .eq('trigger_type', 'consent_revoked')
    if (error) throw new Error(`poll receipts: ${error.message}`)
    lastCount = data?.length ?? 0
    if (lastCount >= expected) return data as typeof data
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS))
  }
  throw new Error(`timed out waiting for ${expected} deletion_receipts (got ${lastCount})`)
}

async function getArtefactByPurpose(eventId: string, purposeCode: string): Promise<{
  artefact_id: string
  status: string
  data_scope: string[] | null
}> {
  const admin = getServiceClient()
  const { data, error } = await admin
    .from('consent_artefacts')
    .select('artefact_id, status, data_scope')
    .eq('consent_event_id', eventId)
    .eq('purpose_code', purposeCode)
    .single()
  if (error) throw new Error(`getArtefactByPurpose: ${error.message}`)
  return data as { artefact_id: string; status: string; data_scope: string[] | null }
}

// ═══════════════════════════════════════════════════════════
// Test 10.4 — Revocation cascade precision (data-scope subsetting)
// ═══════════════════════════════════════════════════════════

describe('Test 10.4 — revocation cascade', () => {
  it('revokes marketing only; one pending receipt on Mailchimp with scoped data_scope; analytics untouched', async () => {
    const admin = getServiceClient()
    const fingerprint = `test-10-4-${Date.now()}`

    const eventId = await insertConsentEvent(fingerprint, ['marketing', 'analytics'])
    await pollArtefactsForEvent(eventId, 2)

    const marketing = await getArtefactByPurpose(eventId, 'marketing')
    const analytics = await getArtefactByPurpose(eventId, 'analytics')
    expect(marketing.status).toBe('active')
    expect(analytics.status).toBe('active')

    // Revoke marketing only.
    const { data: rev, error: revErr } = await admin
      .from('artefact_revocations')
      .insert({
        org_id: org.orgId,
        artefact_id: marketing.artefact_id,
        reason: 'user_preference_change',
        revoked_by_type: 'data_principal',
        revoked_by_ref: fingerprint,
      })
      .select('id')
      .single()
    if (revErr) throw new Error(`insert revocation: ${revErr.message}`)
    const revocationId = rev.id as string

    // In-DB cascade should be synchronous with the INSERT (same txn).
    const { data: marketingAfter } = await admin
      .from('consent_artefacts')
      .select('status')
      .eq('artefact_id', marketing.artefact_id)
      .single()
    expect(marketingAfter?.status).toBe('revoked')

    const { data: analyticsAfter } = await admin
      .from('consent_artefacts')
      .select('status')
      .eq('artefact_id', analytics.artefact_id)
      .single()
    expect(analyticsAfter?.status).toBe('active')

    // Out-of-DB cascade: one deletion_receipt on Mailchimp.
    const receipts = await pollReceiptsForTrigger(revocationId, 1)
    expect(receipts.length).toBe(1)
    const mc = receipts[0]
    expect(mc.connector_id).toBe(f.mailchimpConnectorId)
    expect(mc.target_system).toBe('Mailchimp')
    expect(mc.status).toBe('pending')
    expect(mc.artefact_id).toBe(marketing.artefact_id)
    const payload = mc.request_payload as { data_scope: string[]; reason: string }
    // Intersection of mapping.data_categories (email_address, name) with
    // artefact.data_scope (email_address, name) = both.
    expect(new Set(payload.data_scope)).toEqual(new Set(['email_address', 'name']))
    expect(payload.reason).toBe('consent_revoked')

    // No receipts on Hotjar or CIBIL for this revocation.
    const { data: strays } = await admin
      .from('deletion_receipts')
      .select('id')
      .eq('trigger_id', revocationId)
      .in('connector_id', [f.hotjarConnectorId, f.cibilConnectorId])
    expect(strays?.length ?? 0).toBe(0)

    // Revocation marked dispatched.
    const { data: revAfter } = await admin
      .from('artefact_revocations')
      .select('dispatched_at')
      .eq('id', revocationId)
      .single()
    expect(revAfter?.dispatched_at).toBeTruthy()
  }, 45_000)
})

// ═══════════════════════════════════════════════════════════
// Test 10.7 — Replacement chain frozen on revocation (S-5)
// ═══════════════════════════════════════════════════════════

describe('Test 10.7 — replacement chain frozen', () => {
  it('revoking a replaced artefact raises and writes no deletion_receipts', async () => {
    const admin = getServiceClient()
    const fingerprint = `test-10-7-${Date.now()}`

    const eventId = await insertConsentEvent(fingerprint, ['marketing'])
    await pollArtefactsForEvent(eventId, 1)
    const marketing = await getArtefactByPurpose(eventId, 'marketing')

    // Simulate re-consent: flip status to 'replaced'. The re-consent logic
    // that actually walks consent_events → new artefact → mark old
    // replaced is not yet wired (future ADR), but the cascade invariant
    // we're testing is "once frozen, always frozen" — which applies to any
    // non-active status including 'replaced'.
    const { error: flipErr } = await admin
      .from('consent_artefacts')
      .update({ status: 'replaced' })
      .eq('artefact_id', marketing.artefact_id)
    if (flipErr) throw new Error(`flip status to replaced: ${flipErr.message}`)

    // Now attempt to revoke the frozen artefact. Cascade trigger's
    // "if not found then raise exception" fires, rolling back the INSERT.
    const { error: revErr } = await admin
      .from('artefact_revocations')
      .insert({
        org_id: org.orgId,
        artefact_id: marketing.artefact_id,
        reason: 'user_preference_change',
        revoked_by_type: 'data_principal',
        revoked_by_ref: fingerprint,
      })
    expect(revErr).toBeTruthy()
    expect(revErr?.message).toMatch(/Cannot revoke|not found or not active/)

    // No revocation row exists.
    const { data: revs } = await admin
      .from('artefact_revocations')
      .select('id')
      .eq('artefact_id', marketing.artefact_id)
    expect(revs?.length ?? 0).toBe(0)

    // No deletion_receipts for this artefact.
    const { data: receipts } = await admin
      .from('deletion_receipts')
      .select('id')
      .eq('artefact_id', marketing.artefact_id)
      .eq('trigger_type', 'consent_revoked')
    expect(receipts?.length ?? 0).toBe(0)

    // Artefact still 'replaced'.
    const { data: artAfter } = await admin
      .from('consent_artefacts')
      .select('status')
      .eq('artefact_id', marketing.artefact_id)
      .single()
    expect(artAfter?.status).toBe('replaced')
  }, 45_000)
})

// ═══════════════════════════════════════════════════════════
// Test 10.10 — Artefact-scoped precision against siblings
// ═══════════════════════════════════════════════════════════

describe('Test 10.10 — artefact-scoped precision', () => {
  it('revoking marketing in a 3-purpose org only writes receipts for marketing connectors; sibling artefacts stay active', async () => {
    const admin = getServiceClient()
    const fingerprint = `test-10-10-${Date.now()}`

    const eventId = await insertConsentEvent(
      fingerprint,
      ['marketing', 'analytics', 'bureau_reporting'],
    )
    await pollArtefactsForEvent(eventId, 3)

    const marketing = await getArtefactByPurpose(eventId, 'marketing')
    const analytics = await getArtefactByPurpose(eventId, 'analytics')
    const bureau = await getArtefactByPurpose(eventId, 'bureau_reporting')

    const { data: rev, error: revErr } = await admin
      .from('artefact_revocations')
      .insert({
        org_id: org.orgId,
        artefact_id: marketing.artefact_id,
        reason: 'user_preference_change',
        revoked_by_type: 'data_principal',
        revoked_by_ref: fingerprint,
      })
      .select('id')
      .single()
    if (revErr) throw new Error(`insert revocation: ${revErr.message}`)
    const revocationId = rev.id as string

    // Wait for the dispatch cascade.
    const receipts = await pollReceiptsForTrigger(revocationId, 1)
    expect(receipts.length).toBe(1)
    expect(receipts[0].connector_id).toBe(f.mailchimpConnectorId)
    expect(receipts[0].target_system).toBe('Mailchimp')

    // Zero receipts tied to this revocation for Hotjar or CIBIL.
    const { data: sibRecipients } = await admin
      .from('deletion_receipts')
      .select('id, connector_id')
      .eq('trigger_id', revocationId)
      .in('connector_id', [f.hotjarConnectorId, f.cibilConnectorId])
    expect(sibRecipients?.length ?? 0).toBe(0)

    // Sibling artefacts untouched.
    const { data: sibs } = await admin
      .from('consent_artefacts')
      .select('artefact_id, status')
      .in('artefact_id', [analytics.artefact_id, bureau.artefact_id])
    expect(sibs?.length).toBe(2)
    expect(sibs?.every((s) => s.status === 'active')).toBe(true)
  }, 45_000)
})
