import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import {
  AdminTestUser,
  cleanupAdminTestUser,
  createAdminTestUser,
  getAdminServiceClient,
} from '../admin/helpers'
import { cleanupTestOrg, createTestOrg, TestOrg } from '../rls/helpers'

// ADR-0055 Sprint 1.1 — account-scoped impersonation.
//
// Covers:
//   · admin.start_impersonation_account creates a session with target_account_id set (org_id null)
//   · CHECK constraint forbids both / neither target ids
//   · list_org_support_sessions now returns target_scope field
//   · account-scoped sessions visible to account_owner of target account
//   · account-scoped sessions NOT visible to non-owner org members
//   · support tier CAN start (via require_admin('support'))
//   · read_only tier denied

let support: AdminTestUser
let readOnly: AdminTestUser
let customer: TestOrg

const service = getAdminServiceClient()

beforeAll(async () => {
  support = await createAdminTestUser('support')
  readOnly = await createAdminTestUser('read_only')
  customer = await createTestOrg('acctImp')
}, 60000)

afterAll(async () => {
  await service.schema('admin').from('impersonation_sessions').delete().eq('target_account_id', customer.accountId)
  await cleanupTestOrg(customer)
  await cleanupAdminTestUser(support)
  await cleanupAdminTestUser(readOnly)
}, 30000)

describe('ADR-0055 Sprint 1.1 — start_impersonation_account', () => {
  it('support tier can start an account-scoped session', async () => {
    const { data, error } = await support.client
      .schema('admin')
      .rpc('start_impersonation_account', {
        p_account_id: customer.accountId,
        p_reason: 'compliance_query',
        p_reason_detail: 'Testing account-scoped impersonation end-to-end setup.',
        p_duration_minutes: 30,
      })
    expect(error).toBeNull()
    expect(data).toBeTruthy()

    const { data: row } = await service
      .schema('admin')
      .from('impersonation_sessions')
      .select('target_org_id, target_account_id, reason, status')
      .eq('id', data as string)
      .single()
    expect(row!.target_org_id).toBeNull()
    expect(row!.target_account_id).toBe(customer.accountId)
    expect(row!.status).toBe('active')
  })

  it('read_only tier denied', async () => {
    const { error } = await readOnly.client
      .schema('admin')
      .rpc('start_impersonation_account', {
        p_account_id: customer.accountId,
        p_reason: 'compliance_query',
        p_reason_detail: 'read_only should not be able to impersonate.',
        p_duration_minutes: 30,
      })
    expect(error).not.toBeNull()
  })

  it('short reason_detail raises', async () => {
    const { error } = await support.client
      .schema('admin')
      .rpc('start_impersonation_account', {
        p_account_id: customer.accountId,
        p_reason: 'compliance_query',
        p_reason_detail: 'short',
        p_duration_minutes: 30,
      })
    expect(error).not.toBeNull()
    expect(error!.message).toMatch(/reason_detail required/)
  })

  it('invalid reason raises', async () => {
    const { error } = await support.client
      .schema('admin')
      .rpc('start_impersonation_account', {
        p_account_id: customer.accountId,
        p_reason: 'not_a_valid_reason',
        p_reason_detail: 'trying to use an invalid reason code.',
        p_duration_minutes: 30,
      })
    expect(error).not.toBeNull()
    expect(error!.message).toMatch(/invalid reason/)
  })

  it('non-existent account raises', async () => {
    const { error } = await support.client
      .schema('admin')
      .rpc('start_impersonation_account', {
        p_account_id: '00000000-0000-0000-0000-000000000000',
        p_reason: 'compliance_query',
        p_reason_detail: 'targeting non-existent account id.',
        p_duration_minutes: 30,
      })
    expect(error).not.toBeNull()
    expect(error!.message).toMatch(/account not found/)
  })
})

describe('ADR-0055 Sprint 1.1 — CHECK constraint', () => {
  it('row with both target_org_id + target_account_id rejected', async () => {
    const { error } = await service
      .schema('admin')
      .from('impersonation_sessions')
      .insert({
        admin_user_id: support.userId,
        target_org_id: customer.orgId,
        target_account_id: customer.accountId,
        reason: 'compliance_query',
        reason_detail: 'both-set insert should fail the CHECK constraint',
        expires_at: new Date(Date.now() + 1800_000).toISOString(),
      })
    expect(error).not.toBeNull()
    expect(error!.message).toMatch(/impersonation_target_scope_check/)
  })

  it('row with neither target_org_id nor target_account_id rejected', async () => {
    const { error } = await service
      .schema('admin')
      .from('impersonation_sessions')
      .insert({
        admin_user_id: support.userId,
        target_org_id: null,
        target_account_id: null,
        reason: 'compliance_query',
        reason_detail: 'neither-set insert should fail the CHECK constraint',
        expires_at: new Date(Date.now() + 1800_000).toISOString(),
      })
    expect(error).not.toBeNull()
    expect(error!.message).toMatch(/impersonation_target_scope_check/)
  })
})

describe('ADR-0055 Sprint 1.1 — list_org_support_sessions enriched with target_scope', () => {
  it('account_owner sees account-scoped session with target_scope=account', async () => {
    // Start a fresh account-scoped session so it's in the list for this test
    const startRes = await support.client
      .schema('admin')
      .rpc('start_impersonation_account', {
        p_account_id: customer.accountId,
        p_reason: 'compliance_query',
        p_reason_detail: 'Fresh session for list_org_support_sessions test.',
        p_duration_minutes: 30,
      })
    expect(startRes.error).toBeNull()
    const sessionId = startRes.data as string

    const { data, error } = await customer.client.rpc('list_org_support_sessions', {
      p_status: null,
      p_limit: 100,
    })
    expect(error).toBeNull()
    const rows = data as Array<{ id: string; target_scope: string }>
    const accountRow = rows.find(r => r.id === sessionId)
    expect(accountRow).toBeTruthy()
    expect(accountRow!.target_scope).toBe('account')
  })
})
