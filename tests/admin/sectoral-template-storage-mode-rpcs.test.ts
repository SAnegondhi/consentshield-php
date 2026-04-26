// ADR-1003 Sprint 4.2 — admin draft RPCs with default_storage_mode + connector_defaults.
//
// Verifies the migration-61 amendments to:
//   - admin.create_sectoral_template_draft
//   - admin.update_sectoral_template_draft
//
// Cases:
//   1. Backwards compat — both RPCs callable without the new params (existing
//      Sprint 3.1 test in rpcs.test.ts also exercises this; we re-confirm here
//      to keep the migration's intent explicit).
//   2. Create with both new params set — row materialises with
//      default_storage_mode and connector_defaults populated; audit entry's
//      new_value carries both fields.
//   3. Update flips both fields on an existing draft.
//   4. Validation: invalid default_storage_mode → 22023.
//   5. Validation: connector_defaults as a JSON array (not an object) → 22023.

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  createAdminTestUser,
  cleanupAdminTestUser,
  getAdminServiceClient,
  type AdminTestUser,
} from './helpers'

let supportOp: AdminTestUser
const service = getAdminServiceClient()

beforeAll(async () => {
  supportOp = await createAdminTestUser('support')
}, 60000)

afterAll(async () => {
  if (supportOp) await cleanupAdminTestUser(supportOp)
}, 60000)

async function rpc(user: AdminTestUser, name: string, args: Record<string, unknown>) {
  return user.client.schema('admin').rpc(name, args)
}

describe('ADR-1003 Sprint 4.2 — create_sectoral_template_draft with new params', () => {
  let createdId: string

  it('omitting both new params still works (backward compat)', async () => {
    const code = `s42_compat_${Date.now()}`
    const { data, error } = await rpc(supportOp, 'create_sectoral_template_draft', {
      p_template_code: code,
      p_display_name: 'Sprint 4.2 compat',
      p_description: 'Backward-compat probe — no storage_mode or connector_defaults',
      p_sector: 'general',
      p_purpose_definitions: [{ purpose_code: 'essential', display_name: 'Essential' }],
      p_reason: 'sprint-4.2-compat-test',
    })
    expect(error).toBeNull()
    expect(data).toBeTruthy()

    const { data: row } = await service
      .schema('admin')
      .from('sectoral_templates')
      .select('default_storage_mode, connector_defaults')
      .eq('id', data as string)
      .single()
    expect(row!.default_storage_mode).toBeNull()
    expect(row!.connector_defaults).toBeNull()

    await service.schema('admin').from('sectoral_templates').delete().eq('id', data as string)
  })

  it('creates a draft with both fields populated', async () => {
    const code = `s42_with_${Date.now()}`
    const connectorDefaults = {
      emr_vendor: { category: 'electronic_medical_record', examples: ['Practo'] },
      reminder_vendor: { category: 'messaging', examples: ['MSG91'] },
    }
    const { data, error } = await rpc(supportOp, 'create_sectoral_template_draft', {
      p_template_code: code,
      p_display_name: 'Sprint 4.2 with mode + connectors',
      p_description: 'Healthcare-shaped draft via the new RPC params',
      p_sector: 'healthcare',
      p_purpose_definitions: [{ purpose_code: 'tele', display_name: 'Tele' }],
      p_reason: 'sprint-4.2-with-mode-test',
      p_default_storage_mode: 'zero_storage',
      p_connector_defaults: connectorDefaults,
    })
    expect(error).toBeNull()
    createdId = data as string

    const { data: row } = await service
      .schema('admin')
      .from('sectoral_templates')
      .select('default_storage_mode, connector_defaults')
      .eq('id', createdId)
      .single()
    expect(row!.default_storage_mode).toBe('zero_storage')
    expect(row!.connector_defaults).toEqual(connectorDefaults)

    // Audit-log payload reflects the new fields.
    const { data: audit } = await service
      .schema('admin')
      .from('admin_audit_log')
      .select('new_value')
      .eq('action', 'create_sectoral_template_draft')
      .eq('target_id', createdId)
      .order('occurred_at', { ascending: false })
      .limit(1)
      .single()
    const nv = audit!.new_value as Record<string, unknown>
    expect(nv.default_storage_mode).toBe('zero_storage')
    expect(nv.connector_defaults).toEqual(connectorDefaults)
  }, 30000)

  it('refuses an invalid default_storage_mode value', async () => {
    const { error } = await rpc(supportOp, 'create_sectoral_template_draft', {
      p_template_code: `s42_bad_${Date.now()}`,
      p_display_name: 'Bad mode',
      p_description: 'Should reject',
      p_sector: 'general',
      p_purpose_definitions: [{ purpose_code: 'a', display_name: 'A' }],
      p_reason: 'sprint-4.2-bad-mode-test',
      p_default_storage_mode: 'multi_region', // not in the enum
    })
    expect(error).toBeTruthy()
    expect(error!.code).toBe('22023')
    expect(error!.message).toMatch(/default_storage_mode must be one of/)
  })

  it('refuses connector_defaults as a JSON array', async () => {
    const { error } = await rpc(supportOp, 'create_sectoral_template_draft', {
      p_template_code: `s42_arr_${Date.now()}`,
      p_display_name: 'Bad connectors',
      p_description: 'Should reject',
      p_sector: 'general',
      p_purpose_definitions: [{ purpose_code: 'a', display_name: 'A' }],
      p_reason: 'sprint-4.2-bad-connectors-test',
      p_connector_defaults: ['not_an_object'],
    })
    expect(error).toBeTruthy()
    expect(error!.code).toBe('22023')
    expect(error!.message).toMatch(/connector_defaults must be a JSON object/)
  })
})

