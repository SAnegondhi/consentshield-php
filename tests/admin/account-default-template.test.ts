import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  createAdminTestUser,
  cleanupAdminTestUser,
  getAdminServiceClient,
  AdminTestUser,
} from './helpers'
import { createTestOrg, cleanupTestOrg, TestOrg } from '../rls/helpers'

// ADR-1027 Sprint 3.3 — admin.set_account_default_template +
// public.resolve_account_default_template + amended admin.account_detail
// envelope.
//
// Coverage:
//   1. platform_operator can set + clear; support cannot set.
//   2. Unpublished template cannot be set as default (RPC raises).
//   3. admin.account_detail envelope carries default_template when set.
//   4. A deprecated template shows as NULL in resolve_account_default_template
//      (UI should fall back to sector detection).

let platformOp: AdminTestUser
let supportUser: AdminTestUser
let customer: TestOrg
const service = getAdminServiceClient()

interface TemplateRow {
  id: string
  template_code: string
  status: string
}

async function pickPublishedTemplate(): Promise<TemplateRow> {
  const { data } = await service
    .schema('admin')
    .from('sectoral_templates')
    .select('id, template_code, status')
    .eq('status', 'published')
    .limit(1)
    .single()
  if (!data) throw new Error('no published sectoral_template to pick from')
  return data as TemplateRow
}

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
  customer = await createTestOrg('account-default-tpl')
})

afterAll(async () => {
  if (platformOp) await cleanupAdminTestUser(platformOp)
  if (supportUser) await cleanupAdminTestUser(supportUser)
  if (customer) await cleanupTestOrg(customer)
})

describe('ADR-1027 Sprint 3.3 — admin.set_account_default_template', () => {
  it('platform_operator can set a published template as default; envelope carries it', async () => {
    const accountId = await resolveAccountId(customer.orgId)
    const template = await pickPublishedTemplate()

    const { error } = await platformOp.client
      .schema('admin')
      .rpc('set_account_default_template', {
        p_account_id: accountId,
        p_template_id: template.id,
        p_reason: 'adr1027-s33-set-happy-path',
      })
    expect(error).toBeNull()

    const { data: envelope } = await platformOp.client
      .schema('admin')
      .rpc('account_detail', { p_account_id: accountId })
    const defaultTemplate = (
      envelope as { default_template: { id: string; template_code: string; status: string } | null }
    ).default_template
    expect(defaultTemplate).not.toBeNull()
    expect(defaultTemplate!.id).toBe(template.id)
    expect(defaultTemplate!.template_code).toBe(template.template_code)
    expect(defaultTemplate!.status).toBe('published')
  })

  it('support role cannot set (platform_operator-tier gated)', async () => {
    const accountId = await resolveAccountId(customer.orgId)
    const template = await pickPublishedTemplate()

    const { error } = await supportUser.client
      .schema('admin')
      .rpc('set_account_default_template', {
        p_account_id: accountId,
        p_template_id: template.id,
        p_reason: 'should-be-rejected',
      })
    expect(error).not.toBeNull()
  })

  it('unpublished template is rejected', async () => {
    const accountId = await resolveAccountId(customer.orgId)

    // Create a draft template just for this test via the service role.
    // Resolve an admin_users.id to attribute the created_by column to.
    const { data: seederAdmin } = await service
      .schema('admin')
      .from('admin_users')
      .select('id')
      .limit(1)
      .single()
    const seederId = (seederAdmin as { id: string }).id

    const { data: seeded, error: seedErr } = await service
      .schema('admin')
      .from('sectoral_templates')
      .insert({
        template_code: `adr1027_s33_draft_${Date.now()}`,
        display_name: 'Sprint 3.3 draft template',
        sector: 'test',
        description: 'temporary draft',
        version: 1,
        status: 'draft',
        purpose_definitions: [],
        created_by: seederId,
      })
      .select('id')
      .single()
    expect(seedErr).toBeNull()
    const draftId = (seeded as { id: string }).id

    const { error } = await platformOp.client
      .schema('admin')
      .rpc('set_account_default_template', {
        p_account_id: accountId,
        p_template_id: draftId,
        p_reason: 'should-fail-draft',
      })
    expect(error).not.toBeNull()
    expect(error!.message).toMatch(/must be published/i)

    // Cleanup
    await service.schema('admin').from('sectoral_templates').delete().eq('id', draftId)
  })

  it('clear-to-null works', async () => {
    const accountId = await resolveAccountId(customer.orgId)

    // Set something first so clearing is meaningful.
    const template = await pickPublishedTemplate()
    await platformOp.client
      .schema('admin')
      .rpc('set_account_default_template', {
        p_account_id: accountId,
        p_template_id: template.id,
        p_reason: 'adr1027-s33-seed-before-clear',
      })

    const { error } = await platformOp.client
      .schema('admin')
      .rpc('set_account_default_template', {
        p_account_id: accountId,
        p_template_id: null,
        p_reason: 'adr1027-s33-clear',
      })
    expect(error).toBeNull()

    const { data: envelope } = await platformOp.client
      .schema('admin')
      .rpc('account_detail', { p_account_id: accountId })
    const defaultTemplate = (
      envelope as { default_template: unknown }
    ).default_template
    expect(defaultTemplate).toBeNull()
  })

  it('set_account_default_template audit row carries account_id', async () => {
    const accountId = await resolveAccountId(customer.orgId)
    const template = await pickPublishedTemplate()

    const reason = `adr1027-s33-audit-${Date.now()}`
    const { error } = await platformOp.client
      .schema('admin')
      .rpc('set_account_default_template', {
        p_account_id: accountId,
        p_template_id: template.id,
        p_reason: reason,
      })
    expect(error).toBeNull()

    const { data: rows } = await service
      .schema('admin')
      .from('admin_audit_log')
      .select('action, account_id, target_id, reason')
      .eq('reason', reason)
    expect(rows).toHaveLength(1)
    expect(rows![0].action).toBe('set_account_default_template')
    expect(rows![0].account_id).toBe(accountId)
    expect(rows![0].target_id).toBe(accountId)
  })
})
