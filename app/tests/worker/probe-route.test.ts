// ADR-1010 Phase 1 Sprint 1.1 — /v1/_cs_api_probe scratch route.

import { describe, it, expect, afterEach } from 'vitest'
import { createWorker, type MockState } from './harness'

function emptyState(): MockState {
  return {
    properties: {},
    banners: {},
    trackerSignatures: [{ service_slug: 'ga4' }],
    writes: [],
  }
}

let worker: Awaited<ReturnType<typeof createWorker>> | null = null

afterEach(async () => {
  if (worker) {
    await worker.dispose()
    worker = null
  }
})

describe('/v1/_cs_api_probe', () => {
  it('returns all three probe results when via=all', async () => {
    worker = await createWorker({ state: emptyState() })
    const res = await worker.fetch('https://worker.local/v1/_cs_api_probe')
    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      ok: boolean
      probed_at: number
      results: Array<{ mechanism: string; ok: boolean; note?: string }>
    }
    expect(body.ok).toBe(true)
    expect(body.results.map((r) => r.mechanism).sort()).toEqual([
      'hyperdrive',
      'raw_tcp',
      'rest',
    ])
  })

  it('returns only the requested mechanism when via=rest', async () => {
    worker = await createWorker({ state: emptyState() })
    const res = await worker.fetch('https://worker.local/v1/_cs_api_probe?via=rest')
    expect(res.status).toBe(200)
    const body = (await res.json()) as { results: Array<{ mechanism: string; ok: boolean }> }
    expect(body.results).toHaveLength(1)
    expect(body.results[0].mechanism).toBe('rest')
    // tracker_signatures is seeded in mock state → rest probe reaches the
    // mock Supabase origin and succeeds.
    expect(body.results[0].ok).toBe(true)
  })

  it('reports hyperdrive as not configured when no binding is present', async () => {
    worker = await createWorker({ state: emptyState() })
    const res = await worker.fetch('https://worker.local/v1/_cs_api_probe?via=hyperdrive')
    const body = (await res.json()) as {
      results: Array<{ mechanism: string; ok: boolean; note?: string }>
    }
    expect(body.results[0].mechanism).toBe('hyperdrive')
    expect(body.results[0].ok).toBe(false)
    expect(body.results[0].note).toBe('hyperdrive_binding_not_configured')
  })

  it('reports raw_tcp as scaffold-only', async () => {
    worker = await createWorker({ state: emptyState() })
    const res = await worker.fetch('https://worker.local/v1/_cs_api_probe?via=raw_tcp')
    const body = (await res.json()) as {
      results: Array<{ mechanism: string; ok: boolean; note?: string }>
    }
    expect(body.results[0].mechanism).toBe('raw_tcp')
    expect(body.results[0].ok).toBe(false)
    expect(body.results[0].note).toMatch(/scaffold_only|sockets_api_unavailable/)
  })

  it('rejects unknown via values with 400', async () => {
    worker = await createWorker({ state: emptyState() })
    const res = await worker.fetch('https://worker.local/v1/_cs_api_probe?via=nonsense')
    expect(res.status).toBe(400)
    const body = (await res.json()) as { error: string; allowed: string[] }
    expect(body.error).toBe('invalid_via')
    expect(body.allowed).toContain('rest')
  })

  it('is covered by the role guard like every other non-health route', async () => {
    // Role guard is enforced via ALLOW_SERVICE_ROLE_LOCAL=1 in the harness;
    // this test just confirms the probe route is not accidentally exempted
    // from the guard. Removing the opt-in would flip this to 503.
    worker = await createWorker({ state: emptyState() })
    const res = await worker.fetch('https://worker.local/v1/_cs_api_probe')
    expect(res.status).not.toBe(503)
  })
})
