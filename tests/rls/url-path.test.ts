import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createTestOrg, cleanupTestOrg, getServiceClient, TestOrg } from './helpers'

// S-2 from the 2026-04-14 codebase review: authenticated API routes
// accept org_id from the URL (`/api/orgs/[orgId]/...`) and issue
// .eq('org_id', orgId). RLS additionally filters by current_org_id()
// from the JWT. This suite asserts that a signed-in user cannot read
// or mutate another org's data by targeting its org_id in the query
// predicate — both the URL contract and the RLS contract must hold.

let orgA: TestOrg
let orgB: TestOrg
let orgBRequestId: string

beforeAll(async () => {
  orgA = await createTestOrg('urlpath-A')
  orgB = await createTestOrg('urlpath-B')

  const admin = getServiceClient()
  const { data, error } = await admin
    .from('rights_requests')
    .insert({
      org_id: orgB.orgId,
      request_type: 'access',
      requestor_name: 'Org B Requestor',
      requestor_email: 'orgb-requestor@example.com',
      status: 'new',
    })
    .select('id')
    .single()
  if (error) throw new Error(`seed orgB rights_request failed: ${error.message}`)
  orgBRequestId = (data as { id: string }).id
}, 60000)

afterAll(async () => {
  await cleanupTestOrg(orgA)
  await cleanupTestOrg(orgB)
}, 30000)

describe('URL-path cross-org guard (S-2)', () => {
  it('Org A SELECT with .eq("org_id", orgB) returns zero rows', async () => {
    const { data } = await orgA.client
      .from('rights_requests')
      .select('id')
      .eq('org_id', orgB.orgId)
    expect(data).toHaveLength(0)
  })

  it('Org A SELECT by id + .eq("org_id", orgB) returns zero rows', async () => {
    const { data } = await orgA.client
      .from('rights_requests')
      .select('id, status, requestor_email')
      .eq('id', orgBRequestId)
      .eq('org_id', orgB.orgId)
    expect(data).toHaveLength(0)
  })

  it('Org A UPDATE targeting orgB rights_request affects zero rows', async () => {
    const { data } = await orgA.client
      .from('rights_requests')
      .update({ status: 'completed', closure_notes: 'tampered by Org A' })
      .eq('id', orgBRequestId)
      .eq('org_id', orgB.orgId)
      .select('id')
    expect(data ?? []).toHaveLength(0)
  })

  it('Org A UPDATE without the org_id predicate still affects zero rows (RLS alone)', async () => {
    const { data } = await orgA.client
      .from('rights_requests')
      .update({ status: 'rejected' })
      .eq('id', orgBRequestId)
      .select('id')
    expect(data ?? []).toHaveLength(0)
  })

  it('Org B row is untouched after every Org A attempt', async () => {
    const admin = getServiceClient()
    const { data } = await admin
      .from('rights_requests')
      .select('status, closure_notes')
      .eq('id', orgBRequestId)
      .single()
    expect((data as { status: string; closure_notes: string | null }).status).toBe('new')
    expect((data as { status: string; closure_notes: string | null }).closure_notes).toBeNull()
  })
})
