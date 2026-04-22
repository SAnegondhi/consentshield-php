import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  AdminTestUser,
  cleanupAdminTestUser,
  createAdminTestUser,
  getAdminAnonClient,
  getAdminServiceClient,
} from './helpers'

// ADR-1017 Sprint 1.3 — admin.ops_readiness_flags RPCs.
//
// Covers:
//   * admin.list_ops_readiness_flags() returns rows in (status, severity)
//     order and denies non-admins.
//   * admin.set_ops_readiness_flag_status(p_flag_id, p_status, p_notes):
//       - platform_operator may mark resolved/deferred
//       - support-tier may mark in_progress but NOT resolved/deferred
//       - non-admin anon cannot call at all
//       - invalid status string rejected with 22023
//       - one matching admin.admin_audit_log row per successful call

const service = getAdminServiceClient()

let platformOp: AdminTestUser
let supportOp: AdminTestUser
let seededFlagId: string

async function countAuditRows(action: string, target_id: string) {
  const { data, count } = await service
    .schema('admin')
    .from('admin_audit_log')
    .select('*', { count: 'exact', head: false })
    .eq('action', action)
    .eq('target_id', target_id)
    .order('occurred_at', { ascending: true })
    .order('id', { ascending: true })
  return { count: count ?? 0, rows: data ?? [] }
}

beforeAll(async () => {
  platformOp = await createAdminTestUser('platform_operator')
  supportOp = await createAdminTestUser('support')

  // Seed a synthetic flag so tests don't mutate the 9 real blockers.
  const { data, error } = await service
    .schema('admin')
    .from('ops_readiness_flags')
    .insert({
      title: 'ADR-1017 S1.3 test fixture — synthetic flag',
      description: 'Created by ops-readiness-flags.test.ts; safe to delete.',
      source_adr: 'ADR-1017 test fixture',
      blocker_type: 'other',
      severity: 'low',
      status: 'pending',
      owner: 'vitest',
    })
    .select()
    .single()
  if (error || !data) throw new Error(`seed flag failed: ${error?.message}`)
  seededFlagId = (data as { id: string }).id
})

afterAll(async () => {
  if (seededFlagId) {
    await service.schema('admin').from('ops_readiness_flags').delete().eq('id', seededFlagId)
  }
  if (platformOp) await cleanupAdminTestUser(platformOp)
  if (supportOp) await cleanupAdminTestUser(supportOp)
})

describe('ADR-1017 S1.3 — admin.list_ops_readiness_flags', () => {
  it('platform_operator can list flags; our fixture appears', async () => {
    const { data, error } = await platformOp.client
      .schema('admin')
      .rpc('list_ops_readiness_flags')
    expect(error).toBeNull()
    expect(Array.isArray(data)).toBe(true)
    const ours = (data as Array<{ id: string; title: string }>).find(
      (r) => r.id === seededFlagId,
    )
    expect(ours).toBeDefined()
    expect(ours!.title).toMatch(/S1.3 test fixture/)
  })

  it('support-tier can also list flags (read access not restricted)', async () => {
    const { data, error } = await supportOp.client
      .schema('admin')
      .rpc('list_ops_readiness_flags')
    expect(error).toBeNull()
    expect(Array.isArray(data)).toBe(true)
  })

  it('anon (no admin claim) is denied — no USAGE on schema admin', async () => {
    const anon = getAdminAnonClient()
    const { error } = await anon
      .schema('admin')
      .rpc('list_ops_readiness_flags')
    // cs_admin / authenticated get EXECUTE; anon has no USAGE on the
    // `admin` schema, so the call fails before the RPC body runs.
    expect(error).not.toBeNull()
    expect(error!.message.toLowerCase()).toMatch(/permission|denied|schema/)
  })

  it('ordering: pending rows precede resolved rows', async () => {
    const { data, error } = await platformOp.client
      .schema('admin')
      .rpc('list_ops_readiness_flags')
    expect(error).toBeNull()
    const rows = data as Array<{ status: string }>
    const pendingIndexes = rows
      .map((r, i) => (r.status === 'pending' ? i : -1))
      .filter((i) => i >= 0)
    const resolvedIndexes = rows
      .map((r, i) => (r.status === 'resolved' ? i : -1))
      .filter((i) => i >= 0)
    if (pendingIndexes.length && resolvedIndexes.length) {
      expect(Math.max(...pendingIndexes)).toBeLessThan(
        Math.min(...resolvedIndexes),
      )
    }
  })
})

