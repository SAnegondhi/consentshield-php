// ADR-1003 Sprint 4.1 — Healthcare Starter sectoral template.
//
// Verifies:
//   1. The seeded admin.sectoral_templates row is well-formed
//      (7 purposes, default_storage_mode='zero_storage', connector_defaults
//      includes appointment_reminder_vendor + emr_vendor).
//   2. apply_sectoral_template('healthcare_starter') succeeds when the
//      caller's org is in storage_mode='zero_storage' and materialises
//      7 purpose_definitions rows.
//   3. The same call against a 'standard' org raises SQLSTATE P0004 with
//      a message naming the required mode.
//
// Uses the RLS test helpers (service-role bypasses RLS for setup) +
// authenticated user clients to exercise the SECURITY DEFINER function
// from the customer side.

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  cleanupTestOrg,
  createTestOrg,
  getServiceClient,
  type TestOrg,
} from '../rls/helpers'

describe('ADR-1003 Sprint 4.1 healthcare template seed', () => {
  it('seeded row exists with the expected shape', async () => {
    const service = getServiceClient()
    const { data, error } = await service
      .schema('admin')
      .from('sectoral_templates')
      .select(
        'template_code, status, sector, default_storage_mode, purpose_definitions, connector_defaults',
      )
      .eq('template_code', 'healthcare_starter')
      .order('version', { ascending: false })
      .limit(1)
      .single()

    expect(error).toBeNull()
    expect(data).toBeTruthy()
    expect(data!.status).toBe('published')
    expect(data!.sector).toBe('healthcare')
    expect(data!.default_storage_mode).toBe('zero_storage')

    const purposes = data!.purpose_definitions as Array<{ purpose_code: string }>
    expect(Array.isArray(purposes)).toBe(true)
    expect(purposes.length).toBe(7)
    const codes = purposes.map((p) => p.purpose_code).sort()
    expect(codes).toEqual(
      [
        'appointment_reminders',
        'insurance_claim_share_abdm',
        'lab_report_access',
        'marketing',
        'prescription_dispensing',
        'research_broad_consent',
        'teleconsultation',
      ].sort(),
    )

    const connectors = data!.connector_defaults as Record<
      string,
      { category?: string; examples?: string[] }
    >
    expect(connectors).toBeTruthy()
    expect(Object.keys(connectors).sort()).toEqual([
      'appointment_reminder_vendor',
      'emr_vendor',
    ])
    expect(connectors.appointment_reminder_vendor.category).toBe('messaging')
    expect(connectors.emr_vendor.category).toBe('electronic_medical_record')
  })
})

describe('ADR-1003 Sprint 4.1 apply healthcare_starter', () => {
  let zeroStorageOrg: TestOrg
  let standardOrg: TestOrg

  beforeAll(async () => {
    zeroStorageOrg = await createTestOrg('hc-zero')
    standardOrg = await createTestOrg('hc-std')

    // Flip zeroStorageOrg's storage_mode directly via service-role.
    // The customer-side admin.set_organisation_storage_mode RPC requires
    // an admin JWT; for test scaffolding we bypass it.
    const service = getServiceClient()
    const { error } = await service
      .from('organisations')
      .update({ storage_mode: 'zero_storage' })
      .eq('id', zeroStorageOrg.orgId)
    if (error) throw new Error(`flip mode failed: ${error.message}`)
  }, 60000)

  afterAll(async () => {
    if (zeroStorageOrg) await cleanupTestOrg(zeroStorageOrg)
    if (standardOrg) await cleanupTestOrg(standardOrg)
  }, 60000)

  it('succeeds and materialises 7 purposes for a zero_storage org', async () => {
    const { data, error } = await zeroStorageOrg.client.rpc(
      'apply_sectoral_template',
      { p_template_code: 'healthcare_starter' },
    )
    expect(error).toBeNull()
    const result = data as {
      code: string
      version: number
      purpose_count: number
      materialised_count: number
      storage_mode: string
    }
    expect(result.code).toBe('healthcare_starter')
    expect(result.purpose_count).toBe(7)
    expect(result.materialised_count).toBe(7)
    expect(result.storage_mode).toBe('zero_storage')

    // Confirm the rows actually landed under the caller's org.
    const service = getServiceClient()
    const { data: rows } = await service
      .from('purpose_definitions')
      .select('purpose_code')
      .eq('org_id', zeroStorageOrg.orgId)
    const codes = (rows ?? []).map((r) => r.purpose_code).sort()
    expect(codes).toContain('teleconsultation')
    expect(codes).toContain('appointment_reminders')
    expect(codes).toContain('insurance_claim_share_abdm')
    expect(codes.length).toBe(7)
  }, 30000)

  it('refuses with P0004 against a standard-mode org', async () => {
    const { error } = await standardOrg.client.rpc('apply_sectoral_template', {
      p_template_code: 'healthcare_starter',
    })
    expect(error).toBeTruthy()
    // Postgres errcode P0004 surfaces through PostgREST as code 'P0004' on
    // the error.code field. The message names both the required and actual
    // modes.
    expect(error!.code).toBe('P0004')
    expect(error!.message).toMatch(/storage_mode=zero_storage/)
    expect(error!.message).toMatch(/standard/)

    // Confirm zero rows were materialised on the failing call.
    const service = getServiceClient()
    const { count } = await service
      .from('purpose_definitions')
      .select('id', { count: 'exact', head: true })
      .eq('org_id', standardOrg.orgId)
    expect(count).toBe(0)
  }, 30000)
})
