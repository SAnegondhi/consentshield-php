import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  cleanupTestOrg,
  createTestOrg,
  getServiceClient,
  type TestOrg,
} from '../rls/helpers'

// ADR-1004 Phase 2 Sprint 2.3 — replaced_by chain + reconsent_campaigns
// pipeline integration test.
//
// Scenario:
//   1. Publish notice v1.
//   2. Seed an active artefact A linked to a v1 consent event.
//   3. Publish notice v2 (material).
//   4. Seed another consent event with notice_version=2 + a new artefact B
//      for the SAME (property, fingerprint, purpose).
//   5. Call mark_replaced_artefacts_for_event(v2_event_id).
//   6. Assert A.status='replaced', A.replaced_by=B.artefact_id.
//   7. Call refresh_reconsent_campaign(v2_notice_id).
//   8. Assert reconsent_campaigns row: responded_count=1, no_response_count=0.
//
// This bypasses the Edge Function entirely — we call the underlying
// helper directly. The Edge Function is wired (process-consent-event:
// after consent_artefacts insert it calls this same RPC), but proving
// it from a test would require deploying the Edge Function each time;
// the Edge-Function-side wiring is structural (one .rpc call) and
// catching bugs there is mostly TypeScript's job.

const admin = getServiceClient()
const tag = `nrb-${Date.now()}`
let org: TestOrg
let propertyId: string
let bannerId: string
let purposeDefId: string
let purposeCode: string

beforeAll(async () => {
  org = await createTestOrg(tag)

  const { data: prop } = await admin
    .from('web_properties')
    .insert({
      org_id: org.orgId,
      name: 'replaced-by fixture',
      url: `https://${tag}.test`,
    })
    .select('id')
    .single()
  propertyId = (prop as { id: string }).id

  const { data: banner } = await admin
    .from('consent_banners')
    .insert({
      org_id: org.orgId,
      property_id: propertyId,
      version: 1,
      is_active: true,
      headline: 'rb',
      body_copy: 'rb',
      purposes: [],
    })
    .select('id')
    .single()
  bannerId = (banner as { id: string }).id

  purposeCode = `pc_${tag}`
  const { data: pd } = await admin
    .from('purpose_definitions')
    .insert({
      org_id: org.orgId,
      purpose_code: purposeCode,
      display_name: purposeCode,
      description: 'rb test',
      data_scope: ['email_address'],
      default_expiry_days: 365,
      framework: 'dpdp',
    })
    .select('id')
    .single()
  purposeDefId = (pd as { id: string }).id

  // Publish v1 (routine).
  await org.client.rpc('publish_notice', {
    p_org_id: org.orgId,
    p_title: 'v1 baseline',
    p_body_markdown: 'baseline notice text — at least ten chars',
    p_material_change_flag: false,
  })
})

afterAll(async () => {
  if (org) await cleanupTestOrg(org)
})

