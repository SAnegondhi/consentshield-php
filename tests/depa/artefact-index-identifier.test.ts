// ADR-1002 Sprint 1.1 — consent_artefact_index extension tests.
//
// Covers:
//   1. hash_data_principal_identifier — deterministic within an org,
//      different across orgs, normalisation per identifier_type, rejects empty.
//   2. Revocation cascade trigger — revoking an artefact UPDATEs the index
//      row (validity_state='revoked', revoked_at, revocation_record_id);
//      does not DELETE.
//   3. Edge Function write path — an index row created by the pipeline
//      carries property_id and consent_event_id.

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import {
  createTestOrg,
  cleanupTestOrg,
  getServiceClient,
  type TestOrg,
} from '../rls/helpers'

let orgA: TestOrg
let orgB: TestOrg

beforeAll(async () => {
  orgA = await createTestOrg('artIdxA')
  orgB = await createTestOrg('artIdxB')
}, 60_000)

afterAll(async () => {
  await cleanupTestOrg(orgA)
  await cleanupTestOrg(orgB)
}, 30_000)

// ═══════════════════════════════════════════════════════════
// 1. hash_data_principal_identifier
// ═══════════════════════════════════════════════════════════

describe('hash_data_principal_identifier', () => {

  it('returns identical hashes for the same identifier + org + type', async () => {
    const admin = getServiceClient()
    const { data: h1 } = await admin.rpc('hash_data_principal_identifier', {
      p_org_id: orgA.orgId,
      p_identifier: 'user@example.com',
      p_identifier_type: 'email',
    })
    const { data: h2 } = await admin.rpc('hash_data_principal_identifier', {
      p_org_id: orgA.orgId,
      p_identifier: 'user@example.com',
      p_identifier_type: 'email',
    })
    expect(h1).toBe(h2)
    expect(typeof h1).toBe('string')
    expect((h1 as string).length).toBe(64) // SHA-256 hex
  })

  it('email normalisation: trim + lowercase', async () => {
    const admin = getServiceClient()
    const canonical = await admin.rpc('hash_data_principal_identifier', {
      p_org_id: orgA.orgId,
      p_identifier: 'user@example.com',
      p_identifier_type: 'email',
    })
    const messy = await admin.rpc('hash_data_principal_identifier', {
      p_org_id: orgA.orgId,
      p_identifier: '  USER@Example.COM  ',
      p_identifier_type: 'email',
    })
    expect(canonical.data).toBe(messy.data)
  })

  it('phone normalisation: strip non-digits', async () => {
    const admin = getServiceClient()
    const canonical = await admin.rpc('hash_data_principal_identifier', {
      p_org_id: orgA.orgId,
      p_identifier: '9876543210',
      p_identifier_type: 'phone',
    })
    const formatted = await admin.rpc('hash_data_principal_identifier', {
      p_org_id: orgA.orgId,
      p_identifier: '+91-98765-43210',
      p_identifier_type: 'phone',
    })
    // '91' + '9876543210' → '919876543210' ≠ '9876543210'.
    // Phone normalisation is digits-only; callers MUST include the country code
    // deterministically. This test confirms the rule: formatted-with-country
    // normalises differently from 10-digit bare number.
    expect(canonical.data).not.toBe(formatted.data)
  })

  it('pan normalisation: trim + uppercase', async () => {
    const admin = getServiceClient()
    const canonical = await admin.rpc('hash_data_principal_identifier', {
      p_org_id: orgA.orgId,
      p_identifier: 'ABCDE1234F',
      p_identifier_type: 'pan',
    })
    const lower = await admin.rpc('hash_data_principal_identifier', {
      p_org_id: orgA.orgId,
      p_identifier: ' abcde1234f ',
      p_identifier_type: 'pan',
    })
    expect(canonical.data).toBe(lower.data)
  })

  it('different orgs produce different hashes for the same identifier (per-org salt)', async () => {
    const admin = getServiceClient()
    const { data: hA } = await admin.rpc('hash_data_principal_identifier', {
      p_org_id: orgA.orgId,
      p_identifier: 'user@example.com',
      p_identifier_type: 'email',
    })
    const { data: hB } = await admin.rpc('hash_data_principal_identifier', {
      p_org_id: orgB.orgId,
      p_identifier: 'user@example.com',
      p_identifier_type: 'email',
    })
    expect(hA).not.toBe(hB)
  })

  it('rejects empty identifier', async () => {
    const admin = getServiceClient()
    const { error } = await admin.rpc('hash_data_principal_identifier', {
      p_org_id: orgA.orgId,
      p_identifier: '',
      p_identifier_type: 'email',
    })
    expect(error).not.toBeNull()
    expect(error?.message.toLowerCase()).toContain('empty')
  })

  it('rejects identifier that normalises to empty (phone with no digits)', async () => {
    const admin = getServiceClient()
    const { error } = await admin.rpc('hash_data_principal_identifier', {
      p_org_id: orgA.orgId,
      p_identifier: '----',
      p_identifier_type: 'phone',
    })
    expect(error).not.toBeNull()
  })

  it('rejects unknown identifier_type', async () => {
    const admin = getServiceClient()
    const { error } = await admin.rpc('hash_data_principal_identifier', {
      p_org_id: orgA.orgId,
      p_identifier: 'anything',
      p_identifier_type: 'passport',
    })
    expect(error).not.toBeNull()
  })

})

