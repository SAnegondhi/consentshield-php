// ADR-1019 Sprint 2.3 — unknown_event_type + manual-review escalation.

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { deliverOne } from '@/lib/delivery/deliver-events'

type StubResponses = Array<unknown[] | Error>

interface StubFn {
  (strings: TemplateStringsArray, ...values: unknown[]): Promise<unknown[]>
  begin: (cb: (tx: unknown) => Promise<void>) => Promise<void>
  calls: Array<{ query: string; values: unknown[] }>
}

function makePgStub(responses: StubResponses) {
  const calls: Array<{ query: string; values: unknown[] }> = []
  let i = 0
  const fn = ((strings: TemplateStringsArray, ...values: unknown[]) => {
    calls.push({ query: strings.join('?'), values })
    if (i >= responses.length) {
      return Promise.reject(
        new Error(`pg stub: unexpected call #${i + 1} — queue exhausted`),
      )
    }
    const next = responses[i++]
    if (next instanceof Error) return Promise.reject(next)
    return Promise.resolve(next as unknown[])
  }) as unknown as StubFn
  fn.begin = async (cb) => {
    await cb(fn)
  }
  fn.calls = calls
  return fn
}

const ROW_ID = '11111111-2222-4333-8444-555555555555'
const ORG_ID = '99999999-2222-4333-8444-000000000001'
const EC_ID = 'ec000000-2222-4333-8444-aaaaaaaaaaaa'

function joinedRow(overrides: Record<string, unknown> = {}) {
  return {
    id: ROW_ID,
    org_id: ORG_ID,
    event_type: 'consent_event',
    payload: { a: 1 },
    attempt_count: 0,
    first_attempted_at: null,
    delivered_at: null,
    created_at: new Date('2026-04-24T10:00:00.000Z'),
    ec_id: EC_ID,
    ec_bucket_name: 'cs-cust-acme',
    ec_path_prefix: 'acme/',
    ec_region: 'auto',
    ec_storage_provider: 'cs_managed_r2',
    ec_write_credential_enc: Buffer.from('encrypted'),
    ec_is_verified: true,
    ...overrides,
  }
}

beforeEach(() => {
  vi.unstubAllEnvs()
  vi.stubEnv('MASTER_ENCRYPTION_KEY', 'test-master-key')
  vi.stubEnv('CLOUDFLARE_ACCOUNT_ID', 'cf-acct')
})

describe('unknown_event_type quarantine', () => {
  it('marks delivery_error, does NOT increment attempt_count, does NOT fence on config', async () => {
    const pg = makePgStub([
      [joinedRow({ event_type: 'bogus_test_type', attempt_count: 3 })],
      [], // the unknown-type UPDATE
    ])
    const putObject = vi.fn()
    const result = await deliverOne(pg, ROW_ID, { putObject })
    expect(result.outcome).toBe('unknown_event_type')
    expect(result.error).toBe('unknown_event_type:bogus_test_type')
    // attempt is the original count, NOT incremented.
    expect(result.attempt).toBe(3)
    expect(putObject).not.toHaveBeenCalled()

    // The only UPDATE was the unknown-type UPDATE — it must NOT bump
    // attempt_count (key signal: no `attempt_count = attempt_count + 1`
    // in the query).
    const lastQ = pg.calls[pg.calls.length - 1]!.query
    expect(lastQ).toContain('update public.delivery_buffer')
    expect(lastQ).toContain('delivery_error')
    expect(lastQ).not.toContain('attempt_count + 1')
  })

  it('quarantines regardless of config validity', async () => {
    // Even without an export_config, unknown type short-circuits first.
    const pg = makePgStub([
      [
        joinedRow({
          event_type: 'bogus',
          ec_id: null,
          ec_write_credential_enc: null,
        }),
      ],
      [],
    ])
    const putObject = vi.fn()
    const result = await deliverOne(pg, ROW_ID, { putObject })
    expect(result.outcome).toBe('unknown_event_type')
  })
})

describe('manual-review escalation at attempt_count >= 10', () => {
  it('prefixes delivery_error with MANUAL_REVIEW and fires the RPC once', async () => {
    // Seed so that the failing attempt pushes attempt_count 9 → 10.
    const pg = makePgStub([
      [joinedRow({ ec_is_verified: false, attempt_count: 9 })],
      // markFailure UPDATE ... RETURNING — returns the new count = 10
      [{ attempt_count: 10, org_id: ORG_ID, event_type: 'consent_event' }],
      // MANUAL_REVIEW: prefix second UPDATE
      [],
      // admin.record_delivery_retry_exhausted RPC
      [{ record_delivery_retry_exhausted: true }],
    ])
    const putObject = vi.fn()
    const result = await deliverOne(pg, ROW_ID, { putObject })

    expect(result.outcome).toBe('unverified_export_config')
    expect(result.attempt).toBe(10)

    // Query #3 must set delivery_error to a MANUAL_REVIEW-prefixed value.
    const q3 = pg.calls[2]!.query
    expect(q3).toContain('update public.delivery_buffer')
    expect(q3).toContain('delivery_error')
    expect(pg.calls[2]!.values[0]).toMatch(/^MANUAL_REVIEW: /)

    // Query #4 must call the readiness-flag RPC.
    const q4 = pg.calls[3]!.query
    expect(q4).toContain('admin.record_delivery_retry_exhausted')
    expect(pg.calls[3]!.values).toContain(ROW_ID)
    expect(pg.calls[3]!.values).toContain(ORG_ID)
    expect(pg.calls[3]!.values).toContain('consent_event')
  })

  it('does NOT escalate when attempt_count stays below threshold', async () => {
    const pg = makePgStub([
      [joinedRow({ ec_is_verified: false, attempt_count: 0 })],
      // markFailure UPDATE ... RETURNING — returns attempt_count = 1
      [{ attempt_count: 1, org_id: ORG_ID, event_type: 'consent_event' }],
    ])
    const putObject = vi.fn()
    const result = await deliverOne(pg, ROW_ID, { putObject })
    expect(result.outcome).toBe('unverified_export_config')
    // Only 2 pg calls: the initial SELECT + the markFailure UPDATE.
    expect(pg.calls).toHaveLength(2)
  })

  it('swallows a readiness-flag RPC failure without rolling back the markFailure', async () => {
    const pg = makePgStub([
      [joinedRow({ ec_is_verified: false, attempt_count: 9 })],
      [{ attempt_count: 10, org_id: ORG_ID, event_type: 'consent_event' }],
      [], // MANUAL_REVIEW second UPDATE
      new Error('admin schema unavailable in dev'), // RPC throws
    ])
    const putObject = vi.fn()
    // deliverOne must not throw; caller relies on outcome='unverified…'.
    const result = await deliverOne(pg, ROW_ID, { putObject })
    expect(result.outcome).toBe('unverified_export_config')
    // The MANUAL_REVIEW UPDATE still fired despite the RPC failure.
    const q3 = pg.calls[2]!.query
    expect(q3).toContain('delivery_error')
    expect(pg.calls[2]!.values[0]).toMatch(/^MANUAL_REVIEW: /)
  })
})
