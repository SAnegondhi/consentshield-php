// ADR-1003 Sprint 5.1 Round 1 — sandbox provisioning + sandbox API key.
//
// Verifies:
//   1. rpc_provision_sandbox_org as account_owner creates an org with
//      sandbox=true under the caller's account, makes the caller
//      org_admin, optionally applies a sectoral template (BFSI Starter
//      since Healthcare Starter would require pre-flipped storage_mode).
//   2. Same RPC raises 42501 ('not_an_account_owner') for a non-owner.
//   3. rpc_api_key_create on the new sandbox org issues a `cs_test_*`
//      plaintext key, rate_tier='sandbox', sandbox=true, regardless of
//      the rate_tier argument the caller passed.
//   4. rpc_api_key_create raises when sandbox rate_tier is requested
//      against a non-sandbox org.

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  cleanupTestOrg,
  createTestOrg,
  getServiceClient,
  type TestOrg,
} from '../rls/helpers'

describe('ADR-1003 Sprint 5.1 — sandbox provisioning', () => {
  let owner: TestOrg

  beforeAll(async () => {
    owner = await createTestOrg('sbx-owner')
  }, 60000)

  afterAll(async () => {
    if (owner) {
      // The provisioning RPC adds a sandbox org under the same account,
      // which is cleaned up by the cascade from the account → orgs FK.
      await cleanupTestOrg(owner)
    }
  }, 60000)

  it('provisions a sandbox org under the owner account', async () => {
    const { data, error } = await owner.client.rpc('rpc_provision_sandbox_org', {
      p_name: 'My sandbox',
      p_template_code: null,
    })
    expect(error).toBeNull()
    const result = data as {
      ok: boolean
      org_id: string
      account_id: string
      sandbox: boolean
      template_applied: unknown
      storage_mode: string
    }
    expect(result.ok).toBe(true)
    expect(result.account_id).toBe(owner.accountId)
    expect(result.sandbox).toBe(true)
    expect(result.storage_mode).toBe('standard')
    expect(result.template_applied).toBeNull()

    // Confirm row + sandbox flag + name suffix + caller membership.
    const admin = getServiceClient()
    const { data: orgRow } = await admin
      .from('organisations')
      .select('id, name, sandbox, account_id, storage_mode')
      .eq('id', result.org_id)
      .single()
    expect(orgRow).toBeTruthy()
    expect(orgRow!.sandbox).toBe(true)
    expect(orgRow!.account_id).toBe(owner.accountId)
    expect(orgRow!.name).toMatch(/\(sandbox\)$/)
    expect(orgRow!.storage_mode).toBe('standard')

    const { data: memberRow } = await admin
      .from('org_memberships')
      .select('role')
      .eq('org_id', result.org_id)
      .eq('user_id', owner.userId)
      .single()
    expect(memberRow?.role).toBe('org_admin')

    // And: rpc_api_key_create on this sandbox org issues cs_test_*.
    const { data: keyData, error: keyErr } = await owner.client.rpc('rpc_api_key_create', {
      p_account_id: owner.accountId,
      p_org_id: result.org_id,
      p_scopes: ['read:consent', 'write:consent'],
      // Even though we pass 'starter', the RPC forces 'sandbox' on a sandbox org.
      p_rate_tier: 'starter',
      p_name: 'sbx-test-key',
    })
    expect(keyErr).toBeNull()
    const key = keyData as {
      id: string
      plaintext: string
      prefix: string
      rate_tier: string
      sandbox: boolean
    }
    expect(key.plaintext.startsWith('cs_test_')).toBe(true)
    expect(key.prefix.startsWith('cs_test_')).toBe(true)
    expect(key.rate_tier).toBe('sandbox')
    expect(key.sandbox).toBe(true)
  }, 30000)

  it('refuses sandbox rate_tier on a non-sandbox org', async () => {
    const { error } = await owner.client.rpc('rpc_api_key_create', {
      p_account_id: owner.accountId,
      p_org_id: owner.orgId, // the original prod-style org
      p_scopes: ['read:consent'],
      p_rate_tier: 'sandbox',
      p_name: 'should-fail',
    })
    expect(error).toBeTruthy()
    expect(error!.message).toMatch(/sandbox rate_tier requires a sandbox org/)
  }, 15000)
})

