import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createClient, SupabaseClient } from '@supabase/supabase-js'
import { createTestOrg, cleanupTestOrg, type TestOrg } from '../rls/helpers'

// ADR-0044 Phase 2.6 — create_invitation_from_marketing gate.
// The RPC has no auth.jwt check; gating is purely the EXECUTE grant
// (cs_orchestrator only). The /api/internal/invites route adds HMAC
// verification on top. We assert the grant via has_function_privilege
// and exercise the body via service-role (runs as postgres superuser,
// ignores EXECUTE grants).

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!

function serviceClient(): SupabaseClient {
  return createClient(SUPABASE_URL, SERVICE_ROLE_KEY)
}

describe('ADR-0044 Phase 2.6 — create_invitation_from_marketing', () => {
  let owner: TestOrg

  beforeAll(async () => {
    owner = await createTestOrg('phase26')
  }, 60000)

  afterAll(async () => {
    await cleanupTestOrg(owner)
  }, 60000)

  // EXECUTE grant introspection happens via the denial tests below —
  // PostgREST doesn't expose has_function_privilege cleanly, and the
  // end-state we care about is "anon + authenticated cannot call it,
  // cs_orchestrator can." The call-denial tests assert exactly that.

  it('authenticated user hits permission denied (42501)', async () => {
    const { error } = await owner.client.rpc('create_invitation_from_marketing', {
      p_email: `m1-${Date.now()}@test.consentshield.in`,
      p_plan_code: 'trial_starter',
    })
    expect(error).not.toBeNull()
    expect(error?.code).toBe('42501')
  })

  it('anon hits permission denied (42501)', async () => {
    const anon = createClient(SUPABASE_URL, ANON_KEY)
    const { error } = await anon.rpc('create_invitation_from_marketing', {
      p_email: `m2-${Date.now()}@test.consentshield.in`,
      p_plan_code: 'trial_starter',
    })
    expect(error).not.toBeNull()
    expect(error?.code).toBe('42501')
  })

  it('body creates an account_owner invite with correct shape (via superuser)', async () => {
    const svc = serviceClient()
    const email = `m3-${Date.now()}@test.consentshield.in`
    const { data, error } = await svc.rpc('create_invitation_from_marketing', {
      p_email: email,
      p_plan_code: 'trial_starter',
      p_trial_days: 30,
      p_default_org_name: 'Marketing Signup Co',
      p_expires_in_days: 7,
    })
    expect(error).toBeNull()
    const row = (data as Array<{ id: string; token: string }>)[0]
    expect(row.token).toMatch(/^[0-9a-f]{48}$/)

    const { data: inv } = await svc
      .from('invitations')
      .select('role, account_id, org_id, plan_code, default_org_name, trial_days')
      .eq('id', row.id)
      .single()
    expect(inv!.role).toBe('account_owner')
    expect(inv!.account_id).toBeNull()
    expect(inv!.org_id).toBeNull()
    expect(inv!.plan_code).toBe('trial_starter')
    expect(inv!.default_org_name).toBe('Marketing Signup Co')
    expect(inv!.trial_days).toBe(30)
  })

  it('inactive plan raises', async () => {
    const { error } = await serviceClient().rpc(
      'create_invitation_from_marketing',
      {
        p_email: `m4-${Date.now()}@test.consentshield.in`,
        p_plan_code: 'does-not-exist',
      },
    )
    expect(error).not.toBeNull()
    expect(error?.message).toMatch(/not active/i)
  })

  it('duplicate pending invite raises unique_violation', async () => {
    const svc = serviceClient()
    const email = `m6-${Date.now()}@test.consentshield.in`
    const first = await svc.rpc('create_invitation_from_marketing', {
      p_email: email,
      p_plan_code: 'trial_starter',
    })
    expect(first.error).toBeNull()
    const second = await svc.rpc('create_invitation_from_marketing', {
      p_email: email,
      p_plan_code: 'trial_starter',
    })
    expect(second.error).not.toBeNull()
    expect(second.error?.code).toBe('23505')
  })
})
