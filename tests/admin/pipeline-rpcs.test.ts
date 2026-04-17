import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  AdminTestUser,
  cleanupAdminTestUser,
  createAdminTestUser,
  getAdminAnonClient,
} from './helpers'

// ADR-0033 Sprint 1.1 — Pipeline Operations admin RPCs.
//
// Four SECURITY DEFINER functions in the admin.* schema:
//   * pipeline_worker_errors_list(p_limit)
//   * pipeline_stuck_buffers_snapshot()
//   * pipeline_depa_expiry_queue()
//   * pipeline_delivery_health(p_window_hours)
//
// For each: (a) a support-role admin can call and gets a well-shaped
// result, (b) a non-admin authenticated user is rejected with SQLSTATE
// 42501 ('admin claim required').
//
// Data assertions are intentionally shape-only — Pipeline Ops is a
// read-over-existing-data surface and the actual row counts depend on
// whatever lives in the dev database.

let support: AdminTestUser

beforeAll(async () => {
  support = await createAdminTestUser('support')
})

afterAll(async () => {
  if (support) await cleanupAdminTestUser(support)
})

describe('ADR-0033 Sprint 1.1 — admin Pipeline Operations RPCs', () => {
  describe('pipeline_worker_errors_list', () => {
    it('support admin can call; returns an array', async () => {
      const { data, error } = await support.client
        .schema('admin')
        .rpc('pipeline_worker_errors_list', { p_limit: 25 })

      expect(error).toBeNull()
      expect(Array.isArray(data)).toBe(true)
      if (data && data.length > 0) {
        const row = data[0]
        expect(row).toHaveProperty('id')
        expect(row).toHaveProperty('occurred_at')
        expect(row).toHaveProperty('endpoint')
        expect(row).toHaveProperty('org_id')
        expect(row).toHaveProperty('org_name')
      }
    })

    it('rejects p_limit outside [1, 1000]', async () => {
      const { error } = await support.client
        .schema('admin')
        .rpc('pipeline_worker_errors_list', { p_limit: 0 })
      expect(error).not.toBeNull()
      expect(error?.message).toMatch(/p_limit must be between/i)
    })

    it('non-admin authenticated user is denied', async () => {
      const anon = getAdminAnonClient()
      const { error } = await anon
        .schema('admin')
        .rpc('pipeline_worker_errors_list', { p_limit: 10 })
      // Postgres throws 42501; PostgREST surfaces it as permission / admin-claim message.
      expect(error).not.toBeNull()
    })
  })

  describe('pipeline_stuck_buffers_snapshot', () => {
    it('support admin can call; each row has oldest_age_seconds derived', async () => {
      const { data, error } = await support.client
        .schema('admin')
        .rpc('pipeline_stuck_buffers_snapshot')

      expect(error).toBeNull()
      expect(Array.isArray(data)).toBe(true)
      if (data && data.length > 0) {
        const row = data[0]
        expect(row).toHaveProperty('buffer_table')
        expect(row).toHaveProperty('stuck_count')
        expect(row).toHaveProperty('oldest_created')
        expect(row).toHaveProperty('oldest_age_seconds')
        // When oldest_created is present, oldest_age_seconds must be >= 0.
        if (row.oldest_created) {
          expect(Number(row.oldest_age_seconds)).toBeGreaterThanOrEqual(0)
        }
      }
    })

    it('non-admin authenticated user is denied', async () => {
      const anon = getAdminAnonClient()
      const { error } = await anon
        .schema('admin')
        .rpc('pipeline_stuck_buffers_snapshot')
      expect(error).not.toBeNull()
    })
  })

  describe('pipeline_depa_expiry_queue', () => {
    it('support admin can call; returns an array (possibly empty)', async () => {
      const { data, error } = await support.client
        .schema('admin')
        .rpc('pipeline_depa_expiry_queue')

      expect(error).toBeNull()
      expect(Array.isArray(data)).toBe(true)
      if (data && data.length > 0) {
        const row = data[0]
        expect(row).toHaveProperty('org_id')
        expect(row).toHaveProperty('org_name')
        expect(row).toHaveProperty('expiring_lt_7d')
        expect(row).toHaveProperty('expiring_lt_30d')
        expect(row).toHaveProperty('expired_awaiting_enforce')
        // expiring_lt_7d ≤ expiring_lt_30d (7d is a strict subset of 30d).
        expect(Number(row.expiring_lt_7d)).toBeLessThanOrEqual(
          Number(row.expiring_lt_30d),
        )
      }
    })

    it('non-admin authenticated user is denied', async () => {
      const anon = getAdminAnonClient()
      const { error } = await anon.schema('admin').rpc('pipeline_depa_expiry_queue')
      expect(error).not.toBeNull()
    })
  })

  describe('pipeline_delivery_health', () => {
    it('support admin can call with default 24h window; returns an array', async () => {
      const { data, error } = await support.client
        .schema('admin')
        .rpc('pipeline_delivery_health', { p_window_hours: 24 })

      expect(error).toBeNull()
      expect(Array.isArray(data)).toBe(true)
      if (data && data.length > 0) {
        const row = data[0]
        expect(row).toHaveProperty('org_id')
        expect(row).toHaveProperty('median_latency_ms')
        expect(row).toHaveProperty('p95_latency_ms')
        expect(row).toHaveProperty('failure_count')
        expect(row).toHaveProperty('throughput')
        expect(row).toHaveProperty('success_rate')
        if (row.success_rate !== null && row.success_rate !== undefined) {
          const rate = Number(row.success_rate)
          expect(rate).toBeGreaterThanOrEqual(0)
          expect(rate).toBeLessThanOrEqual(100)
        }
      }
    })

    it('rejects p_window_hours outside [1, 168]', async () => {
      const { error } = await support.client
        .schema('admin')
        .rpc('pipeline_delivery_health', { p_window_hours: 200 })
      expect(error).not.toBeNull()
      expect(error?.message).toMatch(/p_window_hours must be between/i)
    })

    it('non-admin authenticated user is denied', async () => {
      const anon = getAdminAnonClient()
      const { error } = await anon
        .schema('admin')
        .rpc('pipeline_delivery_health', { p_window_hours: 24 })
      expect(error).not.toBeNull()
    })
  })
})
