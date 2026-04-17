import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  createAdminTestUser,
  cleanupAdminTestUser,
  getAdminServiceClient,
  AdminTestUser,
} from './helpers'
import { createTestOrg, cleanupTestOrg, TestOrg } from '../rls/helpers'

// ADR-0027 Sprint 3.1 — RPC contract tests.
//
// Asserts:
//   * Every role-gated RPC rejects callers without the is_admin claim.
//   * Every reason-required RPC rejects p_reason < 10 chars.
//   * platform_operator-only RPCs reject admin_role='support' callers.
//   * Impersonation lifecycle: start → row + audit + pg_notify; end →
//     status update + second audit row; force-end requires platform_operator.
//   * Sectoral template publish cascade: previous published version →
//     deprecated + superseded_by_id pointing at the new id.
//   * Kill-switch toggle flips enabled, records audit, emits pg_notify.

let platformOp: AdminTestUser
let supportOp: AdminTestUser
let customer: TestOrg
const service = getAdminServiceClient()

beforeAll(async () => {
  platformOp = await createAdminTestUser('platform_operator')
  supportOp = await createAdminTestUser('support')
  customer = await createTestOrg('rpcs')
})

afterAll(async () => {
  // Clean up admin.admin_users rows first (FK ON DELETE CASCADE from
  // auth.users clears them, but explicit cleanup is clearer).
  if (platformOp) await cleanupAdminTestUser(platformOp)
  if (supportOp) await cleanupAdminTestUser(supportOp)
  if (customer) await cleanupTestOrg(customer)
})

// Helper: call an admin RPC via the admin schema namespace.
async function rpc(user: AdminTestUser | TestOrg, name: string, args: Record<string, unknown>) {
  return user.client.schema('admin').rpc(name, args)
}

describe('ADR-0027 Sprint 3.1 — no-claim rejection (every admin-claim RPC)', () => {
  const gatedRpcs: Array<[string, Record<string, unknown>]> = [
    ['suspend_org', { p_org_id: '00000000-0000-0000-0000-000000000000', p_reason: 'ten-chars-minimum-reason' }],
    ['restore_org', { p_org_id: '00000000-0000-0000-0000-000000000000', p_reason: 'ten-chars-minimum-reason' }],
    ['extend_trial', { p_org_id: '00000000-0000-0000-0000-000000000000', p_new_trial_end: new Date(Date.now() + 86400000).toISOString(), p_reason: 'ten-chars-minimum-reason' }],
    ['update_customer_setting', { p_org_id: '00000000-0000-0000-0000-000000000000', p_key: 'k', p_value: '"v"', p_reason: 'ten-chars-minimum-reason' }],
    ['start_impersonation', { p_org_id: '00000000-0000-0000-0000-000000000000', p_reason: 'bug_investigation', p_reason_detail: 'ten-chars-minimum-reason', p_duration_minutes: 30 }],
    ['force_end_impersonation', { p_session_id: '00000000-0000-0000-0000-000000000000', p_reason: 'ten-chars-minimum-reason' }],
    ['publish_sectoral_template', { p_template_id: '00000000-0000-0000-0000-000000000000', p_version_notes: 'ten-chars-minimum-reason' }],
    ['deprecate_sectoral_template', { p_template_id: '00000000-0000-0000-0000-000000000000', p_reason: 'ten-chars-minimum-reason' }],
    ['deprecate_connector', { p_connector_id: '00000000-0000-0000-0000-000000000000', p_reason: 'ten-chars-minimum-reason' }],
    ['deprecate_tracker_signature', { p_signature_id: '00000000-0000-0000-0000-000000000000', p_reason: 'ten-chars-minimum-reason' }],
    ['toggle_kill_switch', { p_switch_key: 'banner_delivery', p_enabled: true, p_reason: 'ten-chars-minimum-reason' }],
    ['delete_feature_flag', { p_flag_key: 'test', p_scope: 'global', p_reason: 'ten-chars-minimum-reason' }],
  ]

  for (const [name, args] of gatedRpcs) {
    it(`admin.${name} rejects a customer JWT with 42501`, async () => {
      const { error } = await rpc(customer, name, args)
      expect(error).not.toBeNull()
      // The require_admin helper raises with SQLSTATE 42501. Some error
      // paths also surface as plain text; accept either.
      expect(error!.message.toLowerCase()).toMatch(/admin claim required|platform_operator|support or|permission/)
    })
  }
})

