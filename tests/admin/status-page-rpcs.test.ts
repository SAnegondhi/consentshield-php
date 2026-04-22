import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  AdminTestUser,
  cleanupAdminTestUser,
  createAdminTestUser,
  getAdminAnonClient,
  getAdminServiceClient,
} from './helpers'

// ADR-1018 follow-up — the four status-page admin RPCs (landed in
// migration 20260804000013, audit-log bug fixed in 20260804000019).
//
// Covers:
//   * set_status_subsystem_state — gated on require_admin('support');
//     audit-log row emitted; rejects invalid state + unknown slug.
//   * post_status_incident — severity + initial-status guards; public
//     SELECT on the resulting row; audit row present.
//   * update_status_incident — lifecycle timestamps advance.
//   * resolve_status_incident — status flip + postmortem stored.

const service = getAdminServiceClient()

let supportOp: AdminTestUser
let createdIncidents: string[] = []
let originalSubsystemState: string | null = null

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
  supportOp = await createAdminTestUser('support')
  const { data } = await service
    .from('status_subsystems')
    .select('current_state')
    .eq('slug', 'dashboard')
    .single()
  originalSubsystemState = (data as { current_state: string } | null)?.current_state ?? null
})

afterAll(async () => {
  for (const id of createdIncidents) {
    await service.from('status_incidents').delete().eq('id', id)
  }
  if (originalSubsystemState) {
    await service
      .from('status_subsystems')
      .update({ current_state: originalSubsystemState, last_state_change_note: null })
      .eq('slug', 'dashboard')
  }
  if (supportOp) await cleanupAdminTestUser(supportOp)
})

describe('ADR-1018 — admin.set_status_subsystem_state', () => {
  it('support-tier can flip dashboard operational → degraded', async () => {
    const { data, error } = await supportOp.client
      .schema('admin')
      .rpc('set_status_subsystem_state', {
        p_slug: 'dashboard',
        p_state: 'degraded',
        p_note: 'test: simulated slowness',
      })
    expect(error).toBeNull()
    const row = data as { slug: string; current_state: string; last_state_change_note: string }
    expect(row.slug).toBe('dashboard')
    expect(row.current_state).toBe('degraded')
    expect(row.last_state_change_note).toBe('test: simulated slowness')

    const { count, rows } = await countAuditRows(
      'status.subsystem_state_changed',
      row['id' as keyof typeof row] as string,
    )
    expect(count).toBeGreaterThanOrEqual(1)
    const latest = rows[rows.length - 1]
    expect(latest.target_pk).toBe('dashboard')
    expect(latest.target_table).toBe('public.status_subsystems')
    expect(latest.reason.length).toBeGreaterThanOrEqual(10)
  })

  it('restoring to operational also emits an audit row', async () => {
    const { error } = await supportOp.client
      .schema('admin')
      .rpc('set_status_subsystem_state', {
        p_slug: 'dashboard',
        p_state: 'operational',
        p_note: 'test: restored',
      })
    expect(error).toBeNull()
  })

  it('rejects invalid state string with 22023', async () => {
    const { error } = await supportOp.client
      .schema('admin')
      .rpc('set_status_subsystem_state', {
        p_slug: 'dashboard',
        p_state: 'on_fire',
      })
    expect(error).not.toBeNull()
    expect(error!.message).toMatch(/invalid_state|on_fire/i)
  })

  it('raises subsystem_not_found for unknown slug', async () => {
    const { error } = await supportOp.client
      .schema('admin')
      .rpc('set_status_subsystem_state', {
        p_slug: 'this-slug-does-not-exist',
        p_state: 'operational',
      })
    expect(error).not.toBeNull()
    expect(error!.message).toMatch(/subsystem_not_found/i)
  })

  it('anon is denied — no USAGE on schema admin', async () => {
    const anon = getAdminAnonClient()
    const { error } = await anon
      .schema('admin')
      .rpc('set_status_subsystem_state', {
        p_slug: 'dashboard',
        p_state: 'operational',
      })
    expect(error).not.toBeNull()
  })
})

