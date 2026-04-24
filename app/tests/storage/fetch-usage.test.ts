// ADR-1025 Phase 4 Sprint 4.2 — fetch-usage tests.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

function makePgStub(responses: Array<unknown[] | Error>) {
  const calls: Array<{ query: string; values: unknown[] }> = []
  let i = 0
  const fn = ((strings: TemplateStringsArray, ...values: unknown[]) => {
    calls.push({ query: strings.join('?'), values })
    if (i >= responses.length) {
      throw new Error(`pg stub: unexpected call #${i + 1}`)
    }
    const next = responses[i++]
    if (next instanceof Error) return Promise.reject(next)
    return Promise.resolve(next)
  }) as unknown as Parameters<
    typeof import('@/lib/storage/fetch-usage').captureStorageUsageSnapshots
  >[0]
  ;(fn as unknown as { calls: Array<{ query: string; values: unknown[] }> }).calls = calls
  return fn
}

const ACCOUNT = 'test-acct'

function orgCfg(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    org_id: 'org-1',
    bucket_name: 'cs-cust-bucket',
    storage_provider: 'cs_managed_r2',
    plan_code: 'growth',
    plan_ceiling_bytes: (100 * 1024 * 1024 * 1024).toString(),
    ...overrides,
  }
}

function usageResponse(payload: number, metadata: number, count: number) {
  return new Response(
    JSON.stringify({
      success: true,
      result: {
        payloadSize: String(payload),
        metadataSize: String(metadata),
        objectCount: String(count),
      },
    }),
    { status: 200, headers: { 'content-type': 'application/json' } },
  )
}

beforeEach(() => {
  vi.stubEnv('CLOUDFLARE_ACCOUNT_ID', ACCOUNT)
  vi.stubEnv('CLOUDFLARE_ACCOUNT_API_TOKEN', 'cfat-test')
})
afterEach(() => {
  vi.unstubAllEnvs()
  vi.resetModules()
})

async function load() {
  return await import('@/lib/storage/fetch-usage')
}

describe('captureStorageUsageSnapshots', () => {
  it('no cs_managed_r2 orgs → empty summary', async () => {
    const { captureStorageUsageSnapshots } = await load()
    const pg = makePgStub([[]])
    const summary = await captureStorageUsageSnapshots(pg, {
      fetchFn: vi.fn(),
    })
    expect(summary).toEqual({
      captured: 0,
      failed: 0,
      over_ceiling: 0,
      budget_exceeded: false,
      failures: [],
    })
  })

  it('happy path: inserts snapshot + flags over-ceiling correctly', async () => {
    const { captureStorageUsageSnapshots } = await load()
    const pg = makePgStub([
      [
        orgCfg({
          org_id: 'org-under',
          bucket_name: 'b-under',
          plan_ceiling_bytes: '100',
        }),
        orgCfg({
          org_id: 'org-over',
          bucket_name: 'b-over',
          plan_ceiling_bytes: '100',
        }),
      ],
      [], // insert snapshot 1 (under)
      [], // insert snapshot 2 (over)
    ])
    // First bucket: 50 + 10 = 60 bytes → under 100-byte ceiling.
    // Second bucket: 200 + 0 = 200 bytes → over.
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce(usageResponse(50, 10, 3))
      .mockResolvedValueOnce(usageResponse(200, 0, 5))
    const summary = await captureStorageUsageSnapshots(pg, { fetchFn })
    expect(summary.captured).toBe(2)
    expect(summary.failed).toBe(0)
    expect(summary.over_ceiling).toBe(1)
    expect(summary.budget_exceeded).toBe(false)
  })

  it('CF API 500 → records error on snapshot row; captured--, failed++', async () => {
    const { captureStorageUsageSnapshots } = await load()
    const pg = makePgStub([
      [orgCfg()],
      [], // error-path insert
    ])
    const fetchFn = vi.fn(async () =>
      new Response('boom', { status: 500 }),
    )
    const summary = await captureStorageUsageSnapshots(pg, { fetchFn })
    expect(summary.captured).toBe(0)
    expect(summary.failed).toBe(1)
    expect(summary.failures[0].error).toMatch(/CF usage API 500/)
  })

  it('CF returns success=false → recorded as failure', async () => {
    const { captureStorageUsageSnapshots } = await load()
    const pg = makePgStub([
      [orgCfg()],
      [], // error-path insert
    ])
    const fetchFn = vi.fn(async () =>
      new Response(
        JSON.stringify({ success: false, errors: [{ message: 'token revoked' }] }),
        { status: 200 },
      ),
    )
    const summary = await captureStorageUsageSnapshots(pg, { fetchFn })
    expect(summary.failed).toBe(1)
    expect(summary.failures[0].error).toMatch(/token revoked/)
  })

  it('ceiling=null (enterprise) → over_ceiling always false', async () => {
    const { captureStorageUsageSnapshots } = await load()
    const pg = makePgStub([
      [orgCfg({ plan_code: 'enterprise', plan_ceiling_bytes: null })],
      [], // insert
    ])
    const fetchFn = vi.fn(async () =>
      usageResponse(1_000_000_000_000, 0, 10_000_000),
    )
    const summary = await captureStorageUsageSnapshots(pg, { fetchFn })
    expect(summary.captured).toBe(1)
    expect(summary.over_ceiling).toBe(0)
  })

  it('budget_exceeded trips between orgs', async () => {
    const { captureStorageUsageSnapshots } = await load()
    const pg = makePgStub([
      [orgCfg({ org_id: 'o1' }), orgCfg({ org_id: 'o2' })],
      [], // insert for o1
      // o2 never reached
    ])
    const fetchFn = vi.fn(async () => usageResponse(10, 0, 1))
    let n = 0
    const now = vi.fn(() => {
      n++
      return n <= 2 ? 0 : 400_000
    })
    const summary = await captureStorageUsageSnapshots(pg, { fetchFn, now })
    expect(summary.captured).toBe(1)
    expect(summary.budget_exceeded).toBe(true)
  })

  it('throws when CLOUDFLARE_ACCOUNT_ID is missing', async () => {
    vi.stubEnv('CLOUDFLARE_ACCOUNT_ID', '')
    const { captureStorageUsageSnapshots } = await load()
    const pg = makePgStub([])
    await expect(
      captureStorageUsageSnapshots(pg, { fetchFn: vi.fn() }),
    ).rejects.toThrow(/CLOUDFLARE_ACCOUNT_ID/)
  })
})
