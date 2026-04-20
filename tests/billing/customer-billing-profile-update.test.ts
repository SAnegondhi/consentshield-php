import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { cleanupTestOrg, createTestOrg, getServiceClient, TestOrg } from '../rls/helpers'

// ADR-0054 Sprint 1.2 — public.update_account_billing_profile.
//
// Scope rules tested:
//   · account_owner can update the profile; audit row created
//   · Invalid GSTIN / state_code / empty legal_name / bad email all raise
//   · Optional GSTIN (null / empty string) is accepted and stored as NULL
//   · Cross-account: accountA's update cannot affect accountB's profile

let accountA: TestOrg
let accountB: TestOrg

const service = getServiceClient()

async function setInitialProfile(accountId: string, legalName: string) {
  const { error } = await service
    .from('accounts')
    .update({
      billing_legal_name: legalName,
      billing_gstin: null,
      billing_state_code: '29',
      billing_address: 'Initial address',
      billing_email: `${legalName.replace(/\s/g, '').toLowerCase()}@test.consentshield.in`,
      billing_profile_updated_at: new Date().toISOString(),
    })
    .eq('id', accountId)
  if (error) throw new Error(error.message)
}

beforeAll(async () => {
  accountA = await createTestOrg('updA')
  accountB = await createTestOrg('updB')
  await setInitialProfile(accountA.accountId, 'Initial A Pvt Ltd')
  await setInitialProfile(accountB.accountId, 'Initial B Pvt Ltd')
}, 60000)

afterAll(async () => {
  // Clean up audit log rows created by the RPC
  await service.from('account_audit_log').delete().in('account_id', [accountA.accountId, accountB.accountId])
  await cleanupTestOrg(accountA)
  await cleanupTestOrg(accountB)
}, 30000)

describe('ADR-0054 Sprint 1.2 — update_account_billing_profile', () => {
  it('account_owner can update their profile; audit row created', async () => {
    const { data, error } = await accountA.client.rpc('update_account_billing_profile', {
      p_legal_name: 'Acme Updated Pvt Ltd',
      p_gstin: '29AAAPL2356Q1ZS',
      p_state_code: '29',
      p_address: '123 Updated St, Bengaluru 560001',
      p_email: 'updated-billing@acme.in',
    })
    expect(error).toBeNull()
    expect((data as { ok: boolean }).ok).toBe(true)

    // Verify persistence
    const { data: account } = await service
      .from('accounts')
      .select('billing_legal_name, billing_gstin, billing_state_code, billing_address, billing_email')
      .eq('id', accountA.accountId)
      .single()
    expect(account!.billing_legal_name).toBe('Acme Updated Pvt Ltd')
    expect(account!.billing_gstin).toBe('29AAAPL2356Q1ZS')
    expect(account!.billing_address).toContain('Bengaluru')

    // Verify audit row
    const { data: auditRows } = await service
      .from('account_audit_log')
      .select('action, old_value, new_value, actor_user_id')
      .eq('account_id', accountA.accountId)
      .eq('action', 'billing_profile_update')
    expect(auditRows).toBeTruthy()
    expect(auditRows!.length).toBeGreaterThanOrEqual(1)
    const row = auditRows![0] as { old_value: Record<string, unknown>; new_value: Record<string, unknown> }
    expect(row.old_value.billing_legal_name).toBe('Initial A Pvt Ltd')
    expect(row.new_value.billing_legal_name).toBe('Acme Updated Pvt Ltd')
  })

  it('accountA cannot affect accountB profile (enforced by current_account_id)', async () => {
    // Update A with distinct values
    await accountA.client.rpc('update_account_billing_profile', {
      p_legal_name: 'A-Isolated Pvt Ltd',
      p_gstin: null,
      p_state_code: '29',
      p_address: 'A Isolated Address',
      p_email: 'a-isolated@test.in',
    })

    // accountB's row should be unchanged
    const { data: accountBRow } = await service
      .from('accounts')
      .select('billing_legal_name')
      .eq('id', accountB.accountId)
      .single()
    expect(accountBRow!.billing_legal_name).toBe('Initial B Pvt Ltd')
  })

  it('empty GSTIN stored as null', async () => {
    await accountA.client.rpc('update_account_billing_profile', {
      p_legal_name: 'A No GSTIN Pvt Ltd',
      p_gstin: null,
      p_state_code: '29',
      p_address: 'A No GSTIN Address',
      p_email: 'a-nogstin@test.in',
    })
    const { data: account } = await service
      .from('accounts')
      .select('billing_gstin')
      .eq('id', accountA.accountId)
      .single()
    expect(account!.billing_gstin).toBeNull()
  })

  it('invalid GSTIN raises invalid_gstin', async () => {
    const { error } = await accountA.client.rpc('update_account_billing_profile', {
      p_legal_name: 'Acme Pvt Ltd',
      p_gstin: 'NOT-A-GSTIN',
      p_state_code: '29',
      p_address: 'Some address',
      p_email: 'a@b.in',
    })
    expect(error).not.toBeNull()
    expect(error!.message).toMatch(/invalid_gstin/)
  })

  it('invalid state_code raises invalid_state_code', async () => {
    const { error } = await accountA.client.rpc('update_account_billing_profile', {
      p_legal_name: 'Acme Pvt Ltd',
      p_gstin: null,
      p_state_code: '99',
      p_address: 'Some address',
      p_email: 'a@b.in',
    })
    expect(error).not.toBeNull()
    expect(error!.message).toMatch(/invalid_state_code/)
  })

  it('legal_name too short raises invalid_legal_name', async () => {
    const { error } = await accountA.client.rpc('update_account_billing_profile', {
      p_legal_name: 'A',
      p_gstin: null,
      p_state_code: '29',
      p_address: 'Some address',
      p_email: 'a@b.in',
    })
    expect(error).not.toBeNull()
    expect(error!.message).toMatch(/invalid_legal_name/)
  })

  it('invalid email raises invalid_email', async () => {
    const { error } = await accountA.client.rpc('update_account_billing_profile', {
      p_legal_name: 'Acme Pvt Ltd',
      p_gstin: null,
      p_state_code: '29',
      p_address: 'Some address',
      p_email: 'not-an-email',
    })
    expect(error).not.toBeNull()
    expect(error!.message).toMatch(/invalid_email/)
  })

  it('empty address raises invalid_address', async () => {
    const { error } = await accountA.client.rpc('update_account_billing_profile', {
      p_legal_name: 'Acme Pvt Ltd',
      p_gstin: null,
      p_state_code: '29',
      p_address: '',
      p_email: 'a@b.in',
    })
    expect(error).not.toBeNull()
    expect(error!.message).toMatch(/invalid_address/)
  })
})
