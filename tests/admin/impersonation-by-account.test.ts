import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  createAdminTestUser,
  cleanupAdminTestUser,
  AdminTestUser,
} from './helpers'

// ADR-1027 Sprint 3.1 — admin.impersonation_sessions_by_account() envelope.
//
// The RPC aggregates impersonation_sessions rows into one row per
// (account_id, admin_user_id). These tests assert:
//   1. Support role can call; read_only cannot.
//   2. The returned shape carries the expected column types.
//   3. p_window_days <= 0 raises.
//   4. p_window_days = 30 returns rows only from the last 30d.

let supportUser: AdminTestUser
let readOnlyUser: AdminTestUser

beforeAll(async () => {
  supportUser = await createAdminTestUser('support')
  readOnlyUser = await createAdminTestUser('read_only')
})

afterAll(async () => {
  if (supportUser) await cleanupAdminTestUser(supportUser)
  if (readOnlyUser) await cleanupAdminTestUser(readOnlyUser)
})

describe('ADR-1027 Sprint 3.1 — admin.impersonation_sessions_by_account()', () => {
  it('support role can call the RPC and receives an array', async () => {
    const { data, error } = await supportUser.client
      .schema('admin')
      .rpc('impersonation_sessions_by_account', { p_window_days: 30 })

    expect(error).toBeNull()
    expect(Array.isArray(data)).toBe(true)
  })

  it('returned rows carry the expected column shape', async () => {
    const { data } = await supportUser.client
      .schema('admin')
      .rpc('impersonation_sessions_by_account', { p_window_days: 90 })

    for (const row of (data ?? []) as Array<Record<string, unknown>>) {
      expect(typeof row.account_id === 'string' || row.account_id === null).toBe(true)
      // account_name may be null when the join misses (shouldn't happen with
      // live data but is tolerated by the RPC and the UI renders '—').
      expect(row.account_name === null || typeof row.account_name === 'string').toBe(true)
      expect(typeof row.admin_user_id).toBe('string')
      expect(row.admin_name === null || typeof row.admin_name === 'string').toBe(true)
      expect(typeof row.orgs_touched).toBe('number')
      expect(typeof row.session_count).toBe('number')
      expect(typeof row.total_seconds).toBe('number')
      expect(typeof row.first_started).toBe('string')
      expect(typeof row.last_started).toBe('string')
      expect(typeof row.active_count).toBe('number')
      expect(row.session_count).toBeGreaterThanOrEqual(row.orgs_touched as number)
      expect(row.session_count).toBeGreaterThanOrEqual(row.active_count as number)
    }
  })

  it('p_window_days <= 0 raises', async () => {
    const { data, error } = await supportUser.client
      .schema('admin')
      .rpc('impersonation_sessions_by_account', { p_window_days: 0 })

    expect(error).not.toBeNull()
    expect(data).toBeNull()
  })

  it('narrower window returns <= wider window rows', async () => {
    const [oneWeek, ninety] = await Promise.all([
      supportUser.client
        .schema('admin')
        .rpc('impersonation_sessions_by_account', { p_window_days: 7 }),
      supportUser.client
        .schema('admin')
        .rpc('impersonation_sessions_by_account', { p_window_days: 90 }),
    ])
    expect(oneWeek.error).toBeNull()
    expect(ninety.error).toBeNull()
    // Not a strict inequality — a burst of activity in the last 7 days
    // could match in both windows identically — but the 7d count must
    // never exceed the 90d count.
    const oneWeekCount = Array.isArray(oneWeek.data) ? oneWeek.data.length : 0
    const ninetyCount = Array.isArray(ninety.data) ? ninety.data.length : 0
    expect(oneWeekCount).toBeLessThanOrEqual(ninetyCount)
  })

  it('read_only role cannot call (support-tier gated)', async () => {
    const { data, error } = await readOnlyUser.client
      .schema('admin')
      .rpc('impersonation_sessions_by_account', { p_window_days: 30 })

    expect(error).not.toBeNull()
    expect(data).toBeNull()
  })
})