describe('ADR-1018 — admin.post_status_incident + update + resolve', () => {
  it('support-tier can post a sev3 incident', async () => {
    const { data, error } = await supportOp.client
      .schema('admin')
      .rpc('post_status_incident', {
        p_title: 'Test incident — ops-readiness test harness',
        p_description: 'Synthetic incident created by status-page-rpcs.test.ts',
        p_severity: 'sev3',
      })
    expect(error).toBeNull()
    const row = data as {
      id: string
      severity: string
      status: string
      started_at: string
      created_by: string
    }
    expect(row.severity).toBe('sev3')
    expect(row.status).toBe('investigating')
    expect(row.created_by).toBe(supportOp.userId)
    createdIncidents.push(row.id)

    const { count, rows } = await countAuditRows('status.incident_posted', row.id)
    expect(count).toBe(1)
    expect(rows[0].reason).toMatch(/incident/i)
    expect(rows[0].target_table).toBe('public.status_incidents')
  })

  it('incident is publicly SELECT-able via anon client', async () => {
    const incidentId = createdIncidents[createdIncidents.length - 1]
    const anon = getAdminAnonClient()
    const { data, error } = await anon
      .from('status_incidents')
      .select('id, severity, status, title')
      .eq('id', incidentId)
      .single()
    expect(error).toBeNull()
    expect((data as { id: string })?.id).toBe(incidentId)
  })

  it('update lifecycle: investigating → identified → monitoring → resolved', async () => {
    const incidentId = createdIncidents[createdIncidents.length - 1]

    const { data: d1 } = await supportOp.client
      .schema('admin')
      .rpc('update_status_incident', {
        p_incident_id: incidentId,
        p_new_status: 'identified',
        p_last_update_note: 'root cause found',
      })
    expect((d1 as { identified_at: string | null }).identified_at).not.toBeNull()

    const { data: d2 } = await supportOp.client
      .schema('admin')
      .rpc('update_status_incident', {
        p_incident_id: incidentId,
        p_new_status: 'monitoring',
      })
    expect((d2 as { monitoring_at: string | null }).monitoring_at).not.toBeNull()

    const { data: d3, error: e3 } = await supportOp.client
      .schema('admin')
      .rpc('resolve_status_incident', {
        p_incident_id: incidentId,
        p_postmortem_url: 'https://example.com/postmortem/test',
        p_resolution_note: 'test resolution',
      })
    expect(e3).toBeNull()
    const resolved = d3 as {
      status: string
      resolved_at: string | null
      postmortem_url: string | null
    }
    expect(resolved.status).toBe('resolved')
    expect(resolved.resolved_at).not.toBeNull()
    expect(resolved.postmortem_url).toBe('https://example.com/postmortem/test')

    // Four status-lifecycle audit rows expected: posted + updated(id)
    // + updated(monitoring) + resolved.
    const posted = await countAuditRows('status.incident_posted', incidentId)
    const updated = await countAuditRows('status.incident_updated', incidentId)
    const resolvedRows = await countAuditRows('status.incident_resolved', incidentId)
    expect(posted.count).toBe(1)
    expect(updated.count).toBe(2)
    expect(resolvedRows.count).toBe(1)
  })

  it('post rejects invalid severity (22023)', async () => {
    const { error } = await supportOp.client
      .schema('admin')
      .rpc('post_status_incident', {
        p_title: 'invalid-severity',
        p_description: 'should fail',
        p_severity: 'critical',
      })
    expect(error).not.toBeNull()
    expect(error!.message).toMatch(/invalid_severity/i)
  })

  it('update rejects invalid status (22023)', async () => {
    const incidentId = createdIncidents[createdIncidents.length - 1]
    const { error } = await supportOp.client
      .schema('admin')
      .rpc('update_status_incident', {
        p_incident_id: incidentId,
        p_new_status: 'banana',
      })
    expect(error).not.toBeNull()
    expect(error!.message).toMatch(/invalid_status/i)
  })

  it('update raises incident_not_found for unknown id', async () => {
    const { error } = await supportOp.client
      .schema('admin')
      .rpc('update_status_incident', {
        p_incident_id: '00000000-0000-0000-0000-0000deadbeef',
        p_new_status: 'monitoring',
      })
    expect(error).not.toBeNull()
    expect(error!.message).toMatch(/incident_not_found|00000000/i)
  })
})
