import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  AdminTestUser,
  cleanupAdminTestUser,
  createAdminTestUser,
  getAdminServiceClient,
} from './helpers'
import { cleanupTestOrg, createTestOrg, TestOrg } from '../rls/helpers'

// ADR-0046 Phase 1 Sprint 1.1 — SDF foundation RPC.
//
// Exercises admin.set_sdf_status: happy paths (declare / notify /
// revert), guards (unknown value, short reason, missing org, role
// check), and the audit-log invariant.

const service = getAdminServiceClient()

async function countAuditRows(action: string, adminUserId: string) {
  const { count } = await service
    .schema('admin')
    .from('admin_audit_log')
    .select('*', { count: 'exact', head: true })
    .eq('action', action)
    .eq('admin_user_id', adminUserId)
  return count ?? 0
}

let opA: AdminTestUser
let supportUser: AdminTestUser
let customer: TestOrg

beforeAll(async () => {
  opA = await createAdminTestUser('platform_operator')
  supportUser = await createAdminTestUser('support')
  customer = await createTestOrg('sdf')
})

afterAll(async () => {
  if (opA) await cleanupAdminTestUser(opA)
  if (supportUser) await cleanupAdminTestUser(supportUser)
  if (customer) await cleanupTestOrg(customer)
})

describe('ADR-0046 Phase 1 Sprint 1.1 — admin.set_sdf_status', () => {
  it('platform_operator can mark self_declared; writes audit row', async () => {
    const before = await countAuditRows('set_sdf_status', opA.userId)
    const { error } = await opA.client.schema('admin').rpc('set_sdf_status', {
      p_org_id: customer.orgId,
      p_sdf_status: 'self_declared',
      p_sdf_notification_ref: null,
      p_sdf_notified_at: null,
      p_reason: 'Customer voluntarily claims SDF for their BFSI division',
    })
    expect(error).toBeNull()

    const { data: org } = await service
      .from('organisations')
      .select('sdf_status, sdf_notified_at, sdf_notification_ref')
      .eq('id', customer.orgId)
      .maybeSingle()
    expect(org?.sdf_status).toBe('self_declared')
    expect(org?.sdf_notified_at).toBeNull()
    expect(org?.sdf_notification_ref).toBeNull()

    const after = await countAuditRows('set_sdf_status', opA.userId)
    expect(after).toBe(before + 1)
  })

  it('accepts notified with notification metadata', async () => {
    const notifiedAt = new Date('2026-04-10T00:00:00Z').toISOString()
    const { error } = await opA.client.schema('admin').rpc('set_sdf_status', {
      p_org_id: customer.orgId,
      p_sdf_status: 'notified',
      p_sdf_notification_ref: 'G.S.R. 123(E) 2026-04-10',
      p_sdf_notified_at: notifiedAt,
      p_reason: 'Gazette notification received; updating org state',
    })
    expect(error).toBeNull()

    const { data: org } = await service
      .from('organisations')
      .select('sdf_status, sdf_notified_at, sdf_notification_ref')
      .eq('id', customer.orgId)
      .maybeSingle()
    expect(org?.sdf_status).toBe('notified')
    expect(org?.sdf_notification_ref).toMatch(/G\.S\.R\. 123/)
    expect(new Date(org!.sdf_notified_at).toISOString()).toBe(notifiedAt)
  })

  it('reverting to not_designated clears notification metadata', async () => {
    const { error } = await opA.client.schema('admin').rpc('set_sdf_status', {
      p_org_id: customer.orgId,
      p_sdf_status: 'not_designated',
      p_sdf_notification_ref: 'should be ignored',
      p_sdf_notified_at: new Date().toISOString(),
      p_reason: 'Reverting SDF status after gazette correction',
    })
    expect(error).toBeNull()

    const { data: org } = await service
      .from('organisations')
      .select('sdf_status, sdf_notified_at, sdf_notification_ref')
      .eq('id', customer.orgId)
      .maybeSingle()
    expect(org?.sdf_status).toBe('not_designated')
    expect(org?.sdf_notified_at).toBeNull()
    expect(org?.sdf_notification_ref).toBeNull()
  })

  it('rejects unknown sdf_status value', async () => {
    const { error } = await opA.client.schema('admin').rpc('set_sdf_status', {
      p_org_id: customer.orgId,
      p_sdf_status: 'gazetted', // not in the enum
      p_sdf_notification_ref: null,
      p_sdf_notified_at: null,
      p_reason: 'should fail — unknown value',
    })
    expect(error).not.toBeNull()
  })

  it('rejects reason < 10 chars', async () => {
    const { error } = await opA.client.schema('admin').rpc('set_sdf_status', {
      p_org_id: customer.orgId,
      p_sdf_status: 'self_declared',
      p_sdf_notification_ref: null,
      p_sdf_notified_at: null,
      p_reason: 'short',
    })
    expect(error).not.toBeNull()
  })

  it('rejects missing org', async () => {
    const { error } = await opA.client.schema('admin').rpc('set_sdf_status', {
      p_org_id: '00000000-0000-0000-0000-000000000000',
      p_sdf_status: 'self_declared',
      p_sdf_notification_ref: null,
      p_sdf_notified_at: null,
      p_reason: 'org not found check',
    })
    expect(error).not.toBeNull()
    expect(error?.message).toMatch(/org not found/i)
  })

  it('support role is denied', async () => {
    const { error } = await supportUser.client
      .schema('admin')
      .rpc('set_sdf_status', {
        p_org_id: customer.orgId,
        p_sdf_status: 'self_declared',
        p_sdf_notification_ref: null,
        p_sdf_notified_at: null,
        p_reason: 'support should not be able to set SDF status',
      })
    expect(error).not.toBeNull()
    expect(error?.message).toMatch(/platform_operator/i)
  })
})
