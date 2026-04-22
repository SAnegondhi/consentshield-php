// ADR-1004 Sprint 1.4 — process-artefact-revocation + regulatory exemption
// integration E2E.
//
// These tests assert that the Edge Function consults applicable_exemptions
// before creating deletion_receipts, and writes retention_suppressions
// audit rows for any categories covered by an active exemption.
//
// Scenarios covered:
//   1. BFSI + bureau_reporting artefact → CICRA covers all mapping
//      categories → NO deletion_receipts row; retention_suppressions row
//      written with CICRA citation.
//   2. Revocation marked dispatched_at even when fully suppressed.

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import {
  createTestOrg,
  cleanupTestOrg,
  getServiceClient,
  type TestOrg,
} from '../rls/helpers'

const POLL_TIMEOUT_MS = 20_000
const POLL_INTERVAL_MS = 500
const DUMMY_CONFIG_HEX = '\\x7b7d' // literal JSON "{}"

interface Fx {
  bureauPurposeId: string
  cibilConnectorId: string
  propertyId: string
  bannerId: string
}

let org: TestOrg
let fx: Fx

beforeAll(async () => {
  org = await createTestOrg('retention-suppression')
  const admin = getServiceClient()

  await admin.from('organisations').update({ industry: 'bfsi' }).eq('id', org.orgId)

  // Seed bureau_reporting purpose.
  const { data: purpose, error: pErr } = await admin
    .from('purpose_definitions')
    .insert({
      org_id: org.orgId,
      purpose_code: 'bureau_reporting',
      display_name: 'Credit bureau reporting',
      description: 'ADR-1004 test — CICRA-covered purpose',
      data_scope: ['pan', 'name'],
      default_expiry_days: 365,
      framework: 'dpdp',
    })
    .select('id')
    .single()
  if (pErr) throw new Error(`seed purpose: ${pErr.message}`)
  const bureauPurposeId = purpose.id as string

  // CIBIL connector + mapping.
  const { data: cibil, error: cErr } = await admin
    .from('integration_connectors')
    .insert({
      org_id: org.orgId,
      connector_type: 'webhook',
      display_name: 'CIBIL',
      config: DUMMY_CONFIG_HEX,
      status: 'active',
    })
    .select('id')
    .single()
  if (cErr) throw new Error(`seed connector: ${cErr.message}`)
  const cibilConnectorId = cibil.id as string

  const { error: mErr } = await admin
    .from('purpose_connector_mappings')
    .insert({
      org_id: org.orgId,
      purpose_definition_id: bureauPurposeId,
      connector_id: cibilConnectorId,
      // Both categories here are covered by CICRA (pan) and the mapping
      // should produce a fully-suppressed receipt. 'name' is covered by
      // CICRA too (appears in data_categories for CICRA_2005).
      data_categories: ['pan', 'name'],
    })
  if (mErr) throw new Error(`seed mapping: ${mErr.message}`)

  const { data: prop, error: wpErr } = await admin
    .from('web_properties')
    .insert({
      org_id: org.orgId,
      name: 'Retention Suppression Test Site',
      url: `https://retention-suppression-${Date.now()}.test`,
    })
    .select('id')
    .single()
  if (wpErr) throw new Error(`seed web_property: ${wpErr.message}`)

  const { data: banner, error: bErr } = await admin
    .from('consent_banners')
    .insert({
      org_id: org.orgId,
      property_id: prop.id,
      version: 1,
      is_active: true,
      headline: 'Bureau reporting consent',
      body_copy: 'Accept or reject',
      purposes: [
        {
          id: 'bureau_reporting',
          purpose_definition_id: bureauPurposeId,
          name: 'Bureau Reporting',
          description: 'CICRA test',
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

  fx = {
    bureauPurposeId,
    cibilConnectorId,
    propertyId: prop.id,
    bannerId: banner.id,
  }
}, 120_000)

afterAll(async () => {
  if (org) await cleanupTestOrg(org)
}, 30_000)

async function pollForSuppression(revocationId: string) {
  const admin = getServiceClient()
  const deadline = Date.now() + POLL_TIMEOUT_MS
  while (Date.now() < deadline) {
    const { data } = await admin
      .from('retention_suppressions')
      .select('id, statute_code, suppressed_data_categories, source_citation, exemption_id')
      .eq('revocation_id', revocationId)
    if ((data ?? []).length > 0) return data!
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS))
  }
  throw new Error(`no retention_suppressions for revocation ${revocationId} within ${POLL_TIMEOUT_MS}ms`)
}

describe('ADR-1004 Sprint 1.4 — BFSI bureau_reporting revocation is fully suppressed by CICRA', () => {

  it('writes a retention_suppressions row and no deletion_receipts', async () => {
    const admin = getServiceClient()
    const fingerprint = `retention-supp-${Date.now()}`

    // Insert a consent event → artefact creation via ADR-0021 pipeline.
    const { data: evt, error: evErr } = await admin
      .from('consent_events')
      .insert({
        org_id: org.orgId,
        property_id: fx.propertyId,
        banner_id: fx.bannerId,
        banner_version: 1,
        session_fingerprint: fingerprint,
        event_type: 'consent_given',
        purposes_accepted: ['bureau_reporting'],
        purposes_rejected: [],
      })
      .select('id')
      .single()
    if (evErr) throw new Error(`insert consent_event: ${evErr.message}`)

    // Poll for artefact.
    let artefactId: string | null = null
    const artDeadline = Date.now() + POLL_TIMEOUT_MS
    while (Date.now() < artDeadline) {
      const { data } = await admin
        .from('consent_artefacts')
        .select('artefact_id')
        .eq('consent_event_id', evt.id)
        .maybeSingle()
      if (data?.artefact_id) {
        artefactId = data.artefact_id
        break
      }
      await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS))
    }
    expect(artefactId).toBeTruthy()

    // Revoke it. Dispatch-trigger fires Edge Function asynchronously.
    const { data: rev, error: revErr } = await admin
      .from('artefact_revocations')
      .insert({
        org_id: org.orgId,
        artefact_id: artefactId!,
        reason: 'user_preference_change',
        revoked_by_type: 'data_principal',
        revoked_by_ref: fingerprint,
      })
      .select('id')
      .single()
    if (revErr) throw new Error(`insert revocation: ${revErr.message}`)
    const revocationId = rev.id as string

    // Poll for retention_suppressions row — Edge Function must have run.
    const suppressions = await pollForSuppression(revocationId)
    expect(suppressions.length).toBeGreaterThanOrEqual(1)

    // At least one suppression must cite CICRA.
    const cicra = suppressions.find((s) => s.statute_code === 'CICRA_2005')
    expect(cicra).toBeTruthy()
    expect(cicra!.suppressed_data_categories).toEqual(expect.arrayContaining(['pan']))
    expect(cicra!.source_citation).toMatch(/legislative/)

    // No deletion_receipts for this revocation — every category in the
    // connector mapping is CICRA-covered, so the receipt is fully
    // suppressed.
    const { data: receipts } = await admin
      .from('deletion_receipts')
      .select('id, request_payload')
      .eq('trigger_id', revocationId)
      .eq('trigger_type', 'consent_revoked')
    expect(receipts?.length ?? 0).toBe(0)

    // Revocation marked dispatched.
    const { data: revAfter } = await admin
      .from('artefact_revocations')
      .select('dispatched_at')
      .eq('id', revocationId)
      .single()
    expect(revAfter?.dispatched_at).toBeTruthy()
  }, 60_000)

})
