// ADR-1016 Sprint 1.2 — /v1/security/scans integration tests.

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { listSecurityScans } from '../../app/src/lib/api/security'
import {
  createTestOrg,
  cleanupTestOrg,
  getServiceClient,
  seedApiKey,
  type TestOrg,
} from '../rls/helpers'

let org: TestOrg
let otherOrg: TestOrg
let keyId: string
let otherKeyId: string
let propertyId: string
let otherPropertyId: string

beforeAll(async () => {
  org = await createTestOrg('secScans')
  otherOrg = await createTestOrg('secScansOther')
  keyId = (await seedApiKey(org, { scopes: ['read:security'] })).keyId
  otherKeyId = (await seedApiKey(otherOrg, { scopes: ['read:security'] })).keyId

  const admin = getServiceClient()

  // Seed a property in each org.
  const { data: prop } = await admin
    .from('web_properties')
    .insert({ org_id: org.orgId, name: 'scan prop', url: `https://sec-${Date.now()}.test` })
    .select('id').single()
  propertyId = prop!.id
  const { data: prop2 } = await admin
    .from('web_properties')
    .insert({ org_id: otherOrg.orgId, name: 'other prop', url: `https://sec-other-${Date.now()}.test` })
    .select('id').single()
  otherPropertyId = prop2!.id

  // Seed scans with mixed severity.
  await admin.from('security_scans').insert([
    {
      org_id: org.orgId,
      property_id: propertyId,
      scan_type: 'header_audit',
      severity: 'critical',
      signal_key: 'missing_csp',
      details: { url: 'https://sec.test' },
      remediation: 'Add a CSP header.',
    },
    {
      org_id: org.orgId,
      property_id: propertyId,
      scan_type: 'header_audit',
      severity: 'medium',
      signal_key: 'missing_hsts',
      details: {},
      remediation: 'Add Strict-Transport-Security.',
    },
    {
      org_id: org.orgId,
      property_id: propertyId,
      scan_type: 'header_audit',
      severity: 'info',
      signal_key: 'all_clean',
      details: {},
      remediation: null,
    },
  ])

  await admin.from('security_scans').insert({
    org_id: otherOrg.orgId,
    property_id: otherPropertyId,
    scan_type: 'header_audit',
    severity: 'low',
    signal_key: 'sri_missing',
    details: {},
    remediation: null,
  })
}, 90_000)

afterAll(async () => {
  await cleanupTestOrg(org)
  await cleanupTestOrg(otherOrg)
}, 30_000)

describe('listSecurityScans — /v1/security/scans', () => {

  it('returns the 3 seeded scans for the caller org', async () => {
    const r = await listSecurityScans({ keyId, orgId: org.orgId })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.data.items.length).toBeGreaterThanOrEqual(3)
  })

  it('filter by severity=critical returns only critical rows', async () => {
    const r = await listSecurityScans({ keyId, orgId: org.orgId, severity: 'critical' })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.data.items.length).toBeGreaterThanOrEqual(1)
    for (const item of r.data.items) expect(item.severity).toBe('critical')
  })

  it('filter by signal_key=missing_hsts returns only that signal', async () => {
    const r = await listSecurityScans({ keyId, orgId: org.orgId, signalKey: 'missing_hsts' })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    for (const item of r.data.items) expect(item.signal_key).toBe('missing_hsts')
  })

  it('filter by property_id returns only scans for that property', async () => {
    const r = await listSecurityScans({ keyId, orgId: org.orgId, propertyId })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    for (const item of r.data.items) expect(item.property_id).toBe(propertyId)
  })

  it('cross-org fence: otherOrg-bound key cannot list org scans', async () => {
    const r = await listSecurityScans({ keyId: otherKeyId, orgId: org.orgId })
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.error.kind).toBe('api_key_binding')
  })

  it('otherOrg sees only its own 1 scan', async () => {
    const r = await listSecurityScans({ keyId: otherKeyId, orgId: otherOrg.orgId })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.data.items.length).toBe(1)
    expect(r.data.items[0].signal_key).toBe('sri_missing')
  })

  it('envelope shape is stable', async () => {
    const r = await listSecurityScans({ keyId, orgId: org.orgId, limit: 1 })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    const first = r.data.items[0]
    expect(first.id).toMatch(/^[0-9a-f-]{36}$/)
    expect(first.property_id).toMatch(/^[0-9a-f-]{36}$/)
    expect(['critical', 'high', 'medium', 'low', 'info']).toContain(first.severity)
    expect(typeof first.scanned_at).toBe('string')
  })

  it('invalid severity → invalid_severity', async () => {
    const r = await listSecurityScans({
      keyId,
      orgId: org.orgId,
      // @ts-expect-error intentional invalid value
      severity: 'bogus',
    })
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.error.kind).toBe('invalid_severity')
  })

  it('bad cursor → bad_cursor', async () => {
    const r = await listSecurityScans({
      keyId,
      orgId: org.orgId,
      cursor: 'not-base64-jsonb',
    })
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.error.kind).toBe('bad_cursor')
  })

})