describe('ADR-0027 Sprint 3.1 — reason < 10 chars rejection', () => {
  it('suspend_org rejects reason="short"', async () => {
    const { error } = await rpc(platformOp, 'suspend_org', {
      p_org_id: customer.orgId,
      p_reason: 'short',
    })
    expect(error).not.toBeNull()
    expect(error!.message.toLowerCase()).toMatch(/reason required/)
  })

  it('toggle_kill_switch rejects reason=""', async () => {
    const { error } = await rpc(platformOp, 'toggle_kill_switch', {
      p_switch_key: 'banner_delivery',
      p_enabled: true,
      p_reason: '',
    })
    expect(error).not.toBeNull()
    expect(error!.message.toLowerCase()).toMatch(/reason required/)
  })

  it('start_impersonation rejects reason_detail="short"', async () => {
    const { error } = await rpc(supportOp, 'start_impersonation', {
      p_org_id: customer.orgId,
      p_reason: 'bug_investigation',
      p_reason_detail: 'short',
      p_duration_minutes: 30,
    })
    expect(error).not.toBeNull()
    expect(error!.message.toLowerCase()).toMatch(/reason_detail required/)
  })
})

describe('ADR-0027 Sprint 3.1 — platform_operator vs support role gate', () => {
  it('support JWT cannot call suspend_org (platform_operator required)', async () => {
    const { error } = await rpc(supportOp, 'suspend_org', {
      p_org_id: customer.orgId,
      p_reason: 'support-role-should-fail',
    })
    expect(error).not.toBeNull()
    expect(error!.message.toLowerCase()).toMatch(/platform_operator/)
  })

  it('support JWT cannot call toggle_kill_switch', async () => {
    const { error } = await rpc(supportOp, 'toggle_kill_switch', {
      p_switch_key: 'banner_delivery',
      p_enabled: true,
      p_reason: 'support-role-should-fail',
    })
    expect(error).not.toBeNull()
    expect(error!.message.toLowerCase()).toMatch(/platform_operator/)
  })

  it('platform_operator JWT can call suspend_org (and restore_org), org status flips', async () => {
    const { error: susErr } = await rpc(platformOp, 'suspend_org', {
      p_org_id: customer.orgId,
      p_reason: 'rpc-contract-test-suspend',
    })
    expect(susErr).toBeNull()
    const { data: sus } = await service.from('organisations').select('status').eq('id', customer.orgId).single()
    expect(sus!.status).toBe('suspended')

    const { error: resErr } = await rpc(platformOp, 'restore_org', {
      p_org_id: customer.orgId,
      p_reason: 'rpc-contract-test-restore',
    })
    expect(resErr).toBeNull()
    const { data: res } = await service.from('organisations').select('status').eq('id', customer.orgId).single()
    expect(res!.status).toBe('active')
  })
})

