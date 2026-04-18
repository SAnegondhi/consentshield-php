import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  AdminTestUser,
  cleanupAdminTestUser,
  createAdminTestUser,
  getAdminAnonClient,
  getAdminServiceClient,
} from './helpers'
import { cleanupTestOrg, createTestOrg, TestOrg } from '../rls/helpers'

// ADR-0034 Sprint 1.1 — Billing Operations admin RPCs.
//
// Covers the six admin.billing_* RPCs + public.org_effective_plan. Each
// list RPC returns an array; each write RPC inserts both a domain row
// and a matching admin.admin_audit_log entry in the same transaction.
// Non-admins are denied; support-role is denied on platform_operator-
// gated writes (upsert / revoke plan_adjustment).

let supportUser: AdminTestUser
let platformOp: AdminTestUser
let customer: TestOrg
const service = getAdminServiceClient()

beforeAll(async () => {
  supportUser = await createAdminTestUser('support')
  platformOp = await createAdminTestUser('platform_operator')
  customer = await createTestOrg('billing')
})

afterAll(async () => {
  if (supportUser) await cleanupAdminTestUser(supportUser)
  if (platformOp) await cleanupAdminTestUser(platformOp)
  if (customer) await cleanupTestOrg(customer)
})

async function countAuditRows(action: string, adminUserId: string) {
  const { count } = await service
    .schema('admin')
    .from('admin_audit_log')
    .select('*', { count: 'exact', head: true })
    .eq('action', action)
    .eq('admin_user_id', adminUserId)
  return count ?? 0
}