describe('ADR-1017 S1.3 — admin.set_ops_readiness_flag_status', () => {
  it('support-tier may transition pending → in_progress', async () => {
    const { data, error } = await supportOp.client
      .schema('admin')
      .rpc('set_ops_readiness_flag_status', {
        p_flag_id: seededFlagId,
        p_status: 'in_progress',
        p_resolution_notes: 'support started investigating',
      })
    expect(error).toBeNull()
    expect(data).toBeDefined()
    const row = data as { id: string; status: string; resolution_notes: string }
    expect(row.status).toBe('in_progress')
    expect(row.resolution_notes).toBe('support started investigating')

    const { count } = await countAuditRows(
      'ops_readiness_flag.status_changed',
      seededFlagId,
    )
    expect(count).toBeGreaterThanOrEqual(1)
  })

  it('support-tier CANNOT mark resolved — 42501 privilege', async () => {
    const { error } = await supportOp.client
      .schema('admin')
      .rpc('set_ops_readiness_flag_status', {
        p_flag_id: seededFlagId,
        p_status: 'resolved',
        p_resolution_notes: 'support has no right to resolve',
      })
    expect(error).not.toBeNull()
    expect(error!.message).toMatch(/platform_operator or platform_owner/i)
  })

  it('platform_operator may mark resolved; resolved_by + resolved_at are stamped', async () => {
    const beforeCount = (
      await countAuditRows('ops_readiness_flag.status_changed', seededFlagId)
    ).count

    const { data, error } = await platformOp.client
      .schema('admin')
      .rpc('set_ops_readiness_flag_status', {
        p_flag_id: seededFlagId,
        p_status: 'resolved',
        p_resolution_notes: 'closed out for the test run',
      })
    expect(error).toBeNull()
    const row = data as {
      id: string
      status: string
      resolved_by: string | null
      resolved_at: string | null
    }
    expect(row.status).toBe('resolved')
    expect(row.resolved_by).toBe(platformOp.userId)
    expect(row.resolved_at).not.toBeNull()

    const { count, rows } = await countAuditRows(
      'ops_readiness_flag.status_changed',
      seededFlagId,
    )
    expect(count).toBe(beforeCount + 1)
    const latest = rows[rows.length - 1]
    expect(latest.reason).toMatch(/resolved/)
    expect(latest.reason.length).toBeGreaterThanOrEqual(10)
    expect(latest.target_table).toBe('admin.ops_readiness_flags')
  })

  it('reopening to pending clears resolved_by / resolved_at', async () => {
    const { data, error } = await platformOp.client
      .schema('admin')
      .rpc('set_ops_readiness_flag_status', {
        p_flag_id: seededFlagId,
        p_status: 'pending',
      })
    expect(error).toBeNull()
    const row = data as {
      status: string
      resolved_by: string | null
      resolved_at: string | null
    }
    expect(row.status).toBe('pending')
    expect(row.resolved_by).toBeNull()
    expect(row.resolved_at).toBeNull()
  })

  it('rejects invalid status string with SQLSTATE 22023', async () => {
    const { error } = await platformOp.client
      .schema('admin')
      .rpc('set_ops_readiness_flag_status', {
        p_flag_id: seededFlagId,
        p_status: 'banana',
      })
    expect(error).not.toBeNull()
    expect(error!.message).toMatch(/invalid_status|banana/i)
  })

  it('flag_not_found raises P0002', async () => {
    const missing = '00000000-0000-0000-0000-0000deadbeef'
    const { error } = await platformOp.client
      .schema('admin')
      .rpc('set_ops_readiness_flag_status', {
        p_flag_id: missing,
        p_status: 'in_progress',
      })
    expect(error).not.toBeNull()
    expect(error!.message).toMatch(/flag_not_found|00000000/i)
  })

  it('anon cannot call the RPC at all', async () => {
    const anon = getAdminAnonClient()
    const { error } = await anon
      .schema('admin')
      .rpc('set_ops_readiness_flag_status', {
        p_flag_id: seededFlagId,
        p_status: 'in_progress',
      })
    expect(error).not.toBeNull()
    expect(error!.message.toLowerCase()).toMatch(/admin claim required|permission|denied|policy/)
  })

  it('audit row payload carries old_value + new_value snapshots', async () => {
    // Force a known transition: resolve → pending.
    await platformOp.client
      .schema('admin')
      .rpc('set_ops_readiness_flag_status', {
        p_flag_id: seededFlagId,
        p_status: 'deferred',
        p_resolution_notes: 'defer for audit payload assertion',
      })

    const { rows } = await countAuditRows(
      'ops_readiness_flag.status_changed',
      seededFlagId,
    )
    const last = rows[rows.length - 1]
    expect(last.old_value).not.toBeNull()
    expect(last.new_value).not.toBeNull()
    expect((last.new_value as { status: string }).status).toBe('deferred')
  })
})