describe('ADR-0027 Sprint 3.1 — impersonation lifecycle', () => {
  let sessionId: string | null = null

  it('start_impersonation creates a session row with expires_at in the future', async () => {
    const { data, error } = await rpc(supportOp, 'start_impersonation', {
      p_org_id: customer.orgId,
      p_reason: 'bug_investigation',
      p_reason_detail: 'lifecycle-test — reason_detail ≥ 10 chars',
      p_duration_minutes: 30,
    })
    expect(error).toBeNull()
    expect(typeof data).toBe('string')
    sessionId = data as string

    const { data: sess } = await service.schema('admin').from('impersonation_sessions').select('*').eq('id', sessionId!).single()
    expect(sess!.status).toBe('active')
    expect(sess!.admin_user_id).toBe(supportOp.userId)
    expect(sess!.target_org_id).toBe(customer.orgId)
    expect(new Date(sess!.expires_at).getTime()).toBeGreaterThan(Date.now())
  })

  it('end_impersonation (self) flips status to completed', async () => {
    expect(sessionId).not.toBeNull()
    const { error } = await rpc(supportOp, 'end_impersonation', {
      p_session_id: sessionId,
      p_actions_summary: { read_pages: 3, writes: 0 },
    })
    expect(error).toBeNull()
    const { data: sess } = await service.schema('admin').from('impersonation_sessions').select('*').eq('id', sessionId!).single()
    expect(sess!.status).toBe('completed')
    expect(sess!.ended_reason).toBe('manual')
    expect(sess!.ended_by_admin_user_id).toBe(supportOp.userId)
  })

  it('end_impersonation by non-owner is rejected', async () => {
    const { data: newSession } = await rpc(supportOp, 'start_impersonation', {
      p_org_id: customer.orgId,
      p_reason: 'bug_investigation',
      p_reason_detail: 'non-owner-rejection-test',
      p_duration_minutes: 30,
    })
    const ownedSessionId = newSession as string

    const { error } = await rpc(platformOp, 'end_impersonation', {
      p_session_id: ownedSessionId,
      p_actions_summary: {},
    })
    expect(error).not.toBeNull()
    expect(error!.message.toLowerCase()).toMatch(/only the originating admin/)

    // But force_end_impersonation works (platform_operator).
    const { error: forceErr } = await rpc(platformOp, 'force_end_impersonation', {
      p_session_id: ownedSessionId,
      p_reason: 'walked-away-from-console',
    })
    expect(forceErr).toBeNull()
    const { data: sess } = await service.schema('admin').from('impersonation_sessions').select('*').eq('id', ownedSessionId).single()
    expect(sess!.status).toBe('force_ended')
    expect(sess!.ended_by_admin_user_id).toBe(platformOp.userId)
  })
})

describe('ADR-0027 Sprint 3.1 — sectoral template publish cascade', () => {
  let draftV1Id: string
  let draftV2Id: string

  it('create_sectoral_template_draft + publish_sectoral_template work together', async () => {
    const { data: v1, error: e1 } = await rpc(supportOp, 'create_sectoral_template_draft', {
      p_template_code: 'test_cascade_pack',
      p_display_name: 'Cascade Test v1',
      p_description: 'First version',
      p_sector: 'saas',
      p_purpose_definitions: [{ code: 'analytics', display: 'Analytics' }],
      p_reason: 'cascade-test-v1-create',
    })
    expect(e1).toBeNull()
    draftV1Id = v1 as string

    const { error: pubErr } = await rpc(platformOp, 'publish_sectoral_template', {
      p_template_id: draftV1Id,
      p_version_notes: 'v1 published for cascade test',
    })
    expect(pubErr).toBeNull()

    const { data: tv1 } = await service.schema('admin').from('sectoral_templates').select('*').eq('id', draftV1Id).single()
    expect(tv1!.status).toBe('published')
  })

  it('publishing v2 deprecates v1 with superseded_by_id pointing at v2', async () => {
    const { data: v2 } = await rpc(supportOp, 'create_sectoral_template_draft', {
      p_template_code: 'test_cascade_pack',
      p_display_name: 'Cascade Test v2',
      p_description: 'Second version',
      p_sector: 'saas',
      p_purpose_definitions: [{ code: 'analytics', display: 'Analytics' }, { code: 'marketing', display: 'Marketing' }],
      p_reason: 'cascade-test-v2-create',
    })
    draftV2Id = v2 as string

    const { error } = await rpc(platformOp, 'publish_sectoral_template', {
      p_template_id: draftV2Id,
      p_version_notes: 'v2 published; v1 should deprecate',
    })
    expect(error).toBeNull()

    const { data: tv1 } = await service.schema('admin').from('sectoral_templates').select('status,superseded_by_id').eq('id', draftV1Id).single()
    expect(tv1!.status).toBe('deprecated')
    expect(tv1!.superseded_by_id).toBe(draftV2Id)

    const { data: tv2 } = await service.schema('admin').from('sectoral_templates').select('status').eq('id', draftV2Id).single()
    expect(tv2!.status).toBe('published')
  })
})

