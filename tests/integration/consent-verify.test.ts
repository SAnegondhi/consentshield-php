// ADR-1002 Sprint 1.2 — /v1/consent/verify integration tests.
//
// Exercises verifyConsent() end-to-end against the live DB:
//   granted | revoked | expired | never_consented statuses
//   property_not_found  (404)
//   invalid_identifier  (422)
//   unknown type        (422)
//   identifier_type mismatch (returns never_consented — hash differs)
//
// No running dev server required. The helper hits rpc_consent_verify
// directly via the service-role client, same as the route handler does.

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { verifyConsent } from '../../app/src/lib/consent/verify'
import {
  createTestOrg,
  cleanupTestOrg,
  getServiceClient,
  seedApiKey,
  type TestOrg,
} from '../rls/helpers'

interface Fixture {
  propertyId: string
  grantedIdentifier: string    // email that maps to an active artefact
  revokedIdentifier: string    // email whose artefact was revoked
  expiredIdentifier: string    // email whose artefact is past expires_at
  purposeCode: string
  grantedArtefactId: string
  revokedArtefactId: string
  revocationRecordId: string
}

let org: TestOrg
let otherOrg: TestOrg
let f: Fixture
let keyId: string
let otherKeyId: string

const PURPOSE_CODE = 'verify_test_marketing'

// Helper: seed the full chain (property → banner → purpose → event → artefact → index)
// and return the pieces the test needs. No Edge Function involvement —
// we write directly so the fixture is deterministic.
async function seedArtefact(
  targetOrg: TestOrg,
  propertyId: string,
  bannerId: string,
  purposeDefinitionId: string,
  identifier: string,
  identifierType: 'email',
  validityState: 'active' | 'revoked' | 'expired',
  expiresAtIso: string,
): Promise<{ artefactId: string; indexRowId: string }> {
  const admin = getServiceClient()

  const { data: hashData, error: hashErr } = await admin.rpc('hash_data_principal_identifier', {
    p_org_id:          targetOrg.orgId,
    p_identifier:      identifier,
    p_identifier_type: identifierType,
  })
  if (hashErr) throw new Error(`hash: ${hashErr.message}`)
  const identifierHash = hashData as string

  const fp = `verify-${validityState}-${Date.now()}-${Math.random()}`
  const { data: event, error: eErr } = await admin
    .from('consent_events')
    .insert({
      org_id: targetOrg.orgId,
      property_id: propertyId,
      banner_id: bannerId,
      banner_version: 1,
      session_fingerprint: fp,
      event_type: 'accept',
      purposes_accepted: [{ purpose_definition_id: purposeDefinitionId, purpose_code: PURPOSE_CODE }],
      purposes_rejected: [],
    })
    .select('id')
    .single()
  if (eErr) throw new Error(`event: ${eErr.message}`)

  const { data: artefact, error: aErr } = await admin
    .from('consent_artefacts')
    .insert({
      org_id: targetOrg.orgId,
      property_id: propertyId,
      banner_id: bannerId,
      banner_version: 1,
      consent_event_id: event!.id,
      session_fingerprint: fp,
      purpose_definition_id: purposeDefinitionId,
      purpose_code: PURPOSE_CODE,
      data_scope: ['email_address'],
      framework: 'dpdp',
      expires_at: expiresAtIso,
    })
    .select('artefact_id')
    .single()
  if (aErr) throw new Error(`artefact: ${aErr.message}`)

  const { data: idxRow, error: iErr } = await admin
    .from('consent_artefact_index')
    .insert({
      org_id:           targetOrg.orgId,
      property_id:      propertyId,
      artefact_id:      artefact!.artefact_id,
      consent_event_id: event!.id,
      identifier_hash:  identifierHash,
      identifier_type:  identifierType,
      validity_state:   validityState === 'revoked' ? 'active' : validityState,
      framework:        'dpdp',
      purpose_code:     PURPOSE_CODE,
      expires_at:       expiresAtIso,
    })
    .select('id')
    .single()
  if (iErr) throw new Error(`index: ${iErr.message}`)

  return { artefactId: artefact!.artefact_id, indexRowId: idxRow!.id }
}

