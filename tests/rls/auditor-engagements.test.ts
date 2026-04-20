import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { cleanupTestOrg, createTestOrg, getServiceClient, TestOrg } from './helpers'

// ADR-0046 Phase 3 — Data Auditor Engagements CRUD + lifecycle.
//
// Tests:
//   · org_admin can create / complete / terminate / update engagements
//   · cross-org: orgB cannot create engagement for orgA (access_denied)
//   · cross-org RLS: orgA sees only own engagements
//   · complete lifecycle: active → completed (engagement_end + attestation)
//   · terminate lifecycle: active → terminated (requires reason)
//   · terminated rows cannot be updated
//   · can't complete from terminated

let orgA: TestOrg
let orgB: TestOrg
const service = getServiceClient()
let engagementActiveId: string
let engagementCompletedId: string
let engagementTerminatedId: string

beforeAll(async () => {
  orgA = await createTestOrg('audA')
  orgB = await createTestOrg('audB')
}, 60000)

afterAll(async () => {
  await service.from('data_auditor_engagements').delete().in('org_id', [orgA.orgId, orgB.orgId])
  await cleanupTestOrg(orgA)
  await cleanupTestOrg(orgB)
}, 30000)

async function createEngagement(
  client: TestOrg['client'],
  orgId: string,
  auditor = 'KPMG India',
  startDate = '2026-01-01',
) {
  return client.rpc('create_auditor_engagement', {
    p_org_id: orgId,
    p_auditor_name: auditor,
    p_registration_category: 'ca_firm',
    p_registration_ref: 'https://icai.org/member/12345',
    p_scope: 'Annual DPDP compliance audit for FY 2025-26',
    p_engagement_start: startDate,
    p_attestation_ref: null,
  })
}

describe('ADR-0046 Phase 3 — create_auditor_engagement', () => {
  it('org_admin can create an engagement', async () => {
    const { data, error } = await createEngagement(orgA.client, orgA.orgId)
    expect(error).toBeNull()
    expect(data).toBeTruthy()
    engagementActiveId = data as string
  })

  it('starts with status=active', async () => {
    const { data } = await orgA.client
      .from('data_auditor_engagements')
      .select('status, auditor_name, registration_category')
      .eq('id', engagementActiveId)
      .single()
    expect(data!.status).toBe('active')
    expect(data!.auditor_name).toBe('KPMG India')
    expect(data!.registration_category).toBe('ca_firm')
  })

  it('orgB cannot create engagement for orgA', async () => {
    const { error } = await createEngagement(orgB.client, orgA.orgId)
    expect(error).not.toBeNull()
    expect(error!.message).toMatch(/access_denied/)
  })

  it('cross-org read isolation — orgB does not see orgA rows', async () => {
    // Seed an orgB engagement
    const seed = await createEngagement(orgB.client, orgB.orgId, 'Deloitte')
    const orgBId = seed.data as string

    const { data: aRows } = await orgA.client.from('data_auditor_engagements').select('id, org_id')
    const ids = (aRows ?? []).map((r: { id: string }) => r.id)
    expect(ids).toContain(engagementActiveId)
    expect(ids).not.toContain(orgBId)
  })
})

describe('ADR-0046 Phase 3 — complete_auditor_engagement', () => {
  it('active → completed with end date + attestation', async () => {
    // Create a fresh engagement to complete
    const res = await createEngagement(orgA.client, orgA.orgId, 'Completer Firm')
    engagementCompletedId = res.data as string

    const { error } = await orgA.client.rpc('complete_auditor_engagement', {
      p_id: engagementCompletedId,
      p_engagement_end: '2026-03-31',
      p_attestation_ref: 'https://acme.in/audits/2025-26/final-report.pdf',
    })
    expect(error).toBeNull()

    const { data } = await orgA.client
      .from('data_auditor_engagements')
      .select('status, engagement_end, attestation_ref')
      .eq('id', engagementCompletedId)
      .single()
    expect(data!.status).toBe('completed')
    expect(data!.engagement_end).toBe('2026-03-31')
    expect(data!.attestation_ref).toContain('final-report.pdf')
  })

  it('already-completed cannot be completed again', async () => {
    const { error } = await orgA.client.rpc('complete_auditor_engagement', {
      p_id: engagementCompletedId,
      p_engagement_end: '2026-04-30',
      p_attestation_ref: null,
    })
    expect(error).not.toBeNull()
    expect(error!.message).toMatch(/cannot_complete_from_status/)
  })

  it('engagement_end before engagement_start raises', async () => {
    const seed = await createEngagement(orgA.client, orgA.orgId, 'Bad Dates Firm', '2026-06-01')
    const badId = seed.data as string

    const { error } = await orgA.client.rpc('complete_auditor_engagement', {
      p_id: badId,
      p_engagement_end: '2026-03-01',
      p_attestation_ref: null,
    })
    expect(error).not.toBeNull()
    expect(error!.message).toMatch(/engagement_end/)
  })
})

describe('ADR-0046 Phase 3 — terminate_auditor_engagement', () => {
  it('active → terminated with reason', async () => {
    const res = await createEngagement(orgA.client, orgA.orgId, 'Terminate Firm')
    engagementTerminatedId = res.data as string

    const { error } = await orgA.client.rpc('terminate_auditor_engagement', {
      p_id: engagementTerminatedId,
      p_engagement_end: '2026-02-15',
      p_reason: 'Scope misalignment — firm not DPDP-qualified',
    })
    expect(error).toBeNull()

    const { data } = await orgA.client
      .from('data_auditor_engagements')
      .select('status, terminated_reason')
      .eq('id', engagementTerminatedId)
      .single()
    expect(data!.status).toBe('terminated')
    expect(data!.terminated_reason).toMatch(/Scope/)
  })

  it('reason required (short reason raises)', async () => {
    const res = await createEngagement(orgA.client, orgA.orgId, 'No-reason Firm')
    const noReasonId = res.data as string

    const { error } = await orgA.client.rpc('terminate_auditor_engagement', {
      p_id: noReasonId,
      p_engagement_end: '2026-02-15',
      p_reason: 'x',
    })
    expect(error).not.toBeNull()
    expect(error!.message).toMatch(/reason/)
  })
})

describe('ADR-0046 Phase 3 — update_auditor_engagement', () => {
  it('update scope + notes on active row', async () => {
    const res = await createEngagement(orgA.client, orgA.orgId, 'Update Firm')
    const updId = res.data as string

    const { error } = await orgA.client.rpc('update_auditor_engagement', {
      p_id: updId,
      p_scope: 'Updated scope description — now includes quarterly DPIA reviews',
      p_notes: 'Kick-off meeting on 2026-01-20',
      p_attestation_ref: null,
    })
    expect(error).toBeNull()

    const { data } = await orgA.client
      .from('data_auditor_engagements')
      .select('scope, notes')
      .eq('id', updId)
      .single()
    expect(data!.scope).toMatch(/Updated scope/)
    expect(data!.notes).toMatch(/Kick-off/)
  })

  it('cannot update terminated row', async () => {
    const { error } = await orgA.client.rpc('update_auditor_engagement', {
      p_id: engagementTerminatedId,
      p_scope: 'trying to update',
      p_notes: null,
      p_attestation_ref: null,
    })
    expect(error).not.toBeNull()
    expect(error!.message).toMatch(/cannot_update_terminated/)
  })
})
