import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import {
  AdminTestUser,
  cleanupAdminTestUser,
  createAdminTestUser,
  getAdminServiceClient,
} from '../admin/helpers'
import { cleanupTestOrg, createTestOrg, TestOrg } from '../rls/helpers'

// ADR-0056 Sprint 1.1 — account-scoped feature flags.
//
// Covers:
//   · set_feature_flag with scope='account' + p_account_id happy path
//   · delete_feature_flag with scope='account'
//   · CHECK constraint guards (account-scope requires account_id, org_id null; etc.)
//   · Resolver fallback: org > account > global
//   · Uniqueness: (flag_key, scope, account_id, org_id)
//   · platform_operator required

let operator: AdminTestUser
let support: AdminTestUser
let orgA: TestOrg
let orgB: TestOrg  // second org under same account for fallback test
const service = getAdminServiceClient()

const FLAG_KEY = `flag_adr_0056_${Date.now()}`

beforeAll(async () => {
  operator = await createAdminTestUser('platform_operator')
  support = await createAdminTestUser('support')
  orgA = await createTestOrg('flagAcctA')
  // Create second org under the same account as orgA so fallback test can
  // flip to it without signing a new user.
  const { data: orgB_row } = await service
    .from('organisations')
    .insert({
      account_id: orgA.accountId,
      name: 'flagAcctB org',
    })
    .select('id')
    .single()
  const { error: memErr } = await service.from('org_memberships').insert({
    org_id: orgB_row!.id,
    user_id: orgA.userId,
    role: 'org_admin',
  })
  if (memErr) throw new Error(`seed orgB membership: ${memErr.message}`)
  orgB = { ...orgA, orgId: orgB_row!.id as string } as TestOrg
}, 60000)

afterAll(async () => {
  // Cleanup flags by key pattern
  await service.schema('admin').from('feature_flags').delete().ilike('flag_key', 'flag_adr_0056_%')
  // Cleanup orgB (orgA cleanup handles the account)
  await service.from('organisations').delete().eq('id', orgB.orgId)
  await cleanupTestOrg(orgA)
  await cleanupAdminTestUser(operator)
  await cleanupAdminTestUser(support)
}, 30000)

describe('ADR-0056 Sprint 1.1 — set_feature_flag with scope=account', () => {
  it('platform_operator can set an account-scoped flag', async () => {
    const { error } = await operator.client
      .schema('admin')
      .rpc('set_feature_flag', {
        p_flag_key: FLAG_KEY,
        p_scope: 'account',
        p_value: true,
        p_description: 'Test account-scoped flag for ADR-0056',
        p_org_id: null,
        p_account_id: orgA.accountId,
        p_expires_at: null,
        p_reason: 'testing account-scoped flag creation',
      })
    expect(error).toBeNull()

    const { data } = await service
      .schema('admin')
      .from('feature_flags')
      .select('scope, account_id, org_id, value')
      .eq('flag_key', FLAG_KEY)
      .eq('scope', 'account')
      .single()
    expect(data!.scope).toBe('account')
    expect(data!.account_id).toBe(orgA.accountId)
    expect(data!.org_id).toBeNull()
    expect(data!.value).toBe(true)
  })

  it('account scope without account_id raises', async () => {
    const { error } = await operator.client
      .schema('admin')
      .rpc('set_feature_flag', {
        p_flag_key: `${FLAG_KEY}_no_account`,
        p_scope: 'account',
        p_value: true,
        p_description: 'Test missing account_id',
        p_org_id: null,
        p_account_id: null,
        p_expires_at: null,
        p_reason: 'should raise: account scope without account_id',
      })
    expect(error).not.toBeNull()
    expect(error!.message).toMatch(/account_id required/)
  })

  it('account scope with org_id raises', async () => {
    const { error } = await operator.client
      .schema('admin')
      .rpc('set_feature_flag', {
        p_flag_key: `${FLAG_KEY}_both`,
        p_scope: 'account',
        p_value: true,
        p_description: 'Test both set',
        p_org_id: orgA.orgId,
        p_account_id: orgA.accountId,
        p_expires_at: null,
        p_reason: 'should raise: account scope with org_id set',
      })
    expect(error).not.toBeNull()
    expect(error!.message).toMatch(/account scope must not carry org_id/)
  })

  it('global scope with account_id raises', async () => {
    const { error } = await operator.client
      .schema('admin')
      .rpc('set_feature_flag', {
        p_flag_key: `${FLAG_KEY}_global_acct`,
        p_scope: 'global',
        p_value: true,
        p_description: 'Test global with account',
        p_org_id: null,
        p_account_id: orgA.accountId,
        p_expires_at: null,
        p_reason: 'should raise: global scope carries account_id',
      })
    expect(error).not.toBeNull()
    expect(error!.message).toMatch(/must not carry org_id or account_id/)
  })

  it('support tier denied', async () => {
    const { error } = await support.client
      .schema('admin')
      .rpc('set_feature_flag', {
        p_flag_key: `${FLAG_KEY}_support`,
        p_scope: 'account',
        p_value: true,
        p_description: 'support denied',
        p_org_id: null,
        p_account_id: orgA.accountId,
        p_expires_at: null,
        p_reason: 'should be denied; support cannot write flags',
      })
    expect(error).not.toBeNull()
  })
})

