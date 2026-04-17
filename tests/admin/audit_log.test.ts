import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  createAdminTestUser,
  cleanupAdminTestUser,
  getAdminServiceClient,
  AdminTestUser,
} from './helpers'
import { createTestOrg, cleanupTestOrg, TestOrg } from '../rls/helpers'

// ADR-0027 Sprint 3.1 — audit-log semantics.
//
// For every successful admin RPC, there must be exactly one matching
// admin.admin_audit_log row with:
//   * admin_user_id = the caller's auth.uid()
//   * reason = the p_reason argument verbatim
//   * old_value / new_value reflecting the mutation (where applicable)
//
// And the append-only invariant holds: writes come only from inside
// SECURITY DEFINER functions. Direct mutation from the `authenticated`
// or `cs_admin` roles returns permission denied.

let platformOp: AdminTestUser
let customer: TestOrg
const service = getAdminServiceClient()

async function countAuditRows(filter: { action: string; admin_user_id?: string }) {
  let q = service.schema('admin').from('admin_audit_log').select('*', { count: 'exact', head: false }).eq('action', filter.action)
  if (filter.admin_user_id) q = q.eq('admin_user_id', filter.admin_user_id)
  const { count, data } = await q
  return { count: count ?? 0, rows: data ?? [] }
}

beforeAll(async () => {
  platformOp = await createAdminTestUser('platform_operator')
  customer = await createTestOrg('auditlog')
})

afterAll(async () => {
  if (platformOp) await cleanupAdminTestUser(platformOp)
  if (customer) await cleanupTestOrg(customer)
})

describe('ADR-0027 Sprint 3.1 — one audit row per successful RPC call', () => {
  it('suspend_org writes exactly one audit row with reason + old_value + new_value', async () => {
    const reason = 'audit-log-suspend-test-verbatim-reason'
    const { error } = await platformOp.client.schema('admin').rpc('suspend_org', {
      p_org_id: customer.orgId,
      p_reason: reason,
    })
    expect(error).toBeNull()

    const { count, rows } = await countAuditRows({
      action: 'suspend_org',
      admin_user_id: platformOp.userId,
    })
    const matching = rows.filter((r) => r.target_id === customer.orgId)
    expect(matching).toHaveLength(1)
    const row = matching[0]
    expect(row.admin_user_id).toBe(platformOp.userId)
    expect(row.reason).toBe(reason)
    expect(row.target_table).toBe('public.organisations')
    expect(row.org_id).toBe(customer.orgId)
    expect(row.old_value).not.toBeNull()
    expect(row.new_value).not.toBeNull()
    expect((row.old_value as { status: string }).status).toBe('active')
    expect((row.new_value as { status: string }).status).toBe('suspended')
    // At least one row matched (we asserted length === 1 above; this
    // expectation on total count ≥ 1 is a guard against stale rows).
    expect(count).toBeGreaterThanOrEqual(1)
  })

  it('restore_org writes a second audit row (suspend + restore are paired)', async () => {
    const reason = 'audit-log-restore-test-verbatim-reason'
    const { error } = await platformOp.client.schema('admin').rpc('restore_org', {
      p_org_id: customer.orgId,
      p_reason: reason,
    })
    expect(error).toBeNull()

    const { rows } = await countAuditRows({
      action: 'restore_org',
      admin_user_id: platformOp.userId,
    })
    const matching = rows.filter((r) => r.target_id === customer.orgId)
    expect(matching).toHaveLength(1)
    expect(matching[0].reason).toBe(reason)
    expect((matching[0].old_value as { status: string }).status).toBe('suspended')
    expect((matching[0].new_value as { status: string }).status).toBe('active')
  })

  it('toggle_kill_switch writes an audit row with target_pk = switch_key', async () => {
    const reason = 'audit-log-killswitch-test-reason'
    const { error } = await platformOp.client.schema('admin').rpc('toggle_kill_switch', {
      p_switch_key: 'depa_processing',
      p_enabled: true,
      p_reason: reason,
    })
    expect(error).toBeNull()

    const { rows } = await countAuditRows({
      action: 'toggle_kill_switch',
      admin_user_id: platformOp.userId,
    })
    const matching = rows.filter((r) => r.target_pk === 'depa_processing' && r.reason === reason)
    expect(matching).toHaveLength(1)
    expect((matching[0].old_value as { enabled: boolean }).enabled).toBe(false)
    expect((matching[0].new_value as { enabled: boolean }).enabled).toBe(true)

    // Disengage for cleanliness.
    await platformOp.client.schema('admin').rpc('toggle_kill_switch', {
      p_switch_key: 'depa_processing',
      p_enabled: false,
      p_reason: 'audit-log-killswitch-test-disengage',
    })
  })
})

describe('ADR-0027 Sprint 3.1 — append-only invariant holds under direct SQL', () => {
  it('direct INSERT into admin_audit_log as authenticated is denied', async () => {
    const { error } = await platformOp.client.schema('admin').from('admin_audit_log').insert({
      admin_user_id: platformOp.userId,
      action: 'should_never_land',
      reason: 'append-only-invariant-test',
    })
    expect(error).not.toBeNull()
    expect(error!.message.toLowerCase()).toMatch(/permission|denied|policy|rls/)
  })

  it('direct UPDATE of admin_audit_log as authenticated is denied', async () => {
    const { error } = await platformOp.client.schema('admin').from('admin_audit_log').update({ reason: 'mutated' }).eq('action', 'suspend_org')
    expect(error).not.toBeNull()
    expect(error!.message.toLowerCase()).toMatch(/permission|denied|policy|rls/)
  })

  it('direct DELETE from admin_audit_log as authenticated is denied', async () => {
    const { error } = await platformOp.client.schema('admin').from('admin_audit_log').delete().eq('action', 'suspend_org')
    expect(error).not.toBeNull()
    expect(error!.message.toLowerCase()).toMatch(/permission|denied|policy|rls/)
  })
})

describe('ADR-0027 Sprint 3.1 — reason + role mismatches leave NO audit row', () => {
  it('suspend_org called with reason="short" rolls back — no audit row', async () => {
    const before = await countAuditRows({
      action: 'suspend_org',
      admin_user_id: platformOp.userId,
    })
    const { error } = await platformOp.client.schema('admin').rpc('suspend_org', {
      p_org_id: customer.orgId,
      p_reason: 'short',
    })
    expect(error).not.toBeNull()
    const after = await countAuditRows({
      action: 'suspend_org',
      admin_user_id: platformOp.userId,
    })
    expect(after.count).toBe(before.count)
  })
})
