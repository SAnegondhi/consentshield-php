import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  AdminTestUser,
  cleanupAdminTestUser,
  createAdminTestUser,
  getAdminServiceClient,
} from './helpers'

// ADR-0050 Sprint 2.1 — platform_owner tier behaviour.
//
// Covers the guards that keep the owner tier out of normal RPC flows:
//   · admin.admin_invite_create refuses p_admin_role='platform_owner'
//   · admin.admin_change_role refuses p_new_role='platform_owner'
//   · admin.admin_change_role refuses to change a platform_owner's role
//   · admin.admin_disable refuses to disable a platform_owner
//   · admin.require_admin extended tier logic — platform_owner satisfies
//     every lower tier (support, platform_operator) and satisfies its own.

const service = getAdminServiceClient()

let owner: AdminTestUser
let operator: AdminTestUser
let support: AdminTestUser

async function seedPlatformOwner(): Promise<AdminTestUser> {
  // createAdminTestUser would set admin_role='platform_owner' directly in
  // both places, bypassing admin_change_role (which refuses promotions
  // to owner). That's exactly what the real founder-seed migration
  // does via direct UPDATE, so the test parity is correct.
  return createAdminTestUser('platform_owner')
}

beforeAll(async () => {
  owner = await seedPlatformOwner()
  operator = await createAdminTestUser('platform_operator')
  support = await createAdminTestUser('support')
})

afterAll(async () => {
  if (owner) await cleanupAdminTestUser(owner)
  if (operator) await cleanupAdminTestUser(operator)
  if (support) await cleanupAdminTestUser(support)
})

describe('ADR-0050 Sprint 2.1 — platform_owner tier', () => {
  describe('require_admin tier dominance', () => {
    it('platform_owner satisfies support tier (accounts_list uses support)', async () => {
      const { error } = await owner.client.schema('admin').rpc('accounts_list')
      expect(error).toBeNull()
    })

    it('platform_owner satisfies platform_operator tier (via change_role error path)', async () => {
      // billing_upsert_plan_adjustment requires platform_operator; the
      // owner should pass the require_admin check and fail only on the
      // business validation (account not found), not on the role check.
      const { error } = await owner.client
        .schema('admin')
        .rpc('billing_upsert_plan_adjustment', {
          p_account_id: '00000000-0000-0000-0000-000000000000',
          p_kind: 'comp',
          p_plan: 'growth',
          p_expires_at: null,
          p_reason: 'owner tier dominance test — account should be missing',
        })
      expect(error).not.toBeNull()
      expect(error?.message).not.toMatch(/platform_operator role required/i)
    })

    it('support cannot satisfy platform_operator tier', async () => {
      const { error } = await support.client
        .schema('admin')
        .rpc('billing_upsert_plan_adjustment', {
          p_account_id: '00000000-0000-0000-0000-000000000000',
          p_kind: 'comp',
          p_plan: 'growth',
          p_expires_at: null,
          p_reason: 'support-cannot-operator tier check',
        })
      expect(error).not.toBeNull()
      expect(error?.message).toMatch(/platform_operator role required/i)
    })
  })

  describe('admin_invite_create — refuses platform_owner invite', () => {
    it('operator trying to invite platform_owner raises', async () => {
      // Create a throwaway auth user via service role, then try to
      // invite-create them as platform_owner. The test asserts the RPC
      // refuses before inserting — so no cleanup of admin_users row needed
      // (delete the auth user at the end to be safe).
      const throwawayEmail = `throwaway-owner-${Date.now()}@test.consentshield.in`
      const { data: created, error: createErr } = await service.auth.admin.createUser(
        {
          email: throwawayEmail,
          password: `Throwaway!${Date.now()}`,
          email_confirm: true,
        },
      )
      expect(createErr).toBeNull()
      const throwawayId = created!.user.id
      try {
        const { error } = await operator.client
          .schema('admin')
          .rpc('admin_invite_create', {
            p_user_id: throwawayId,
            p_display_name: 'Mallory',
            p_admin_role: 'platform_owner',
            p_reason: 'attempt to invite platform_owner should be rejected',
          })
        expect(error).not.toBeNull()
        expect(error?.message).toMatch(/platform_owner cannot be invited/i)

        // Verify no admin_users row was inserted.
        const { data: check } = await service
          .schema('admin')
          .from('admin_users')
          .select('id')
          .eq('id', throwawayId)
          .maybeSingle()
        expect(check).toBeNull()
      } finally {
        await service.auth.admin.deleteUser(throwawayId)
      }
    })
  })

  describe('admin_change_role — protect platform_owner on both sides', () => {
    it('operator cannot promote anyone to platform_owner', async () => {
      const { error } = await operator.client
        .schema('admin')
        .rpc('admin_change_role', {
          p_admin_id: support.userId,
          p_new_role: 'platform_owner',
          p_reason: 'attempt to promote support to platform_owner',
        })
      expect(error).not.toBeNull()
      expect(error?.message).toMatch(
        /cannot promote to platform_owner via rpc/i,
      )

      // Verify support's role is unchanged.
      const { data: row } = await service
        .schema('admin')
        .from('admin_users')
        .select('admin_role')
        .eq('id', support.userId)
        .single()
      expect(row?.admin_role).toBe('support')
    })

    it('operator cannot change a platform_owner role', async () => {
      const { error } = await operator.client
        .schema('admin')
        .rpc('admin_change_role', {
          p_admin_id: owner.userId,
          p_new_role: 'support',
          p_reason: 'attempt to demote platform_owner to support',
        })
      expect(error).not.toBeNull()
      expect(error?.message).toMatch(/cannot change a platform_owner role/i)

      const { data: row } = await service
        .schema('admin')
        .from('admin_users')
        .select('admin_role')
        .eq('id', owner.userId)
        .single()
      expect(row?.admin_role).toBe('platform_owner')
    })
  })

  describe('admin_disable — protect platform_owner', () => {
    it('operator cannot disable a platform_owner', async () => {
      const { error } = await operator.client
        .schema('admin')
        .rpc('admin_disable', {
          p_admin_id: owner.userId,
          p_reason: 'attempt to disable platform_owner should be rejected',
        })
      expect(error).not.toBeNull()
      expect(error?.message).toMatch(/cannot disable a platform_owner/i)

      const { data: row } = await service
        .schema('admin')
        .from('admin_users')
        .select('status')
        .eq('id', owner.userId)
        .single()
      expect(row?.status).toBe('active')
    })
  })
})
