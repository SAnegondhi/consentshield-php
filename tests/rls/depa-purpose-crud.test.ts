// ADR-0024 Sprint 1.4 — RLS cross-tenant isolation for Purpose Definitions
// and Connector Mappings.
//
// The customer-facing UI (ADR-0024) performs CRUD via the authenticated
// supabase client with no org_id check — RLS carries the boundary. These
// tests confirm that an admin JWT from org A cannot read, write, update,
// or delete purpose_definitions or purpose_connector_mappings that belong
// to org B.
//
// No new policies ship in ADR-0024; the policies under test were authored
// in ADR-0020 (migrations 20260418000002 + 20260418000003). These tests
// lock them in against regression.

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import {
  createTestOrg,
  cleanupTestOrg,
  getServiceClient,
  TestOrg,
} from './helpers'

let orgA: TestOrg
let orgB: TestOrg
let orgBPurposeId: string
let orgBMappingId: string
let orgBConnectorId: string

beforeAll(async () => {
  orgA = await createTestOrg('depa-crud-a')
  orgB = await createTestOrg('depa-crud-b')

  const admin = getServiceClient()

  // Seed org B with a purpose + connector + mapping.
  const { data: purpose, error: pErr } = await admin
    .from('purpose_definitions')
    .insert({
      org_id: orgB.orgId,
      purpose_code: 'marketing_crosstest',
      display_name: 'Marketing',
      description: 'Cross-tenant test purpose',
      data_scope: ['email_address'],
      default_expiry_days: 180,
      framework: 'dpdp',
    })
    .select('id')
    .single()
  if (pErr) throw new Error(`seed purpose: ${pErr.message}`)
  orgBPurposeId = purpose.id as string

  const { data: connector, error: cErr } = await admin
    .from('integration_connectors')
    .insert({
      org_id: orgB.orgId,
      connector_type: 'webhook',
      display_name: 'TestConnector',
      config: '\\x7b7d',
      status: 'active',
    })
    .select('id')
    .single()
  if (cErr) throw new Error(`seed connector: ${cErr.message}`)
  orgBConnectorId = connector.id as string

  const { data: mapping, error: mErr } = await admin
    .from('purpose_connector_mappings')
    .insert({
      org_id: orgB.orgId,
      purpose_definition_id: orgBPurposeId,
      connector_id: orgBConnectorId,
      data_categories: ['email_address'],
    })
    .select('id')
    .single()
  if (mErr) throw new Error(`seed mapping: ${mErr.message}`)
  orgBMappingId = mapping.id as string
}, 90_000)

afterAll(async () => {
  if (orgA) await cleanupTestOrg(orgA)
  if (orgB) await cleanupTestOrg(orgB)
}, 60_000)

// ═══════════════════════════════════════════════════════════
// purpose_definitions
// ═══════════════════════════════════════════════════════════

describe('ADR-0024 W3 — purpose_definitions cross-tenant isolation', () => {
  it('org A SELECT does not return org B purposes', async () => {
    const { data, error } = await orgA.client
      .from('purpose_definitions')
      .select('id')
      .eq('id', orgBPurposeId)
    expect(error).toBeNull()
    expect(data).toEqual([])
  })

  it('org A INSERT with org_id = org B fails RLS', async () => {
    const { error } = await orgA.client.from('purpose_definitions').insert({
      org_id: orgB.orgId,
      purpose_code: 'injected',
      display_name: 'Injected',
      description: 'Should be blocked',
      data_scope: [],
      default_expiry_days: 365,
      framework: 'dpdp',
    })
    expect(error).toBeTruthy()
  })

  it('org A UPDATE of org B purpose is a silent no-op (RLS hides row)', async () => {
    const { data, error } = await orgA.client
      .from('purpose_definitions')
      .update({ display_name: 'Hijacked' })
      .eq('id', orgBPurposeId)
      .select('id')
    expect(error).toBeNull()
    expect(data).toEqual([])

    // Verify org B row is unchanged.
    const admin = getServiceClient()
    const { data: verify } = await admin
      .from('purpose_definitions')
      .select('display_name')
      .eq('id', orgBPurposeId)
      .single()
    expect(verify?.display_name).toBe('Marketing')
  })
})

// ═══════════════════════════════════════════════════════════
// purpose_connector_mappings
// ═══════════════════════════════════════════════════════════

describe('ADR-0024 W3 — purpose_connector_mappings cross-tenant isolation', () => {
  it('org A SELECT does not return org B mapping', async () => {
    const { data, error } = await orgA.client
      .from('purpose_connector_mappings')
      .select('id')
      .eq('id', orgBMappingId)
    expect(error).toBeNull()
    expect(data).toEqual([])
  })

  it('org A DELETE against org B mapping is a silent no-op', async () => {
    const { error } = await orgA.client
      .from('purpose_connector_mappings')
      .delete()
      .eq('id', orgBMappingId)
    expect(error).toBeNull()

    // Row still present from the admin view.
    const admin = getServiceClient()
    const { data: verify } = await admin
      .from('purpose_connector_mappings')
      .select('id')
      .eq('id', orgBMappingId)
      .single()
    expect(verify?.id).toBe(orgBMappingId)
  })
})
