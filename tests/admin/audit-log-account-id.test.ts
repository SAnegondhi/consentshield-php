import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  createAdminTestUser,
  cleanupAdminTestUser,
  getAdminServiceClient,
  AdminTestUser,
} from './helpers'
import { createTestOrg, cleanupTestOrg, TestOrg } from '../rls/helpers'

// ADR-1027 Sprint 1.1 — admin.admin_audit_log.account_id trigger.
//
// Coverage:
//   1. Org-scoped RPC writes an audit row; trigger derives account_id
//      from org_id via public.organisations.account_id.
//   2. Account-scoped RPC (suspend_account / restore_account) writes
//      audit rows with target_table = 'public.accounts'; trigger
//      sets account_id = target_id directly.
//   3. Filtering admin_audit_log by account_id returns both kinds of
//      rows for the same customer (the cross-org umbrella view).

let platformOp: AdminTestUser
let customer: TestOrg
const service = getAdminServiceClient()

async function getAuditRowsFor(params: {
  action: string
  admin_user_id: string
  account_id?: string
  target_id?: string
}): Promise<Array<Record<string, unknown>>> {
  let q = service
    .schema('admin')
    .from('admin_audit_log')
    .select('*')
    .eq('action', params.action)
    .eq('admin_user_id', params.admin_user_id)
  if (params.account_id) q = q.eq('account_id', params.account_id)
  if (params.target_id) q = q.eq('target_id', params.target_id)
  const { data } = await q
  return data ?? []
}

beforeAll(async () => {
  platformOp = await createAdminTestUser('platform_operator')
  customer = await createTestOrg('auditlog-acct')
})

afterAll(async () => {
  if (platformOp) await cleanupAdminTestUser(platformOp)
  if (customer) await cleanupTestOrg(customer)
})

describe('ADR-1027 Sprint 1.1 — account_id auto-populated on admin_audit_log', () => {
  it('org-scoped RPC (suspend_org) populates account_id from org_id via trigger', async () => {
    const reason = 'adr1027-s11-org-suspend-derives-account-id'
    const { error } = await platformOp.client
      .schema('admin')
      .rpc('suspend_org', {
        p_org_id: customer.orgId,
        p_reason: reason,
      })
    expect(error).toBeNull()

    // Resolve the customer's parent account.
    const { data: orgRow } = await service
      .schema('public')
      .from('organisations')
      .select('account_id')
      .eq('id', customer.orgId)
      .single()
    const expectedAccountId = orgRow?.account_id as string
    expect(expectedAccountId).toBeDefined()

    const rows = await getAuditRowsFor({
      action: 'suspend_org',
      admin_user_id: platformOp.userId,
      target_id: customer.orgId,
    })
    expect(rows.length).toBeGreaterThanOrEqual(1)
    const latest = rows.sort(
      (a, b) =>
        new Date(b.occurred_at as string).getTime() -
        new Date(a.occurred_at as string).getTime(),
    )[0]
    expect(latest.account_id).toBe(expectedAccountId)
    expect(latest.org_id).toBe(customer.orgId)
    expect(latest.reason).toBe(reason)

    // Restore so the next test starts from a known state.
    await platformOp.client.schema('admin').rpc('restore_org', {
      p_org_id: customer.orgId,
      p_reason: 'adr1027-s11-restore-after-suspend',
    })
  })

  it('account-scoped RPC (suspend_account) sets account_id = target_id', async () => {
    const { data: orgRow } = await service
      .schema('public')
      .from('organisations')
      .select('account_id')
      .eq('id', customer.orgId)
      .single()
    const accountId = orgRow?.account_id as string
    expect(accountId).toBeDefined()

    const reason = 'adr1027-s11-account-suspend-self-sets-account-id'
    const { error } = await platformOp.client
      .schema('admin')
      .rpc('suspend_account', {
        p_account_id: accountId,
        p_reason: reason,
      })
    expect(error).toBeNull()

    const rows = await getAuditRowsFor({
      action: 'suspend_account',
      admin_user_id: platformOp.userId,
      account_id: accountId,
    })
    expect(rows.length).toBeGreaterThanOrEqual(1)
    const latest = rows.sort(
      (a, b) =>
        new Date(b.occurred_at as string).getTime() -
        new Date(a.occurred_at as string).getTime(),
    )[0]
    expect(latest.target_table).toBe('public.accounts')
    expect(latest.target_id).toBe(accountId)
    expect(latest.account_id).toBe(accountId)
    expect(latest.reason).toBe(reason)

    // Restore the account (reverses the suspend fan-out).
    await platformOp.client.schema('admin').rpc('restore_account', {
      p_account_id: accountId,
      p_reason: 'adr1027-s11-restore-account-after-suspend',
    })
  })

  it('filter by account_id surfaces both org-scoped and account-scoped rows for the same customer', async () => {
    const { data: orgRow } = await service
      .schema('public')
      .from('organisations')
      .select('account_id')
      .eq('id', customer.orgId)
      .single()
    const accountId = orgRow?.account_id as string

    const { data, error } = await service
      .schema('admin')
      .from('admin_audit_log')
      .select('action, target_table, org_id, account_id')
      .eq('account_id', accountId)
      .eq('admin_user_id', platformOp.userId)

    expect(error).toBeNull()
    const actions = new Set((data ?? []).map((r) => r.action as string))
    // Either this test suite's run or a prior one inserted both shapes;
    // at minimum the suspend_org + suspend_account actions must appear
    // under the same account filter (the point of this sprint).
    expect(actions.has('suspend_org')).toBe(true)
    expect(actions.has('suspend_account')).toBe(true)
    // Every row carried this account_id (trivially true given the filter,
    // but asserts the column type + the filter itself works end-to-end).
    for (const row of data ?? []) {
      expect(row.account_id).toBe(accountId)
    }
  })
})