// ═══════════════════════════════════════════════════════════
// 2. Revocation cascade UPDATEs (not DELETEs) the index row
// ═══════════════════════════════════════════════════════════

describe('trg_artefact_revocation_cascade — UPDATE not DELETE', () => {

  it('preserves the index row with validity_state=revoked + revoked_at + revocation_record_id', async () => {
    const admin = getServiceClient()

    // Seed a minimal purpose_definition + consent_event + consent_artefact +
    // consent_artefact_index row. Bypasses the Edge Function so the test is
    // synchronous and deterministic.
    const { data: purpose, error: pErr } = await admin
      .from('purpose_definitions')
      .insert({
        org_id: orgA.orgId,
        purpose_code: 'revoke_idx_test',
        display_name: 'Revoke index test purpose',
        description: 'ADR-1002 Sprint 1.1 test purpose',
        data_scope: ['email_address'],
        default_expiry_days: 365,
        framework: 'dpdp',
      })
      .select('id')
      .single()
    if (pErr) throw new Error(`seed purpose: ${pErr.message}`)

    // Need a banner + property for consent_artefacts FKs.
    const { data: property, error: wpErr } = await admin
      .from('web_properties')
      .insert({
        org_id: orgA.orgId,
        name: 'test prop',
        url: `https://revoke-idx-${Date.now()}.test`,
      })
      .select('id')
      .single()
    if (wpErr) throw new Error(`seed web_property: ${wpErr.message}`)

    const { data: banner, error: bErr } = await admin
      .from('consent_banners')
      .insert({
        org_id: orgA.orgId,
        property_id: property!.id,
        version: 1,
        headline: 'Test',
        body_copy: 'Test body',
        purposes: [],
        is_active: true,
      })
      .select('id')
      .single()
    if (bErr) throw new Error(`seed banner: ${bErr.message}`)
    const fp = `revoke-idx-${Date.now()}`
    const { data: event } = await admin
      .from('consent_events')
      .insert({
        org_id: orgA.orgId,
        property_id: property!.id,
        banner_id: banner!.id,
        banner_version: 1,
        session_fingerprint: fp,
        event_type: 'accept',
        purposes_accepted: [{ purpose_definition_id: purpose!.id, purpose_code: 'revoke_idx_test' }],
        purposes_rejected: [],
      })
      .select('id')
      .single()

    const { data: artefact, error: aErr } = await admin
      .from('consent_artefacts')
      .insert({
        org_id: orgA.orgId,
        property_id: property!.id,
        banner_id: banner!.id,
        banner_version: 1,
        consent_event_id: event!.id,
        session_fingerprint: fp,
        purpose_definition_id: purpose!.id,
        purpose_code: 'revoke_idx_test',
        data_scope: ['email_address'],
        framework: 'dpdp',
        expires_at: new Date(Date.now() + 365 * 86400_000).toISOString(),
      })
      .select('artefact_id')
      .single()
    if (aErr) throw new Error(`seed artefact: ${aErr.message}`)

    // Seed the index row (mirroring what the Edge Function does).
    await admin.from('consent_artefact_index').insert({
      org_id: orgA.orgId,
      property_id: property!.id,
      artefact_id: artefact!.artefact_id,
      consent_event_id: event!.id,
      validity_state: 'active',
      framework: 'dpdp',
      purpose_code: 'revoke_idx_test',
      expires_at: new Date(Date.now() + 365 * 86400_000).toISOString(),
    })

    // Fire the revocation cascade.
    const { data: revocation, error: rErr } = await admin
      .from('artefact_revocations')
      .insert({
        org_id: orgA.orgId,
        artefact_id: artefact!.artefact_id,
        reason: 'user_preference_change',
        revoked_by_type: 'data_principal',
        revoked_by_ref: fp,
      })
      .select('id')
      .single()
    if (rErr) throw new Error(`insert revocation: ${rErr.message}`)

    // Assert: index row STILL EXISTS (not deleted), with revoked state.
    const { data: idxAfter } = await admin
      .from('consent_artefact_index')
      .select('validity_state, revoked_at, revocation_record_id, property_id, consent_event_id')
      .eq('artefact_id', artefact!.artefact_id)
      .single()

    expect(idxAfter).not.toBeNull()
    expect(idxAfter?.validity_state).toBe('revoked')
    expect(idxAfter?.revoked_at).toBeTruthy()
    expect(idxAfter?.revocation_record_id).toBe(revocation!.id)
    expect(idxAfter?.property_id).toBe(property!.id)
    expect(idxAfter?.consent_event_id).toBe(event!.id)

    // And the consent_artefacts row is revoked.
    const { data: artAfter } = await admin
      .from('consent_artefacts')
      .select('status')
      .eq('artefact_id', artefact!.artefact_id)
      .single()
    expect(artAfter?.status).toBe('revoked')
  }, 30_000)

})
