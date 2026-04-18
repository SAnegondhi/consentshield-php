import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  AdminTestUser,
  cleanupAdminTestUser,
  createAdminTestUser,
  getAdminServiceClient,
} from './helpers'
import { cleanupTestOrg, createTestOrg, TestOrg } from '../rls/helpers'

// ADR-0048 Phase 1 Sprint 1.1 — admin account RPCs.

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

let platformOp: AdminTestUser
let supportUser: AdminTestUser
let customer: TestOrg

beforeAll(async () => {
  platformOp = await createAdminTestUser('platform_operator')
  supportUser = await createAdminTestUser('support')
  customer = await createTestOrg('acctrpc')
})

afterAll(async () => {
  if (platformOp) await cleanupAdminTestUser(platformOp)
  if (supportUser) await cleanupAdminTestUser(supportUser)
  if (customer) await cleanupTestOrg(customer)
})

describe('ADR-0048 Sprint 1.1 — admin account RPCs', () => {
  describe('accounts_list', () => {
    it('support can call; returns our test account with org_count >= 1', async () => {
      const { data, error } = await supportUser.client
        .schema('admin')
        .rpc('accounts_list')
      expect(error).toBeNull()
      expect(Array.isArray(data)).toBe(true)
      const ours = (data as Array<{ id: string; org_count: number }>).find(
        (r) => r.id === customer.accountId,
      )
      expect(ours).toBeDefined()
      expect(Number(ours!.org_count)).toBeGreaterThanOrEqual(1)
    })

    it('filters by status', async () => {
      const { data, error } = await supportUser.client
        .schema('admin')
        .rpc('accounts_list', { p_status: 'suspended' })
      expect(error).toBeNull()
      const ours = (data as Array<{ id: string; status: string }>).find(
        (r) => r.id === customer.accountId,
      )
      // Not suspended yet in this test — should be absent.
      expect(ours).toBeUndefined()
    })

    it('rejects unknown status', async () => {
      const { error } = await supportUser.client
        .schema('admin')
        .rpc('accounts_list', { p_status: 'totally_unknown' })
      expect(error).not.toBeNull()
    })
  })

  describe('account_detail', () => {
    it('support can call; returns account + organisations list', async () => {
      const { data, error } = await supportUser.client
        .schema('admin')
        .rpc('account_detail', { p_account_id: customer.accountId })
      expect(error).toBeNull()
      const envelope = data as {
        account: { id: string; effective_plan: string }
        organisations: Array<{ id: string }>
        active_adjustments: unknown[]
        audit_recent: unknown[]
      }
      expect(envelope.account.id).toBe(customer.accountId)
      expect(envelope.account.effective_plan).toBe('trial_starter')
      expect(envelope.organisations.some((o) => o.id === customer.orgId)).toBe(true)
    })

    it('missing account raises', async () => {
      const { error } = await supportUser.client
        .schema('admin')
        .rpc('account_detail', {
          p_account_id: '00000000-0000-0000-0000-000000000000',
        })
      expect(error).not.toBeNull()
      expect(error?.message).toMatch(/account not found/i)
    })
  })

  describe('suspend_account + restore_account', () => {
    it('platform_operator suspends; child org flipped; audit row carries the org id list', async () => {
      const before = await countAuditRows('suspend_account', platformOp.userId)
      const { data, error } = await platformOp.client
        .schema('admin')
        .rpc('suspend_account', {
          p_account_id: customer.accountId,
          p_reason: 'Testing suspend fan-out for Sprint 1.1',
        })
      expect(error).toBeNull()
      const res = data as { flipped_org_count: number; flipped_org_ids: string[] }
      expect(res.flipped_org_count).toBeGreaterThanOrEqual(1)
      expect(res.flipped_org_ids).toContain(customer.orgId)

      const { data: acctRow } = await service
        .from('accounts')
        .select('status')
        .eq('id', customer.accountId)
        .maybeSingle()
      expect(acctRow?.status).toBe('suspended')

      const { data: orgRow } = await service
        .from('organisations')
        .select('status')
        .eq('id', customer.orgId)
        .maybeSingle()
      expect(orgRow?.status).toBe('suspended')

      const after = await countAuditRows('suspend_account', platformOp.userId)
      expect(after).toBe(before + 1)
    })

    it('double-suspend raises', async () => {
      const { error } = await platformOp.client
        .schema('admin')
        .rpc('suspend_account', {
          p_account_id: customer.accountId,
          p_reason: 'Second suspend attempt should fail',
        })
      expect(error).not.toBeNull()
      expect(error?.message).toMatch(/already suspended/i)
    })

    it('restore_account flips back the account and the prior-flipped orgs only', async () => {
      // Seed a second org on this account and suspend it manually, so we
      // can verify the restore only touches the orgs from the last
      // suspend audit — not other suspended orgs.
      const { data: siblingOrg } = await service
        .from('organisations')
        .insert({
          name: 'Sibling pre-suspended',
          account_id: customer.accountId,
          status: 'suspended',
        })
        .select('id')
        .single()

      const { error } = await platformOp.client
        .schema('admin')
        .rpc('restore_account', {
          p_account_id: customer.accountId,
          p_reason: 'Testing restore reverses only the suspend fan-out set',
        })
      expect(error).toBeNull()

      const { data: acctRow } = await service
        .from('accounts')
        .select('status')
        .eq('id', customer.accountId)
        .maybeSingle()
      expect(acctRow?.status).toBe('active')

      const { data: orgRow } = await service
        .from('organisations')
        .select('status')
        .eq('id', customer.orgId)
        .maybeSingle()
      expect(orgRow?.status).toBe('active')

      // Sibling suspended separately — should NOT flip.
      const { data: siblingRow } = await service
        .from('organisations')
        .select('status')
        .eq('id', siblingOrg!.id)
        .maybeSingle()
      expect(siblingRow?.status).toBe('suspended')

      // Cleanup.
      await service.from('organisations').delete().eq('id', siblingOrg!.id)
    })

    it('support role denied on suspend', async () => {
      const { error } = await supportUser.client
        .schema('admin')
        .rpc('suspend_account', {
          p_account_id: customer.accountId,
          p_reason: 'support role should not reach suspend',
        })
      expect(error).not.toBeNull()
      expect(error?.message).toMatch(/platform_operator/i)
    })

    it('rejects reason < 10 chars', async () => {
      const { error } = await platformOp.client
        .schema('admin')
        .rpc('suspend_account', {
          p_account_id: customer.accountId,
          p_reason: 'short',
        })
      expect(error).not.toBeNull()
    })

    it('restore when not suspended raises', async () => {
      const { error } = await platformOp.client
        .schema('admin')
        .rpc('restore_account', {
          p_account_id: customer.accountId,
          p_reason: 'Restore on already-active account should fail',
        })
      expect(error).not.toBeNull()
      expect(error?.message).toMatch(/not in suspended state/i)
    })
  })
})
