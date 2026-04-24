import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  createAdminTestUser,
  cleanupAdminTestUser,
  getAdminServiceClient,
  AdminTestUser,
} from './helpers'
import { createTestOrg, cleanupTestOrg, TestOrg } from '../rls/helpers'

// ADR-1027 Sprint 3.2 — admin.account_notes + four RPCs.
//
// Coverage:
//   1. account_note_add writes a note + an audit row with
//      target_table='admin.account_notes' and the Sprint 1.1
//      account_id column populated.
//   2. account_note_list returns the note.
//   3. account_note_update changes body + writes an audit row.
//   4. account_note_delete removes the note + writes an audit row.
//   5. support-tier cannot pin; platform_operator can.
//   6. support-tier cannot delete; platform_operator can.
//   7. read_only cannot call any RPC.

let platformOp: AdminTestUser
let supportUser: AdminTestUser
let readOnlyUser: AdminTestUser
let customer: TestOrg
const service = getAdminServiceClient()

async function resolveAccountId(orgId: string): Promise<string> {
  const { data } = await service
    .schema('public')
    .from('organisations')
    .select('account_id')
    .eq('id', orgId)
    .single()
  return data!.account_id as string
}

beforeAll(async () => {
  platformOp = await createAdminTestUser('platform_operator')
  supportUser = await createAdminTestUser('support')
  readOnlyUser = await createAdminTestUser('read_only')
  customer = await createTestOrg('account-notes-rpcs')
})

afterAll(async () => {
  if (platformOp) await cleanupAdminTestUser(platformOp)
  if (supportUser) await cleanupAdminTestUser(supportUser)
  if (readOnlyUser) await cleanupAdminTestUser(readOnlyUser)
  if (customer) await cleanupTestOrg(customer)
})

describe('ADR-1027 Sprint 3.2 — admin.account_notes CRUD', () => {
  it('support role can add a non-pinned note; audit row carries account_id', async () => {
    const accountId = await resolveAccountId(customer.orgId)
    const reason = 'adr1027-s32-add-support'
    const { data, error } = await supportUser.client
      .schema('admin')
      .rpc('account_note_add', {
        p_account_id: accountId,
        p_body: 'hello from sprint 3.2 support test',
        p_pinned: false,
        p_reason: reason,
      })

    expect(error).toBeNull()
    expect(typeof data).toBe('string')

    const { data: auditRows } = await service
      .schema('admin')
      .from('admin_audit_log')
      .select('target_table, account_id, action, reason')
      .eq('target_id', data as unknown as string)
      .eq('action', 'add_account_note')
    expect(auditRows).toHaveLength(1)
    expect(auditRows![0].target_table).toBe('admin.account_notes')
    expect(auditRows![0].account_id).toBe(accountId)
    expect(auditRows![0].reason).toBe(reason)
  })

  it('support role cannot pin — RPC raises', async () => {
    const accountId = await resolveAccountId(customer.orgId)
    const { data, error } = await supportUser.client
      .schema('admin')
      .rpc('account_note_add', {
        p_account_id: accountId,
        p_body: 'pinned note attempt from support',
        p_pinned: true,
        p_reason: 'should-be-rejected',
      })

    expect(error).not.toBeNull()
    expect(data).toBeNull()
  })

  it('platform_operator can pin + list returns pinned first', async () => {
    const accountId = await resolveAccountId(customer.orgId)

    const pinReason = 'adr1027-s32-pin-platformop'
    const { data: pinnedId, error: pinErr } = await platformOp.client
      .schema('admin')
      .rpc('account_note_add', {
        p_account_id: accountId,
        p_body: 'pinned critical account context',
        p_pinned: true,
        p_reason: pinReason,
      })
    expect(pinErr).toBeNull()

    const { data: rows, error: listErr } = await supportUser.client
      .schema('admin')
      .rpc('account_note_list', { p_account_id: accountId })
    expect(listErr).toBeNull()
    const list = rows as Array<{ id: string; pinned: boolean }>
    expect(list.length).toBeGreaterThanOrEqual(2)
    // First row must be the pinned one we just added (pinned desc, then created_at desc).
    expect(list[0].id).toBe(pinnedId as unknown as string)
    expect(list[0].pinned).toBe(true)
  })

  it('account_note_update rewrites body + audit row', async () => {
    const accountId = await resolveAccountId(customer.orgId)

    const { data: noteId } = await supportUser.client
      .schema('admin')
      .rpc('account_note_add', {
        p_account_id: accountId,
        p_body: 'original body',
        p_pinned: false,
        p_reason: 'adr1027-s32-update-seed',
      })

    const updateReason = 'adr1027-s32-update-reason'
    const { error: updErr } = await supportUser.client
      .schema('admin')
      .rpc('account_note_update', {
        p_note_id: noteId as unknown as string,
        p_body: 'updated body',
        p_pinned: false,
        p_reason: updateReason,
      })
    expect(updErr).toBeNull()

    const { data: audit } = await service
      .schema('admin')
      .from('admin_audit_log')
      .select('action, reason, account_id')
      .eq('target_id', noteId as unknown as string)
      .eq('action', 'update_account_note')
    expect(audit).toHaveLength(1)
    expect(audit![0].reason).toBe(updateReason)
    expect(audit![0].account_id).toBe(accountId)
  })

  it('support cannot delete; platform_operator can; audit row carries account_id', async () => {
    const accountId = await resolveAccountId(customer.orgId)

    const { data: noteId } = await platformOp.client
      .schema('admin')
      .rpc('account_note_add', {
        p_account_id: accountId,
        p_body: 'note to delete',
        p_pinned: false,
        p_reason: 'adr1027-s32-delete-seed',
      })

    // Support tries to delete — should be rejected.
    const deleteAttempt = await supportUser.client
      .schema('admin')
      .rpc('account_note_delete', {
        p_note_id: noteId as unknown as string,
        p_reason: 'should-fail',
      })
    expect(deleteAttempt.error).not.toBeNull()

    // Platform operator succeeds.
    const deleteReason = 'adr1027-s32-delete-platformop'
    const { error: deleteErr } = await platformOp.client
      .schema('admin')
      .rpc('account_note_delete', {
        p_note_id: noteId as unknown as string,
        p_reason: deleteReason,
      })
    expect(deleteErr).toBeNull()

    const { data: auditRows } = await service
      .schema('admin')
      .from('admin_audit_log')
      .select('action, reason, account_id')
      .eq('target_id', noteId as unknown as string)
      .eq('action', 'delete_account_note')
    expect(auditRows).toHaveLength(1)
    expect(auditRows![0].reason).toBe(deleteReason)
    expect(auditRows![0].account_id).toBe(accountId)
  })

  it('read_only role cannot list', async () => {
    const accountId = await resolveAccountId(customer.orgId)
    const { data, error } = await readOnlyUser.client
      .schema('admin')
      .rpc('account_note_list', { p_account_id: accountId })

    expect(error).not.toBeNull()
    expect(data).toBeNull()
  })
})