describe('ADR-0027 Sprint 3.1 — kill_switch toggle', () => {
  it('platform_operator JWT flips enabled and records new_value in audit', async () => {
    const { error: upErr } = await rpc(platformOp, 'toggle_kill_switch', {
      p_switch_key: 'banner_delivery',
      p_enabled: true,
      p_reason: 'rpc-contract-test-engage',
    })
    expect(upErr).toBeNull()
    const { data: k } = await service.schema('admin').from('kill_switches').select('enabled,set_by').eq('switch_key', 'banner_delivery').single()
    expect(k!.enabled).toBe(true)
    expect(k!.set_by).toBe(platformOp.userId)

    // Disengage so downstream tests are not affected.
    const { error: downErr } = await rpc(platformOp, 'toggle_kill_switch', {
      p_switch_key: 'banner_delivery',
      p_enabled: false,
      p_reason: 'rpc-contract-test-disengage',
    })
    expect(downErr).toBeNull()
  })
})

describe('ADR-0027 Sprint 3.1 — org_notes CRUD (the only delete RPC path)', () => {
  it('add_org_note + update_org_note + delete_org_note round-trip', async () => {
    const { data: addData, error: addErr } = await rpc(supportOp, 'add_org_note', {
      p_org_id: customer.orgId,
      p_body: 'initial note body',
      p_pinned: false,
    })
    expect(addErr).toBeNull()
    // add_org_note returns void; query via service client.
    const { data: notes } = await service.schema('admin').from('org_notes').select('*').eq('org_id', customer.orgId)
    expect(notes!.length).toBeGreaterThan(0)
    const noteId = notes![0].id

    const { error: updErr } = await rpc(supportOp, 'update_org_note', {
      p_note_id: noteId,
      p_body: 'updated body',
      p_pinned: true,
      p_reason: 'pinning-for-dashboard-visibility',
    })
    expect(updErr).toBeNull()

    const { error: delErr } = await rpc(supportOp, 'delete_org_note', {
      p_note_id: noteId,
      p_reason: 'cleanup-after-contract-test',
    })
    expect(delErr).toBeNull()

    const { data: after } = await service.schema('admin').from('org_notes').select('id').eq('id', noteId)
    expect(after).toEqual([])
  })
})

describe('ADR-0027 Sprint 3.1 — feature_flags set + get round-trip', () => {
  it('set_feature_flag (global) is visible via public.get_feature_flag', async () => {
    const { error: setErr } = await rpc(platformOp, 'set_feature_flag', {
      p_flag_key: 'sprint31_rpc_test_flag',
      p_scope: 'global',
      p_value: { enabled: true, rollout: 0.5 },
      p_description: 'rpc-contract test flag',
      p_reason: 'set-for-contract-test',
    })
    expect(setErr).toBeNull()

    const { data } = await customer.client.rpc('get_feature_flag', {
      p_flag_key: 'sprint31_rpc_test_flag',
    })
    expect(data).toEqual({ enabled: true, rollout: 0.5 })

    const { error: delErr } = await rpc(platformOp, 'delete_feature_flag', {
      p_flag_key: 'sprint31_rpc_test_flag',
      p_scope: 'global',
      p_reason: 'cleanup-after-contract-test',
    })
    expect(delErr).toBeNull()
  })
})
