import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { cleanupTestOrg, createTestOrg, getServiceClient, TestOrg } from './helpers'

// ADR-0048 follow-up — public.assert_org_not_suspended gate on compliance
// workflow RPCs (create_dpia_record, create_auditor_engagement, publish_dpia_record).
//
// Scope:
//   · Active org can call the write RPCs as usual.
//   · Setting org.status='suspended' causes writes to raise with org_suspended.
//   · Setting account.status='suspended' (with org still active) causes the
//     same raise via cascade check — account_suspended.
//   · Reading data still works during suspension (not tested here; trusted
//     from ADR-0046 tests which use active orgs).

let org: TestOrg
const service = getServiceClient()

beforeAll(async () => {
  org = await createTestOrg('suspGate')
}, 60000)

afterAll(async () => {
  await service.from('dpia_records').delete().eq('org_id', org.orgId)
  await service.from('data_auditor_engagements').delete().eq('org_id', org.orgId)
  // Reset to active before cleanup so cleanup doesn't trip over suspension guards
  await service.from('organisations').update({ status: 'active' }).eq('id', org.orgId)
  await service.from('accounts').update({ status: 'active' }).eq('id', org.accountId)
  await cleanupTestOrg(org)
}, 30000)

async function setOrgStatus(status: 'active' | 'suspended') {
  await service.from('organisations').update({ status }).eq('id', org.orgId)
}

async function setAccountStatus(status: 'active' | 'suspended' | 'trial' | 'past_due') {
  await service.from('accounts').update({ status }).eq('id', org.accountId)
}

describe('ADR-0048 follow-up — assert_org_not_suspended gate', () => {
  it('active org: create_dpia_record succeeds', async () => {
    await setOrgStatus('active')
    await setAccountStatus('active')
    const { error } = await org.client.rpc('create_dpia_record', {
      p_org_id: org.orgId,
      p_title: 'Pre-suspension DPIA',
      p_processing_description: 'Baseline DPIA created while org is active',
      p_data_categories: ['contact.email'],
      p_risk_level: 'low',
      p_mitigations: {},
      p_auditor_attestation_ref: null,
      p_auditor_name: null,
      p_conducted_at: '2026-04-01',
      p_next_review_at: null,
    })
    expect(error).toBeNull()
  })

  it('org suspended: create_dpia_record raises org_suspended', async () => {
    await setOrgStatus('suspended')
    await setAccountStatus('active')

    const { error } = await org.client.rpc('create_dpia_record', {
      p_org_id: org.orgId,
      p_title: 'Suspended DPIA',
      p_processing_description: 'Should not be allowed while org is suspended',
      p_data_categories: [],
      p_risk_level: 'low',
      p_mitigations: {},
      p_auditor_attestation_ref: null,
      p_auditor_name: null,
      p_conducted_at: '2026-04-01',
      p_next_review_at: null,
    })
    expect(error).not.toBeNull()
    expect(error!.message).toMatch(/org_suspended/)
  })

  it('account suspended: create_dpia_record raises account_suspended', async () => {
    await setOrgStatus('active')
    await setAccountStatus('suspended')

    const { error } = await org.client.rpc('create_dpia_record', {
      p_org_id: org.orgId,
      p_title: 'Account-suspended DPIA',
      p_processing_description: 'Should not be allowed while parent account is suspended',
      p_data_categories: [],
      p_risk_level: 'low',
      p_mitigations: {},
      p_auditor_attestation_ref: null,
      p_auditor_name: null,
      p_conducted_at: '2026-04-01',
      p_next_review_at: null,
    })
    expect(error).not.toBeNull()
    expect(error!.message).toMatch(/account_suspended/)
  })

  it('account suspended: create_auditor_engagement also raises', async () => {
    await setOrgStatus('active')
    await setAccountStatus('suspended')

    const { error } = await org.client.rpc('create_auditor_engagement', {
      p_org_id: org.orgId,
      p_auditor_name: 'Gated Firm',
      p_registration_category: 'ca_firm',
      p_registration_ref: null,
      p_scope: 'Should not go through while suspended',
      p_engagement_start: '2026-04-01',
      p_attestation_ref: null,
    })
    expect(error).not.toBeNull()
    expect(error!.message).toMatch(/account_suspended/)
  })

  it('post-restore: create_dpia_record works again', async () => {
    await setOrgStatus('active')
    await setAccountStatus('active')

    const { error } = await org.client.rpc('create_dpia_record', {
      p_org_id: org.orgId,
      p_title: 'Post-restore DPIA',
      p_processing_description: 'Suspension lifted; writes should resume',
      p_data_categories: [],
      p_risk_level: 'low',
      p_mitigations: {},
      p_auditor_attestation_ref: null,
      p_auditor_name: null,
      p_conducted_at: '2026-04-01',
      p_next_review_at: null,
    })
    expect(error).toBeNull()
  })
})
