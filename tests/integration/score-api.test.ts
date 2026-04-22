// ADR-1016 Sprint 1.3 — /v1/score integration tests.

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { getDepaScore } from '../../app/src/lib/api/score'
import {
  createTestOrg,
  cleanupTestOrg,
  getServiceClient,
  seedApiKey,
  type TestOrg,
} from '../rls/helpers'

let withScoreOrg: TestOrg
let emptyOrg: TestOrg
let keyWithScore: string
let keyEmpty: string

beforeAll(async () => {
  withScoreOrg = await createTestOrg('scoreApi')
  emptyOrg = await createTestOrg('scoreEmpty')
  keyWithScore = (await seedApiKey(withScoreOrg, { scopes: ['read:score'] })).keyId
  keyEmpty     = (await seedApiKey(emptyOrg,     { scopes: ['read:score'] })).keyId

  const admin = getServiceClient()

  // Seed a depa_compliance_metrics row for withScoreOrg only.
  await admin.from('depa_compliance_metrics').insert({
    org_id:           withScoreOrg.orgId,
    total_score:      16.5,
    coverage_score:   5.0,
    expiry_score:     4.0,
    freshness_score:  4.5,
    revocation_score: 3.0,
  })
}, 90_000)

afterAll(async () => {
  await cleanupTestOrg(withScoreOrg)
  await cleanupTestOrg(emptyOrg)
}, 30_000)

describe('getDepaScore — /v1/score', () => {

  it('returns the seeded score envelope', async () => {
    const r = await getDepaScore({ keyId: keyWithScore, orgId: withScoreOrg.orgId })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(Number(r.data.total_score)).toBe(16.5)
    expect(Number(r.data.coverage_score)).toBe(5.0)
    expect(Number(r.data.expiry_score)).toBe(4.0)
    expect(Number(r.data.freshness_score)).toBe(4.5)
    expect(Number(r.data.revocation_score)).toBe(3.0)
    expect(r.data.max_score).toBe(20)
    expect(typeof r.data.computed_at).toBe('string')
  })

  it('returns null-envelope for an org with no metrics row', async () => {
    const r = await getDepaScore({ keyId: keyEmpty, orgId: emptyOrg.orgId })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.data.total_score).toBeNull()
    expect(r.data.coverage_score).toBeNull()
    expect(r.data.expiry_score).toBeNull()
    expect(r.data.freshness_score).toBeNull()
    expect(r.data.revocation_score).toBeNull()
    expect(r.data.computed_at).toBeNull()
    // max_score stays 20 — it's a constant, not data.
    expect(r.data.max_score).toBe(20)
  })

  it('cross-org fence: emptyOrg key cannot read withScoreOrg score', async () => {
    const r = await getDepaScore({ keyId: keyEmpty, orgId: withScoreOrg.orgId })
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.error.kind).toBe('api_key_binding')
  })

})
