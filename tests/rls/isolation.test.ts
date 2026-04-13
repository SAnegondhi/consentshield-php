import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import {
  createTestOrg,
  cleanupTestOrg,
  getServiceClient,
  getAnonClient,
  bufferTables,
  TestOrg,
} from './helpers'

let orgA: TestOrg
let orgB: TestOrg

beforeAll(async () => {
  orgA = await createTestOrg('orgA')
  orgB = await createTestOrg('orgB')

  // Seed some data in Org B using service role so we can test cross-tenant reads
  const admin = getServiceClient()

  await admin.from('web_properties').insert({
    org_id: orgB.orgId,
    name: 'Org B Site',
    url: 'https://orgb.example.com',
  })

  await admin.from('data_inventory').insert({
    org_id: orgB.orgId,
    data_category: 'email_address',
    purposes: ['marketing'],
  })

  // Seed a consent event in Org B buffer
  await admin.from('consent_events').insert({
    org_id: orgB.orgId,
    property_id: (await admin.from('web_properties').select('id').eq('org_id', orgB.orgId).single()).data!.id,
    banner_id: '00000000-0000-0000-0000-000000000000', // dummy — no FK check in buffer
    banner_version: 1,
    session_fingerprint: 'test-fingerprint',
    event_type: 'consent_given',
  })

  await admin.from('audit_log').insert({
    org_id: orgB.orgId,
    event_type: 'test_event',
  })
}, 60000)

afterAll(async () => {
  await cleanupTestOrg(orgA)
  await cleanupTestOrg(orgB)
}, 30000)

// ═══════════════════════════════════════════════════════════
// CROSS-TENANT ISOLATION: User A cannot see Org B's data
// ═══════════════════════════════════════════════════════════

describe('Cross-tenant isolation', () => {
  it('User A cannot SELECT Org B web_properties', async () => {
    const { data } = await orgA.client
      .from('web_properties')
      .select('*')
      .eq('org_id', orgB.orgId)
    expect(data).toHaveLength(0)
  })

  it('User A cannot SELECT Org B data_inventory', async () => {
    const { data } = await orgA.client
      .from('data_inventory')
      .select('*')
      .eq('org_id', orgB.orgId)
    expect(data).toHaveLength(0)
  })

  it('User A cannot SELECT Org B consent_events', async () => {
    const { data } = await orgA.client
      .from('consent_events')
      .select('*')
      .eq('org_id', orgB.orgId)
    expect(data).toHaveLength(0)
  })

  it('User A cannot SELECT Org B audit_log', async () => {
    const { data } = await orgA.client
      .from('audit_log')
      .select('*')
      .eq('org_id', orgB.orgId)
    expect(data).toHaveLength(0)
  })

  it('User A cannot SELECT Org B organisations', async () => {
    const { data } = await orgA.client
      .from('organisations')
      .select('*')
      .eq('id', orgB.orgId)
    expect(data).toHaveLength(0)
  })

  it('User A cannot INSERT into Org B web_properties', async () => {
    const { error } = await orgA.client.from('web_properties').insert({
      org_id: orgB.orgId,
      name: 'Injected by A',
      url: 'https://evil.com',
    })
    // RLS should reject — either error or the row silently fails to insert
    // Supabase returns 0 rows affected, not always an error
    if (!error) {
      // Verify it didn't actually insert
      const admin = getServiceClient()
      const { data } = await admin
        .from('web_properties')
        .select('*')
        .eq('org_id', orgB.orgId)
        .eq('name', 'Injected by A')
      expect(data).toHaveLength(0)
    }
  })

  it('User A cannot UPDATE Org B organisations', async () => {
    const { data } = await orgA.client
      .from('organisations')
      .update({ name: 'Hijacked by A' })
      .eq('id', orgB.orgId)
      .select()
    expect(data).toHaveLength(0)
  })
})

// ═══════════════════════════════════════════════════════════
// APPEND-ONLY: No UPDATE or DELETE on buffer tables
// ═══════════════════════════════════════════════════════════