describe('ADR-1004 P2 S2.3 — mark_replaced_artefacts_for_event', () => {
  let v1EventId: string
  let v1ArtefactId: string
  let v2NoticeId: string
  let v2EventId: string
  let v2ArtefactId: string
  const fingerprint = `fp-${tag}`

  it('seed v1: insert consent_event with notice_version=1 + an artefact', async () => {
    const { data: ev } = await admin
      .from('consent_events')
      .insert({
        org_id: org.orgId,
        property_id: propertyId,
        banner_id: bannerId,
        banner_version: 1,
        session_fingerprint: fingerprint,
        event_type: 'consent_recorded',
        notice_version: 1,
      })
      .select('id')
      .single()
    v1EventId = (ev as { id: string }).id

    const { data: art } = await admin
      .from('consent_artefacts')
      .insert({
        org_id: org.orgId,
        property_id: propertyId,
        banner_id: bannerId,
        banner_version: 1,
        consent_event_id: v1EventId,
        session_fingerprint: fingerprint,
        purpose_definition_id: purposeDefId,
        purpose_code: purposeCode,
        data_scope: ['email_address'],
        framework: 'dpdp',
        expires_at: new Date(Date.now() + 365 * 86_400_000).toISOString(),
      })
      .select('artefact_id, status')
      .single()
    v1ArtefactId = (art as { artefact_id: string }).artefact_id
    expect((art as { status: string }).status).toBe('active')
  })

  it('publish v2 (material) and assert affected_artefact_count = 1', async () => {
    const { data: notice } = await org.client.rpc('publish_notice', {
      p_org_id: org.orgId,
      p_title: 'v2 material — adds a partner',
      p_body_markdown: 'v2 material change adds bajaj finserv as an emi partner',
      p_material_change_flag: true,
    })
    const v2 = notice as {
      id: string
      version: number
      material_change_flag: boolean
      affected_artefact_count: number
    }
    v2NoticeId = v2.id
    expect(v2.version).toBe(2)
    expect(v2.material_change_flag).toBe(true)
    expect(v2.affected_artefact_count).toBe(1)
  })

  it('seed v2 event + artefact for the same principal, then call mark_replaced', async () => {
    const { data: ev } = await admin
      .from('consent_events')
      .insert({
        org_id: org.orgId,
        property_id: propertyId,
        banner_id: bannerId,
        banner_version: 1,
        session_fingerprint: fingerprint,
        event_type: 'consent_recorded',
        notice_version: 2,
      })
      .select('id')
      .single()
    v2EventId = (ev as { id: string }).id

    const { data: art } = await admin
      .from('consent_artefacts')
      .insert({
        org_id: org.orgId,
        property_id: propertyId,
        banner_id: bannerId,
        banner_version: 1,
        consent_event_id: v2EventId,
        session_fingerprint: fingerprint,
        purpose_definition_id: purposeDefId,
        purpose_code: purposeCode,
        data_scope: ['email_address'],
        framework: 'dpdp',
        expires_at: new Date(Date.now() + 365 * 86_400_000).toISOString(),
      })
      .select('artefact_id')
      .single()
    v2ArtefactId = (art as { artefact_id: string }).artefact_id

    const { data: replaced, error } = await admin.rpc('mark_replaced_artefacts_for_event', {
      p_consent_event_id: v2EventId,
    })
    expect(error).toBeNull()
    expect(replaced).toBe(1)

    const { data: v1Now } = await admin
      .from('consent_artefacts')
      .select('status, replaced_by')
      .eq('artefact_id', v1ArtefactId)
      .single()
    const row = v1Now as { status: string; replaced_by: string | null }
    expect(row.status).toBe('replaced')
    expect(row.replaced_by).toBe(v2ArtefactId)
  })

  it('refresh_reconsent_campaign returns responded=1, no_response=0', async () => {
    const { data, error } = await admin.rpc('refresh_reconsent_campaign', {
      p_notice_id: v2NoticeId,
    })
    expect(error).toBeNull()
    const row = data as {
      affected_count: number
      responded_count: number
      revoked_count: number
      no_response_count: number
    }
    expect(row.affected_count).toBe(1)
    expect(row.responded_count).toBe(1)
    expect(row.revoked_count).toBe(0)
    expect(row.no_response_count).toBe(0)
  })

  it('rpc_notice_affected_artefacts returns the chained pair', async () => {
    const { data, error } = await admin.rpc('rpc_notice_affected_artefacts', {
      p_org_id: org.orgId,
      p_notice_id: v2NoticeId,
      p_limit: 50,
    })
    expect(error).toBeNull()
    const rows = data as Array<{ artefact_id: string; status: string; replaced_by: string | null }>
    expect(rows).toHaveLength(1)
    expect(rows[0].artefact_id).toBe(v1ArtefactId)
    expect(rows[0].status).toBe('replaced')
    expect(rows[0].replaced_by).toBe(v2ArtefactId)
  })

  it('mark_replaced is idempotent — re-running finds nothing new', async () => {
    const { data: again } = await admin.rpc('mark_replaced_artefacts_for_event', {
      p_consent_event_id: v2EventId,
    })
    expect(again).toBe(0)
  })

  it('refuses cross-org notice access', async () => {
    const { error } = await admin.rpc('rpc_notice_affected_artefacts', {
      p_org_id: '00000000-0000-0000-0000-000000000000',
      p_notice_id: v2NoticeId,
      p_limit: 50,
    })
    expect(error).not.toBeNull()
    expect(error!.message).toMatch(/org_mismatch/i)
  })
})