beforeAll(async () => {
  org = await createTestOrg('vfyMain')
  otherOrg = await createTestOrg('vfyOther')
  keyId = (await seedApiKey(org)).keyId
  otherKeyId = (await seedApiKey(otherOrg)).keyId
  const admin = getServiceClient()

  // Property + banner
  const { data: property } = await admin
    .from('web_properties')
    .insert({ org_id: org.orgId, name: 'verify prop', url: `https://verify-${Date.now()}.test` })
    .select('id')
    .single()

  const { data: banner } = await admin
    .from('consent_banners')
    .insert({
      org_id: org.orgId,
      property_id: property!.id,
      version: 1,
      headline: 'Test',
      body_copy: 'Test body',
      purposes: [],
      is_active: true,
    })
    .select('id')
    .single()

  const { data: purpose } = await admin
    .from('purpose_definitions')
    .insert({
      org_id: org.orgId,
      purpose_code: PURPOSE_CODE,
      display_name: 'Verify test marketing',
      description: 'ADR-1002 Sprint 1.2 test purpose',
      data_scope: ['email_address'],
      default_expiry_days: 365,
      framework: 'dpdp',
    })
    .select('id')
    .single()

  // Three artefacts covering three of four verify states.
  // Unique emails per state, timestamped to avoid collisions across test runs.
  const stamp = Date.now()
  const grantedEmail = `granted-${stamp}@verify.test`
  const revokedEmail = `revoked-${stamp}@verify.test`
  const expiredEmail = `expired-${stamp}@verify.test`

  const granted = await seedArtefact(
    org,
    property!.id,
    banner!.id,
    purpose!.id,
    grantedEmail,
    'email',
    'active',
    new Date(Date.now() + 365 * 86400_000).toISOString(),
  )
  const revokedSeed = await seedArtefact(
    org,
    property!.id,
    banner!.id,
    purpose!.id,
    revokedEmail,
    'email',
    'revoked',
    new Date(Date.now() + 365 * 86400_000).toISOString(),
  )
  const expired = await seedArtefact(
    org,
    property!.id,
    banner!.id,
    purpose!.id,
    expiredEmail,
    'email',
    'active',
    new Date(Date.now() - 86400_000).toISOString(), // yesterday — active row, past expires_at
  )

  // Revoke revokedSeed via artefact_revocations — this fires the cascade
  // trigger that flips the index row to validity_state='revoked' and
  // stamps revocation_record_id.
  const { data: revocation } = await admin
    .from('artefact_revocations')
    .insert({
      org_id: org.orgId,
      artefact_id: revokedSeed.artefactId,
      reason: 'user_preference_change',
      revoked_by_type: 'data_principal',
      revoked_by_ref: revokedEmail,
    })
    .select('id')
    .single()

  f = {
    propertyId: property!.id,
    grantedIdentifier: grantedEmail,
    revokedIdentifier: revokedEmail,
    expiredIdentifier: expiredEmail,
    purposeCode: PURPOSE_CODE,
    grantedArtefactId: granted.artefactId,
    revokedArtefactId: revokedSeed.artefactId,
    revocationRecordId: revocation!.id,
  }
}, 90_000)

afterAll(async () => {
  await cleanupTestOrg(org)
  await cleanupTestOrg(otherOrg)
}, 30_000)

// ═══════════════════════════════════════════════════════════
// Four status states
// ═══════════════════════════════════════════════════════════

describe('verifyConsent — four status states', () => {

  it('granted — active row with future expires_at', async () => {
    const r = await verifyConsent({
      keyId,
      orgId:          org.orgId,
      propertyId:     f.propertyId,
      identifier:     f.grantedIdentifier,
      identifierType: 'email',
      purposeCode:    f.purposeCode,
    })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.data.status).toBe('granted')
    expect(r.data.active_artefact_id).toBe(f.grantedArtefactId)
    expect(r.data.revoked_at).toBeNull()
    expect(r.data.revocation_record_id).toBeNull()
    expect(r.data.expires_at).toBeTruthy()
    expect(new Date(r.data.expires_at!).getTime()).toBeGreaterThan(Date.now())
    expect(r.data.property_id).toBe(f.propertyId)
    expect(r.data.identifier_type).toBe('email')
    expect(r.data.purpose_code).toBe(f.purposeCode)
    // evaluated_at is server-side ISO within the last 5 seconds.
    const age = Date.now() - new Date(r.data.evaluated_at).getTime()
    expect(age).toBeGreaterThanOrEqual(0)
    expect(age).toBeLessThan(5000)
  })

  it('revoked — index row preserved, returns pointer to artefact_revocations', async () => {
    const r = await verifyConsent({
      keyId,
      orgId:          org.orgId,
      propertyId:     f.propertyId,
      identifier:     f.revokedIdentifier,
      identifierType: 'email',
      purposeCode:    f.purposeCode,
    })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.data.status).toBe('revoked')
    expect(r.data.active_artefact_id).toBeNull()
    expect(r.data.revoked_at).toBeTruthy()
    expect(r.data.revocation_record_id).toBe(f.revocationRecordId)
  })

  it('expired — active row with past expires_at reports expired', async () => {
    const r = await verifyConsent({
      keyId,
      orgId:          org.orgId,
      propertyId:     f.propertyId,
      identifier:     f.expiredIdentifier,
      identifierType: 'email',
      purposeCode:    f.purposeCode,
    })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.data.status).toBe('expired')
    expect(r.data.active_artefact_id).toBeNull()
    expect(new Date(r.data.expires_at!).getTime()).toBeLessThan(Date.now())
  })

  it('never_consented — no matching row', async () => {
    const r = await verifyConsent({
      keyId,
      orgId:          org.orgId,
      propertyId:     f.propertyId,
      identifier:     `nobody-${Date.now()}@verify.test`,
      identifierType: 'email',
      purposeCode:    f.purposeCode,
    })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.data.status).toBe('never_consented')
    expect(r.data.active_artefact_id).toBeNull()
    expect(r.data.revoked_at).toBeNull()
    expect(r.data.expires_at).toBeNull()
  })

})

