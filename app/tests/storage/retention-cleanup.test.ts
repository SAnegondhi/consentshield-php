// ADR-1025 Phase 4 Sprint 4.1 — retention-cleanup tests.

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
    typeof import('@/lib/storage/retention-cleanup').processRetentionCleanup
  >[0]
  ;(fn as unknown as { calls: Array<{ query: string; values: unknown[] }> }).calls = calls
  return fn
}

const ACCOUNT = 'test-account-0001'

function migrationRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'mig-1',
    from_config_snapshot: { bucket: 'cs-cust-oldbucket' },
    ...overrides,
  }
}

function mkDeps(
  overrides: Partial<
    import('@/lib/storage/retention-cleanup').RetentionDeps
  > = {},
) {
  // Empty-list XML from ListObjectsV2.
  const emptyListXml =
    '<?xml version="1.0"?><ListBucketResult><IsTruncated>false</IsTruncated></ListBucketResult>'
  const listResp = new Response(emptyListXml, { status: 200 })
  const deleteBucketResp = new Response('', { status: 200 })

  const fetchFn = vi.fn(async (url: URL | RequestInfo) => {
    const u = typeof url === 'string' ? url : url.toString()
    if (u.includes('api.cloudflare.com') && u.includes('/r2/buckets/')) {
      return deleteBucketResp.clone()
    }
    return listResp.clone()
  })

  return {
    createBucketScopedToken: vi.fn(async () => ({
      token_id: 'cleanup-tok',
      access_key_id: 'AKIA_CLEAN',
      secret_access_key: 'secret-clean',
    })),
    revokeBucketToken: vi.fn(async () => undefined),
    deleteObject: vi.fn(async () => ({ status: 204 })),
    fetchFn,
    sleep: vi.fn(async () => undefined),
    ...overrides,
  }
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
  return await import('@/lib/storage/retention-cleanup')
}

describe('processRetentionCleanup', () => {
  it('empty queue → processed=0, failed=0', async () => {
    const { processRetentionCleanup } = await load()
    const pg = makePgStub([[]])
    const summary = await processRetentionCleanup(pg, mkDeps())
    expect(summary).toEqual({ processed: 0, failed: 0, failures: [] })
  })

  it('happy path: empties + deletes bucket, marks migration processed', async () => {
    const { processRetentionCleanup } = await load()
    const pg = makePgStub([
      [migrationRow()],       // select
      [],                     // update retention_processed_at
    ])
    const deps = mkDeps()
    const summary = await processRetentionCleanup(pg, deps)
    expect(summary.processed).toBe(1)
    expect(summary.failed).toBe(0)
    // Cleanup token minted + revoked.
    expect(deps.createBucketScopedToken).toHaveBeenCalledWith('cs-cust-oldbucket')
    expect(deps.revokeBucketToken).toHaveBeenCalledWith('cleanup-tok')
    // Bucket delete HTTP call.
    const fetchCalls = deps.fetchFn.mock.calls.map((c) =>
      typeof c[0] === 'string' ? c[0] : (c[0] as URL).toString(),
    )
    expect(fetchCalls.some((u) => u.includes('/r2/buckets/cs-cust-oldbucket'))).toBe(true)
  })

  it('missing bucket in snapshot → records failure, skips', async () => {
    const { processRetentionCleanup } = await load()
    const pg = makePgStub([
      [migrationRow({ from_config_snapshot: {} })],
    ])
    const summary = await processRetentionCleanup(pg, mkDeps())
    expect(summary.failed).toBe(1)
    expect(summary.failures[0].error).toMatch(/bucket missing/)
  })

  it('bucket delete HTTP failure → records failure + updates error_text', async () => {
    const { processRetentionCleanup } = await load()
    const pg = makePgStub([
      [migrationRow()],
      // retention_processed_at update NEVER runs (delete fails)
      // Instead, the error_text update runs.
      [],
    ])
    const listXml =
      '<?xml version="1.0"?><ListBucketResult><IsTruncated>false</IsTruncated></ListBucketResult>'
    const fetchFn = vi.fn(async (url: URL | RequestInfo) => {
      const u = typeof url === 'string' ? url : url.toString()
      if (u.includes('/r2/buckets/')) {
        return new Response('bucket not empty', { status: 409 })
      }
      return new Response(listXml, { status: 200 })
    })
    const deps = mkDeps({ fetchFn })
    const summary = await processRetentionCleanup(pg, deps)
    expect(summary.failed).toBe(1)
    expect(summary.failures[0].error).toMatch(/HTTP 409/)
    // Cleanup token was still revoked.
    expect(deps.revokeBucketToken).toHaveBeenCalledWith('cleanup-tok')
  })

  it('cleanup-token mint failure → bubble up as failure; no bucket delete attempted', async () => {
    const { processRetentionCleanup } = await load()
    const pg = makePgStub([
      [migrationRow()],
      // error_text update
      [],
    ])
    const deps = mkDeps({
      createBucketScopedToken: vi.fn(async () => {
        throw new Error('CF 429 rate limited')
      }),
    })
    const summary = await processRetentionCleanup(pg, deps)
    expect(summary.failed).toBe(1)
    expect(summary.failures[0].error).toMatch(/CF 429/)
    // No bucket delete.
    const fetchCalls = deps.fetchFn.mock.calls
    expect(
      fetchCalls.some((c) =>
        (typeof c[0] === 'string' ? c[0] : (c[0] as URL).toString()).includes('/r2/buckets/'),
      ),
    ).toBe(false)
  })

  it('throws when CLOUDFLARE_ACCOUNT_ID is missing', async () => {
    vi.stubEnv('CLOUDFLARE_ACCOUNT_ID', '')
    const { processRetentionCleanup } = await load()
    const pg = makePgStub([])
    await expect(processRetentionCleanup(pg, mkDeps())).rejects.toThrow(
      /CLOUDFLARE_ACCOUNT_ID/,
    )
  })
})