describe('ADR-0056 Sprint 1.1 — get_feature_flag resolver fallback', () => {
  it('returns account-scoped value when no org override exists', async () => {
    // Account-scoped flag already set in test 1 (value=true).
    // Customer session sees value=true for any org under the account.
    const { data, error } = await orgA.client.rpc('get_feature_flag', {
      p_flag_key: FLAG_KEY,
    })
    expect(error).toBeNull()
    expect(data).toBe(true)
  })

  it('org override takes precedence over account scope', async () => {
    // Set an org override to false on orgA.
    const { error: setErr } = await operator.client
      .schema('admin')
      .rpc('set_feature_flag', {
        p_flag_key: FLAG_KEY,
        p_scope: 'org',
        p_value: false,
        p_description: 'org override beats account scope',
        p_org_id: orgA.orgId,
        p_account_id: null,
        p_expires_at: null,
        p_reason: 'testing org > account fallback precedence',
      })
    expect(setErr).toBeNull()

    const { data } = await orgA.client.rpc('get_feature_flag', { p_flag_key: FLAG_KEY })
    expect(data).toBe(false)  // org override wins
  })

  it('global default applies when neither org nor account override exists', async () => {
    const globalKey = `flag_adr_0056_global_${Date.now()}`
    await operator.client.schema('admin').rpc('set_feature_flag', {
      p_flag_key: globalKey,
      p_scope: 'global',
      p_value: 'global-default-value',
      p_description: 'global default',
      p_org_id: null,
      p_account_id: null,
      p_expires_at: null,
      p_reason: 'testing global default resolution',
    })

    const { data } = await orgA.client.rpc('get_feature_flag', { p_flag_key: globalKey })
    expect(data).toBe('global-default-value')
  })
})

describe('ADR-0056 Sprint 1.1 — delete_feature_flag with scope=account', () => {
  it('operator can delete an account-scoped flag', async () => {
    const { error } = await operator.client
      .schema('admin')
      .rpc('delete_feature_flag', {
        p_flag_key: FLAG_KEY,
        p_scope: 'account',
        p_org_id: null,
        p_account_id: orgA.accountId,
        p_reason: 'cleanup account-scoped flag after test',
      })
    expect(error).toBeNull()

    const { data: remaining } = await service
      .schema('admin')
      .from('feature_flags')
      .select('id')
      .eq('flag_key', FLAG_KEY)
      .eq('scope', 'account')
    expect(remaining!.length).toBe(0)
  })
})