// ═══════════════════════════════════════════════════════════
// Error cases
// ═══════════════════════════════════════════════════════════

describe('verifyConsent — errors', () => {

  it('property_not_found when property belongs to a different org', async () => {
    // Create a property in otherOrg, try to verify against it using org.
    const admin = getServiceClient()
    const { data: otherProp } = await admin
      .from('web_properties')
      .insert({ org_id: otherOrg.orgId, name: 'other', url: `https://other-${Date.now()}.test` })
      .select('id')
      .single()

    const r = await verifyConsent({
      keyId,
      orgId:          org.orgId,
      propertyId:     otherProp!.id,
      identifier:     f.grantedIdentifier,
      identifierType: 'email',
      purposeCode:    f.purposeCode,
    })
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.error.kind).toBe('property_not_found')
  })

  it('invalid_identifier when identifier is empty', async () => {
    const r = await verifyConsent({
      keyId,
      orgId:          org.orgId,
      propertyId:     f.propertyId,
      identifier:     '',
      identifierType: 'email',
      purposeCode:    f.purposeCode,
    })
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.error.kind).toBe('invalid_identifier')
  })

  it('invalid_identifier for unknown identifier_type', async () => {
    const r = await verifyConsent({
      keyId,
      orgId:          org.orgId,
      propertyId:     f.propertyId,
      identifier:     'user@example.com',
      identifierType: 'passport',
      purposeCode:    f.purposeCode,
    })
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.error.kind).toBe('invalid_identifier')
  })

  it('identifier_type mismatch yields never_consented (different hash)', async () => {
    // Same identifier string but queried as phone — the email was hashed
    // with type='email' (trim+lowercase). Queried with type='phone'
    // (digits-only), the timestamp digits in the email string produce a
    // valid but different hash. No match → never_consented.
    const r = await verifyConsent({
      keyId,
      orgId:          org.orgId,
      propertyId:     f.propertyId,
      identifier:     f.grantedIdentifier,
      identifierType: 'phone',
      purposeCode:    f.purposeCode,
    })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.data.status).toBe('never_consented')
  })

  it('ADR-1009 fence: org-bound key + p_org_id=otherOrg → api_key_binding', async () => {
    const r = await verifyConsent({
      keyId,                        // key bound to org
      orgId:          otherOrg.orgId, // caller tries to pretend they're otherOrg
      propertyId:     f.propertyId,
      identifier:     f.grantedIdentifier,
      identifierType: 'email',
      purposeCode:    f.purposeCode,
    })
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.error.kind).toBe('api_key_binding')
  })

  it('cross-org isolation: identifier granted in org A returns never_consented in org B (different salt)', async () => {
    const admin = getServiceClient()
    const { data: otherProp } = await admin
      .from('web_properties')
      .insert({ org_id: otherOrg.orgId, name: 'xorg', url: `https://xorg-${Date.now()}.test` })
      .select('id')
      .single()

    const r = await verifyConsent({
      keyId:          otherKeyId,
      orgId:          otherOrg.orgId,
      propertyId:     otherProp!.id,
      identifier:     f.grantedIdentifier, // same string granted in org, but different salt in otherOrg
      identifierType: 'email',
      purposeCode:    f.purposeCode,
    })
    // Property-in-org check passes (otherProp belongs to otherOrg).
    // Hash is different across orgs → no match → never_consented.
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.data.status).toBe('never_consented')
  })

})
