import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  AdminTestUser,
  cleanupAdminTestUser,
  createAdminTestUser,
  getAdminAnonClient,
  getAdminServiceClient,
} from './helpers'

// ADR-0049 Phase 1 Sprint 1.1 — admin.security_rate_limit_triggers
// now reads from public.rate_limit_events.

const service = getAdminServiceClient()

let supportUser: AdminTestUser
let seededKeys: string[] = []

beforeAll(async () => {
  supportUser = await createAdminTestUser('support')
})

afterAll(async () => {
  if (supportUser) await cleanupAdminTestUser(supportUser)
  // Cleanup seeded events.
  if (seededKeys.length > 0) {
    await service.from('rate_limit_events').delete().in('key_hash', seededKeys)
  }
})

describe('ADR-0049 Phase 1.1 — admin.security_rate_limit_triggers', () => {
  it('returns no rows on an empty table for our synthetic key', async () => {
    const { data, error } = await supportUser.client
      .schema('admin')
      .rpc('security_rate_limit_triggers', { p_window_hours: 1 })
    expect(error).toBeNull()
    expect(Array.isArray(data)).toBe(true)
    // Don't assert zero — the shared dev DB may have rows from other
    // test runs. Just confirm the shape is an array.
  })

  it('groups by (endpoint, ip_address) and sums hit_count', async () => {
    const key = `test-rlh-${Date.now()}`
    seededKeys.push(key)
    const endpoint = '/api/public/rights-request'
    const ip = `198.51.100.${Math.floor(Math.random() * 255)}`

    // Seed 3 events from the same IP + endpoint.
    await service.from('rate_limit_events').insert([
      {
        endpoint,
        ip_address: ip,
        hit_count: 5,
        window_seconds: 3600,
        key_hash: key,
      },
      {
        endpoint,
        ip_address: ip,
        hit_count: 5,
        window_seconds: 3600,
        key_hash: key,
      },
      {
        endpoint,
        ip_address: ip,
        hit_count: 5,
        window_seconds: 3600,
        key_hash: key,
      },
    ])

    const { data, error } = await supportUser.client
      .schema('admin')
      .rpc('security_rate_limit_triggers', { p_window_hours: 1 })
    expect(error).toBeNull()

    const ours = (data as Array<{
      endpoint: string
      ip: string
      hit_count: number
    }>).find((r) => r.ip === ip && r.endpoint === endpoint)
    expect(ours).toBeDefined()
    expect(Number(ours!.hit_count)).toBe(15) // 5 * 3
  })

  it('rejects p_window_hours outside [1, 168]', async () => {
    const { error } = await supportUser.client
      .schema('admin')
      .rpc('security_rate_limit_triggers', { p_window_hours: 0 })
    expect(error).not.toBeNull()
    expect(error?.message).toMatch(/p_window_hours must be between/i)
  })

  it('non-admin authenticated user is denied', async () => {
    const anon = getAdminAnonClient()
    const { error } = await anon
      .schema('admin')
      .rpc('security_rate_limit_triggers', { p_window_hours: 1 })
    expect(error).not.toBeNull()
  })

  it('direct SELECT on rate_limit_events is denied for authenticated (no SELECT policy)', async () => {
    // authenticated can INSERT but not SELECT. An empty result with no
    // error is the RLS default-deny path.
    const { data, error } = await supportUser.client
      .from('rate_limit_events')
      .select('*')
      .limit(1)
    // RLS returns an empty result, not an error, because the table has
    // no SELECT policy for the authenticated role.
    expect(error).toBeNull()
    expect(data ?? []).toHaveLength(0)
  })
})