describe('ADR-0034 Sprint 1.1 — admin billing_* RPCs + org_effective_plan', () => {
  describe('billing_payment_failures_list', () => {
    it('support admin can call; returns an array', async () => {
      const { data, error } = await supportUser.client
        .schema('admin')
        .rpc('billing_payment_failures_list', { p_window_days: 7 })
      expect(error).toBeNull()
      expect(Array.isArray(data)).toBe(true)
    })

    it('rejects p_window_days outside [1, 90]', async () => {
      const { error } = await supportUser.client
        .schema('admin')
        .rpc('billing_payment_failures_list', { p_window_days: 0 })
      expect(error).not.toBeNull()
      expect(error?.message).toMatch(/p_window_days must be between/i)
    })

    it('non-admin authenticated user is denied', async () => {
      const anon = getAdminAnonClient()
      const { error } = await anon
        .schema('admin')
        .rpc('billing_payment_failures_list', { p_window_days: 7 })
      expect(error).not.toBeNull()
    })
  })

  describe('billing_refunds_list + billing_create_refund', () => {
    it('support admin can create a refund; writes refund row + audit row', async () => {
      const before = await countAuditRows('billing_create_refund', supportUser.userId)

      const { data: id, error } = await supportUser.client
        .schema('admin')
        .rpc('billing_create_refund', {
          p_org_id: customer.orgId,
          p_razorpay_payment_id: 'pay_test_1a2b3c',
          p_amount_paise: 59900,
          p_reason: 'Cancellation within 7-day window',
        })
      expect(error).toBeNull()
      expect(typeof id).toBe('string')

      const { data: rows } = await service
        .from('refunds')
        .select('*')
        .eq('id', id as string)
      expect(rows).toHaveLength(1)
      expect(rows![0].status).toBe('pending')
      expect(rows![0].amount_paise).toBe(59900)

      const after = await countAuditRows('billing_create_refund', supportUser.userId)
      expect(after).toBe(before + 1)
    })

    it('billing_refunds_list returns the just-created refund', async () => {
      const { data, error } = await supportUser.client
        .schema('admin')
        .rpc('billing_refunds_list', { p_limit: 20 })
      expect(error).toBeNull()
      expect(Array.isArray(data)).toBe(true)
      const match = (data as Array<{ org_id: string; status: string }>).find(
        (r) => r.org_id === customer.orgId,
      )
      expect(match).toBeDefined()
    })

    it('rejects reason < 10 chars', async () => {
      const { error } = await supportUser.client
        .schema('admin')
        .rpc('billing_create_refund', {
          p_org_id: customer.orgId,
          p_razorpay_payment_id: 'pay_short',
          p_amount_paise: 100,
          p_reason: 'short',
        })
      expect(error).not.toBeNull()
    })

    it('rejects amount_paise <= 0', async () => {
      const { error } = await supportUser.client
        .schema('admin')
        .rpc('billing_create_refund', {
          p_org_id: customer.orgId,
          p_razorpay_payment_id: 'pay_zero',
          p_amount_paise: 0,
          p_reason: 'zero-amount refund attempt test',
        })
      expect(error).not.toBeNull()
    })
  })

  describe('billing_upsert_plan_adjustment + list + revoke', () => {
    it('platform_operator can create a comp grant; list returns it', async () => {
      const { data: id, error } = await platformOp.client
        .schema('admin')
        .rpc('billing_upsert_plan_adjustment', {
          p_org_id: customer.orgId,
          p_kind: 'comp',
          p_plan: 'pro',
          p_expires_at: new Date(Date.now() + 90 * 24 * 3600 * 1000).toISOString(),
          p_reason: 'ABDM pilot partner — 90 days',
        })
      expect(error).toBeNull()
      expect(typeof id).toBe('string')

      const { data: list } = await platformOp.client
        .schema('admin')
        .rpc('billing_plan_adjustments_list', { p_kind: 'comp' })
      const match = (list as Array<{ id: string; org_id: string; plan: string }>).find(
        (r) => r.id === id,
      )
      expect(match?.plan).toBe('pro')
      expect(match?.org_id).toBe(customer.orgId)
    })

    it('upsert revokes the prior active (org, kind) row', async () => {
      // First grant is still active from the previous test. Upsert a new
      // comp for the same org — the partial-unique index would reject
      // a second active row; the RPC must revoke the previous one first.
      const { data: newId, error } = await platformOp.client
        .schema('admin')
        .rpc('billing_upsert_plan_adjustment', {
          p_org_id: customer.orgId,
          p_kind: 'comp',
          p_plan: 'enterprise',
          p_expires_at: null,
          p_reason: 'Upgrade comp grant to enterprise, no expiry',
        })
      expect(error).toBeNull()

      const { data: active } = await platformOp.client
        .schema('admin')
        .rpc('billing_plan_adjustments_list', { p_kind: 'comp' })
      const forOrg = (active as Array<{ id: string; org_id: string; plan: string }>).filter(
        (r) => r.org_id === customer.orgId,
      )
      expect(forOrg).toHaveLength(1)
      expect(forOrg[0].id).toBe(newId)
      expect(forOrg[0].plan).toBe('enterprise')
    })

    it('org_effective_plan returns the active comp plan', async () => {
      const { data, error } = await service.rpc('org_effective_plan', {
        p_org_id: customer.orgId,
      })
      expect(error).toBeNull()
      expect(data).toBe('enterprise')
    })

    it('override stacks on comp and wins in org_effective_plan', async () => {
      const { error } = await platformOp.client
        .schema('admin')
        .rpc('billing_upsert_plan_adjustment', {
          p_org_id: customer.orgId,
          p_kind: 'override',
          p_plan: 'growth',
          p_expires_at: new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString(),
          p_reason: 'Temporary downshift for testing precedence',
        })
      expect(error).toBeNull()

      const { data: plan } = await service.rpc('org_effective_plan', {
        p_org_id: customer.orgId,
      })
      expect(plan).toBe('growth')
    })

    it('support role is denied on upsert', async () => {
      const { error } = await supportUser.client
        .schema('admin')
        .rpc('billing_upsert_plan_adjustment', {
          p_org_id: customer.orgId,
          p_kind: 'comp',
          p_plan: 'pro',
          p_expires_at: null,
          p_reason: 'support should not be allowed to grant plans',
        })
      expect(error).not.toBeNull()
      expect(error?.message).toMatch(/platform_operator/i)
    })

    it('revoke marks the row revoked and falls back to the next tier', async () => {
      // Revoke the active override. org_effective_plan should fall back to comp.
      const { data: active } = await platformOp.client
        .schema('admin')
        .rpc('billing_plan_adjustments_list', { p_kind: 'override' })
      const target = (active as Array<{ id: string; org_id: string }>).find(
        (r) => r.org_id === customer.orgId,
      )
      expect(target).toBeDefined()

      const { error } = await platformOp.client
        .schema('admin')
        .rpc('billing_revoke_plan_adjustment', {
          p_adjustment_id: target!.id,
          p_reason: 'End of override test — revert to comp',
        })
      expect(error).toBeNull()

      const { data: plan } = await service.rpc('org_effective_plan', {
        p_org_id: customer.orgId,
      })
      // Comp is still enterprise from earlier.
      expect(plan).toBe('enterprise')
    })

    it('rejects unknown plan code', async () => {
      const { error } = await platformOp.client
        .schema('admin')
        .rpc('billing_upsert_plan_adjustment', {
          p_org_id: customer.orgId,
          p_kind: 'comp',
          p_plan: 'platinum', // not in the enum
          p_expires_at: null,
          p_reason: 'should fail — bogus plan code',
        })
      expect(error).not.toBeNull()
    })
  })

  describe('org_effective_plan fallback when no adjustments exist', () => {
    it('returns organisations.plan when no active adjustments', async () => {
      // Use a fresh org so no plan_adjustments rows exist.
      const fresh = await createTestOrg('billing-eff')
      try {
        const { data, error } = await service.rpc('org_effective_plan', {
          p_org_id: fresh.orgId,
        })
        expect(error).toBeNull()
        expect(data).toBe('trial_starter') // default account plan for newly-created orgs (ADR-0044 Phase 0)
      } finally {
        await cleanupTestOrg(fresh)
      }
    })
  })
})