describe('ADR-1003 Sprint 5.1 R2 — test-principal generator', () => {
  let owner: TestOrg
  let sandboxOrgId: string

  beforeAll(async () => {
    owner = await createTestOrg('sbx-tp-owner')
    const { data, error } = await owner.client.rpc('rpc_provision_sandbox_org', {
      p_name: 'TP test sandbox',
      p_template_code: null,
    })
    if (error) throw new Error(`provision: ${error.message}`)
    sandboxOrgId = (data as { org_id: string }).org_id
  }, 60000)

  afterAll(async () => {
    if (owner) await cleanupTestOrg(owner)
  }, 60000)

  it('returns monotonically-increasing test-principal identifiers', async () => {
    // The RPC is granted to cs_orchestrator only — the integration
    // test reaches it through the service-role client (which is the
    // closest equivalent to "what cs_orchestrator does at runtime"
    // for shape verification). The route handler itself can't be
    // exercised here without spinning Next.js up.
    const admin = getServiceClient()

    const { data: r1, error: e1 } = await admin.rpc('rpc_sandbox_next_test_principal', {
      p_org_id: sandboxOrgId,
    })
    expect(e1).toBeNull()
    const env1 = r1 as { identifier: string; seq: number }
    expect(env1.identifier).toBe('cs_test_principal_000001')
    expect(env1.seq).toBe(1)

    const { data: r2, error: e2 } = await admin.rpc('rpc_sandbox_next_test_principal', {
      p_org_id: sandboxOrgId,
    })
    expect(e2).toBeNull()
    const env2 = r2 as { identifier: string; seq: number }
    expect(env2.identifier).toBe('cs_test_principal_000002')
    expect(env2.seq).toBe(2)

    const { data: r3 } = await admin.rpc('rpc_sandbox_next_test_principal', {
      p_org_id: sandboxOrgId,
    })
    expect((r3 as { seq: number }).seq).toBe(3)
  }, 30000)

  it('refuses non-sandbox orgs with 42501', async () => {
    const admin = getServiceClient()
    const { error } = await admin.rpc('rpc_sandbox_next_test_principal', {
      p_org_id: owner.orgId, // the original prod-style org
    })
    expect(error).toBeTruthy()
    expect(error!.code).toBe('42501')
    expect(error!.message).toMatch(/not_a_sandbox_org/)
  }, 15000)
})

describe('ADR-1003 Sprint 5.1 — non-owner refusal', () => {
  let nonOwner: TestOrg

  beforeAll(async () => {
    nonOwner = await createTestOrg('sbx-non-owner')
    // Demote the seeded account_owner role so the caller becomes a
    // non-owner. createTestOrg seeds account_owner by default; we strip
    // that membership row to make the user a plain org_admin without
    // account ownership.
    const admin = getServiceClient()
    const { error } = await admin
      .from('account_memberships')
      .delete()
      .eq('account_id', nonOwner.accountId)
      .eq('user_id', nonOwner.userId)
    if (error) throw new Error(`demote: ${error.message}`)
  }, 60000)

  afterAll(async () => {
    if (nonOwner) await cleanupTestOrg(nonOwner)
  }, 60000)

  it('rejects rpc_provision_sandbox_org with not_an_account_owner', async () => {
    const { error } = await nonOwner.client.rpc('rpc_provision_sandbox_org', {
      p_name: 'should fail',
      p_template_code: null,
    })
    expect(error).toBeTruthy()
    expect(error!.code).toBe('42501')
    expect(error!.message).toMatch(/not_an_account_owner/)
  }, 15000)
})
