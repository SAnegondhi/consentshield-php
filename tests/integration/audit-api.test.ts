// ADR-1016 Sprint 1.1 — /v1/audit integration tests.

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { listAuditLog } from '../../app/src/lib/api/audit'
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
let noScopeKeyId: string

beforeAll(async () => {
  org = await createTestOrg('auditApi')
  otherOrg = await createTestOrg('auditOther')
  keyId = (await seedApiKey(org, { scopes: ['read:audit'] })).keyId
  otherKeyId = (await seedApiKey(otherOrg, { scopes: ['read:audit'] })).keyId
  noScopeKeyId = (await seedApiKey(org, { scopes: ['read:consent'] })).keyId

  const admin = getServiceClient()

  // Seed 3 audit_log rows in the main org, plus an ip_address so we can
  // assert the response envelope strips it.
  await admin.from('audit_log').insert([
    {
      org_id: org.orgId,
      actor_id: null,
      actor_email: 'alice@example.test',
      event_type: 'banner_published',
      entity_type: 'banner',
      entity_id: null,
      payload: { version: 3 },
      ip_address: '203.0.113.4',
    },
    {
      org_id: org.orgId,
      actor_id: null,
      actor_email: 'alice@example.test',
      event_type: 'purpose_created',
      entity_type: 'purpose',
      entity_id: null,
      payload: { purpose_code: 'marketing' },
      ip_address: '203.0.113.4',
    },
    {
      org_id: org.orgId,
      actor_id: null,
      actor_email: 'bob@example.test',
      event_type: 'banner_published',
      entity_type: 'banner',
      entity_id: null,
      payload: { version: 4 },
      ip_address: '203.0.113.9',
    },
  ])

  // Seed 1 row in otherOrg so the cross-org assertion is meaningful.
  await admin.from('audit_log').insert({
    org_id: otherOrg.orgId,
    actor_email: 'other@example.test',
    event_type: 'property_created',
    entity_type: 'property',
    entity_id: null,
    payload: {},
    ip_address: '198.51.100.1',
  })
}, 90_000)

afterAll(async () => {
  await cleanupTestOrg(org)
  await cleanupTestOrg(otherOrg)
}, 30_000)

describe('listAuditLog — /v1/audit', () => {

  it('returns the 3 seeded rows for the caller org, most-recent first', async () => {
    const r = await listAuditLog({ keyId, orgId: org.orgId })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.data.items.length).toBeGreaterThanOrEqual(3)
    expect(r.data.next_cursor).toBeNull()

    // Descending order by created_at.
    for (let i = 1; i < r.data.items.length; i++) {
      const prev = new Date(r.data.items[i - 1].created_at).getTime()
      const curr = new Date(r.data.items[i].created_at).getTime()
      expect(prev).toBeGreaterThanOrEqual(curr)
    }
  })

  it('never leaks ip_address (PII-safe subset)', async () => {
    const r = await listAuditLog({ keyId, orgId: org.orgId })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    for (const item of r.data.items) {
      expect(Object.keys(item)).not.toContain('ip_address')
    }
  })

  it('filter by event_type returns only matching rows', async () => {
    const r = await listAuditLog({
      keyId,
      orgId: org.orgId,
      eventType: 'banner_published',
    })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.data.items.length).toBeGreaterThanOrEqual(2)
    for (const item of r.data.items) {
      expect(item.event_type).toBe('banner_published')
    }
  })

  it('filter by entity_type=purpose returns the purpose_created row', async () => {
    const r = await listAuditLog({
      keyId,
      orgId: org.orgId,
      entityType: 'purpose',
    })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.data.items.length).toBeGreaterThanOrEqual(1)
    for (const item of r.data.items) expect(item.entity_type).toBe('purpose')
  })

  it('cross-org fence: otherOrg-bound key cannot list org rows', async () => {
    const r = await listAuditLog({ keyId: otherKeyId, orgId: org.orgId })
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.error.kind).toBe('api_key_binding')
  })

  it('otherOrg sees only its own 1 seeded row', async () => {
    const r = await listAuditLog({ keyId: otherKeyId, orgId: otherOrg.orgId })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.data.items.length).toBe(1)
    expect(r.data.items[0].event_type).toBe('property_created')
  })

  it('bad cursor → bad_cursor', async () => {
    const r = await listAuditLog({
      keyId,
      orgId: org.orgId,
      cursor: 'not-base64-jsonb',
    })
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.error.kind).toBe('bad_cursor')
  })

  it('envelope shape is stable and includes expected fields only', async () => {
    const r = await listAuditLog({ keyId, orgId: org.orgId, limit: 1 })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    const first = r.data.items[0]
    expect(first.id).toMatch(/^[0-9a-f-]{36}$/)
    expect(typeof first.event_type).toBe('string')
    expect(typeof first.created_at).toBe('string')
    // Fields we expect to be present (nullable is OK).
    expect('actor_email' in first).toBe(true)
    expect('entity_type' in first).toBe(true)
    expect('payload' in first).toBe(true)
    // Definitely-not-present: ip_address.
    expect('ip_address' in first).toBe(false)
  })

  // noScopeKeyId is used by the http-route-level scope gate test. The lib
  // helper doesn't enforce scopes (that's the route's job) so we assert
  // via the cs_api RPC path that the RPC itself is callable regardless —
  // scope-gating lives at the handler layer.
  it('library-level RPC call ignores scope claims (scope enforcement is at the route layer)', async () => {
    const r = await listAuditLog({ keyId: noScopeKeyId, orgId: org.orgId })
    // Should succeed — the fence only checks binding, not scope.
    expect(r.ok).toBe(true)
  })

})