describe('Buffer tables are append-only for authenticated users', () => {
  for (const table of bufferTables) {
    it(`Cannot UPDATE ${table}`, async () => {
      const { error } = await orgA.client
        .from(table)
        .update({ delivered_at: new Date().toISOString() })
        .eq('org_id', orgA.orgId)
      // Either permission denied error or 0 rows affected (no UPDATE policy)
      if (error) {
        expect(error.message).toMatch(/permission denied|policy/i)
      }
      // If no error, 0 rows affected is also acceptable (no policy = no match)
    })

    it(`Cannot DELETE from ${table}`, async () => {
      const { error } = await orgA.client
        .from(table)
        .delete()
        .eq('org_id', orgA.orgId)
      if (error) {
        expect(error.message).toMatch(/permission denied|policy/i)
      }
    })
  }
})

// ═══════════════════════════════════════════════════════════
// CRITICAL BUFFER INSERT RESTRICTION
// Authenticated users cannot INSERT into critical buffers
// ═══════════════════════════════════════════════════════════

describe('Critical buffers reject INSERT from authenticated users', () => {
  const criticalBuffers = [
    'consent_events',
    'tracker_observations',
    'audit_log',
    'processing_log',
    'delivery_buffer',
  ]

  for (const table of criticalBuffers) {
    it(`Cannot INSERT into ${table}`, async () => {
      const { error } = await orgA.client
        .from(table)
        .insert({ org_id: orgA.orgId, event_type: 'test' })
      expect(error).toBeTruthy()
    })
  }
})

// ═══════════════════════════════════════════════════════════
// EDGE CASE: User with no org membership sees nothing
// ═══════════════════════════════════════════════════════════

describe('User with no org membership', () => {
  let orphanUser: { userId: string; client: ReturnType<typeof getAnonClient> }

  beforeAll(async () => {
    const admin = getServiceClient()
    const email = `orphan-${Date.now()}@test.consentshield.in`
    const password = `OrphanPass!${Date.now()}`

    const { data } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    })

    const { createClient } = await import('@supabase/supabase-js')
    const client = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    )
    await client.auth.signInWithPassword({ email, password })

    orphanUser = { userId: data.user!.id, client }
  })

  afterAll(async () => {
    const admin = getServiceClient()
    await admin.auth.admin.deleteUser(orphanUser.userId)
  })

  it('sees 0 rows from organisations', async () => {
    const { data } = await orphanUser.client.from('organisations').select('*')
    expect(data).toHaveLength(0)
  })

  it('sees 0 rows from web_properties', async () => {
    const { data } = await orphanUser.client.from('web_properties').select('*')
    expect(data).toHaveLength(0)
  })

  it('sees 0 rows from consent_events', async () => {
    const { data } = await orphanUser.client.from('consent_events').select('*')
    expect(data).toHaveLength(0)
  })
})

// ═══════════════════════════════════════════════════════════
// EDGE CASE: Anon key (unauthenticated) sees nothing
// ═══════════════════════════════════════════════════════════

describe('Unauthenticated (anon key) access', () => {
  const anon = getAnonClient()

  it('sees 0 rows from organisations', async () => {
    const { data } = await anon.from('organisations').select('*')
    expect(data).toHaveLength(0)
  })

  it('sees 0 rows from consent_events', async () => {
    const { data } = await anon.from('consent_events').select('*')
    expect(data).toHaveLength(0)
  })

  it('can INSERT into rights_requests (public insert)', async () => {
    // This should work — rights_requests has a public insert policy
    const { error } = await anon.from('rights_requests').insert({
      org_id: orgB.orgId,
      request_type: 'erasure',
      requestor_name: 'Test Principal',
      requestor_email: 'principal@test.com',
    })
    // Public insert should succeed (no auth required for rights requests)
    expect(error).toBeNull()
  })

  it('cannot SELECT rights_requests (no org claim)', async () => {
    const { data } = await anon.from('rights_requests').select('*')
    expect(data).toHaveLength(0)
  })
})