describe('ADR-1003 Sprint 4.2 — update_sectoral_template_draft amends both fields', () => {
  let draftId: string

  beforeAll(async () => {
    const { data } = await rpc(supportOp, 'create_sectoral_template_draft', {
      p_template_code: `s42_upd_${Date.now()}`,
      p_display_name: 'Sprint 4.2 update target',
      p_description: 'Initial state — no mode, no connectors',
      p_sector: 'general',
      p_purpose_definitions: [{ purpose_code: 'a', display_name: 'A' }],
      p_reason: 'sprint-4.2-update-setup',
    })
    draftId = data as string
  }, 30000)

  it('flips default_storage_mode and connector_defaults', async () => {
    const newConnectors = {
      crm_vendor: { category: 'crm', examples: ['Salesforce'] },
    }
    const { error } = await rpc(supportOp, 'update_sectoral_template_draft', {
      p_template_id: draftId,
      p_display_name: 'Sprint 4.2 update target',
      p_description: 'Updated — now carries mode + connectors',
      p_purpose_definitions: [{ purpose_code: 'a', display_name: 'A' }],
      p_reason: 'sprint-4.2-update-flip',
      p_default_storage_mode: 'insulated',
      p_connector_defaults: newConnectors,
    })
    expect(error).toBeNull()

    const { data: row } = await service
      .schema('admin')
      .from('sectoral_templates')
      .select('default_storage_mode, connector_defaults')
      .eq('id', draftId)
      .single()
    expect(row!.default_storage_mode).toBe('insulated')
    expect(row!.connector_defaults).toEqual(newConnectors)
  }, 30000)

  it('clearing both fields back to NULL also works', async () => {
    const { error } = await rpc(supportOp, 'update_sectoral_template_draft', {
      p_template_id: draftId,
      p_display_name: 'Sprint 4.2 update target',
      p_description: 'Cleared — back to NULL',
      p_purpose_definitions: [{ purpose_code: 'a', display_name: 'A' }],
      p_reason: 'sprint-4.2-update-clear',
      p_default_storage_mode: null,
      p_connector_defaults: null,
    })
    expect(error).toBeNull()

    const { data: row } = await service
      .schema('admin')
      .from('sectoral_templates')
      .select('default_storage_mode, connector_defaults')
      .eq('id', draftId)
      .single()
    expect(row!.default_storage_mode).toBeNull()
    expect(row!.connector_defaults).toBeNull()
  })
})
