import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createClient, SupabaseClient } from '@supabase/supabase-js'
import { createTestOrg, cleanupTestOrg, type TestOrg } from '../rls/helpers'

// ADR-0044 Phase 2.4 — list_pending_invitations / revoke_invitation
// / list_members role gates.

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!

function serviceClient(): SupabaseClient {
  return createClient(SUPABASE_URL, SERVICE_ROLE_KEY)
}

async function createSecondaryUser(suffix: string) {
  const email = `rbac-phase24-${suffix}-${Date.now()}@test.consentshield.in`
  const password = `TestPass!${Date.now()}`
  const admin = serviceClient()
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  })
  if (error) throw new Error(`createUser failed: ${error.message}`)
  const userId = data.user.id

  const client = createClient(SUPABASE_URL, ANON_KEY)
  const { error: signInError } = await client.auth.signInWithPassword({ email, password })
  if (signInError) throw new Error(`signIn failed: ${signInError.message}`)
  await client.auth.refreshSession()
  return { userId, email, client }
}

async function cleanupUser(userId: string) {
  const admin = serviceClient()
  await admin.auth.admin.deleteUser(userId)
}

describe('ADR-0044 Phase 2.4 — list + revoke', () => {
  let owner: TestOrg

  beforeAll(async () => {
    owner = await createTestOrg('phase24')
  }, 60000)

  afterAll(async () => {
    await cleanupTestOrg(owner)
  }, 60000)

  describe('list_pending_invitations', () => {
    it('account_owner sees their own account invites', async () => {
      const email = `l1-${Date.now()}@test.consentshield.in`
      await owner.client.rpc('create_invitation', {
        p_email: email,
        p_role: 'viewer',
        p_account_id: owner.accountId,
        p_org_id: owner.orgId,
      })

      const { data, error } = await owner.client.rpc('list_pending_invitations')
      expect(error).toBeNull()
      const emails = ((data ?? []) as Array<{ invited_email: string }>).map((r) => r.invited_email)
      expect(emails).toContain(email)
    })

    it('unrelated user sees an empty list', async () => {
      const stranger = await createSecondaryUser('stranger')
      try {
        const { data, error } = await stranger.client.rpc('list_pending_invitations')
        expect(error).toBeNull()
        expect(data ?? []).toEqual([])
      } finally {
        await cleanupUser(stranger.userId)
      }
    })

    it('revoked invites disappear from list_pending_invitations', async () => {
      const email = `l2-${Date.now()}@test.consentshield.in`
      const { data: created } = await owner.client.rpc('create_invitation', {
        p_email: email,
        p_role: 'viewer',
        p_account_id: owner.accountId,
        p_org_id: owner.orgId,
      })
      const invitationId = (created as Array<{ id: string }>)[0].id
      await owner.client.rpc('revoke_invitation', { p_id: invitationId })

      const { data } = await owner.client.rpc('list_pending_invitations')
      const ids = ((data ?? []) as Array<{ id: string }>).map((r) => r.id)
      expect(ids).not.toContain(invitationId)
    })
  })

  describe('revoke_invitation role gates', () => {
    it('account_owner can revoke their own org-scoped invite', async () => {
      const { data: created } = await owner.client.rpc('create_invitation', {
        p_email: `r1-${Date.now()}@test.consentshield.in`,
        p_role: 'viewer',
        p_account_id: owner.accountId,
        p_org_id: owner.orgId,
      })
      const invitationId = (created as Array<{ id: string }>)[0].id

      const { error } = await owner.client.rpc('revoke_invitation', { p_id: invitationId })
      expect(error).toBeNull()
    })

    it('stranger cannot revoke an invite for a different account', async () => {
      const { data: created } = await owner.client.rpc('create_invitation', {
        p_email: `r2-${Date.now()}@test.consentshield.in`,
        p_role: 'viewer',
        p_account_id: owner.accountId,
        p_org_id: owner.orgId,
      })
      const invitationId = (created as Array<{ id: string }>)[0].id

      const stranger = await createSecondaryUser('revoke-stranger')
      try {
        const { error } = await stranger.client.rpc('revoke_invitation', {
          p_id: invitationId,
        })
        expect(error).not.toBeNull()
      } finally {
        await cleanupUser(stranger.userId)
      }
    })

    it('admin-tier of org cannot revoke an org_admin invite (account_owner required)', async () => {
      const { data: created } = await owner.client.rpc('create_invitation', {
        p_email: `r3-${Date.now()}@test.consentshield.in`,
        p_role: 'org_admin',
        p_account_id: owner.accountId,
        p_org_id: owner.orgId,
      })
      const invitationId = (created as Array<{ id: string }>)[0].id

      const admin = await createSecondaryUser('admin-tier')
      try {
        await serviceClient()
          .from('org_memberships')
          .insert({ org_id: owner.orgId, user_id: admin.userId, role: 'admin' })

        const { error } = await admin.client.rpc('revoke_invitation', {
          p_id: invitationId,
        })
        expect(error).not.toBeNull()
        expect(error?.message).toMatch(/account_owner/i)
      } finally {
        await cleanupUser(admin.userId)
      }
    })

    it('revoking an already-accepted invite fails', async () => {
      const { data: created } = await owner.client.rpc('create_invitation', {
        p_email: `r4-${Date.now()}@test.consentshield.in`,
        p_role: 'viewer',
        p_account_id: owner.accountId,
        p_org_id: owner.orgId,
      })
      const row = (created as Array<{ id: string; token: string }>)[0]

      // Directly mark as accepted via service-role so we can test the gate.
      await serviceClient()
        .from('invitations')
        .update({ accepted_at: new Date().toISOString() })
        .eq('id', row.id)

      const { error } = await owner.client.rpc('revoke_invitation', { p_id: row.id })
      expect(error).not.toBeNull()
      expect(error?.message).toMatch(/already accepted/i)
    })

    it('double-revoke is idempotent (no error)', async () => {
      const { data: created } = await owner.client.rpc('create_invitation', {
        p_email: `r5-${Date.now()}@test.consentshield.in`,
        p_role: 'viewer',
        p_account_id: owner.accountId,
        p_org_id: owner.orgId,
      })
      const invitationId = (created as Array<{ id: string }>)[0].id

      await owner.client.rpc('revoke_invitation', { p_id: invitationId })
      const { error } = await owner.client.rpc('revoke_invitation', { p_id: invitationId })
      expect(error).toBeNull()
    })
  })

  describe('list_members', () => {
    it('account_owner sees themself in the member list', async () => {
      const { data, error } = await owner.client.rpc('list_members')
      expect(error).toBeNull()
      const rows = (data ?? []) as Array<{ email: string; role: string }>
      const self = rows.find((r) => r.email === owner.email)
      expect(self).toBeDefined()
      expect(self?.role).toBe('account_owner')
    })

    it('stranger sees an empty member list', async () => {
      const stranger = await createSecondaryUser('member-stranger')
      try {
        const { data, error } = await stranger.client.rpc('list_members')
        expect(error).toBeNull()
        expect(data ?? []).toEqual([])
      } finally {
        await cleanupUser(stranger.userId)
      }
    })
  })
})
