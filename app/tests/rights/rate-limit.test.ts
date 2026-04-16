import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

describe('checkRateLimit — in-memory fallback', () => {
  beforeEach(() => {
    vi.stubEnv('KV_REST_API_URL', '')
    vi.stubEnv('KV_REST_API_TOKEN', '')
    vi.stubEnv('UPSTASH_REDIS_REST_URL', '')
    vi.stubEnv('UPSTASH_REDIS_REST_TOKEN', '')
    vi.resetModules()
    vi.spyOn(console, 'warn').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    vi.restoreAllMocks()
  })

  async function loadModule() {
    return (await import('@/lib/rights/rate-limit')) as typeof import('@/lib/rights/rate-limit')
  }

  it('allows the first call for a new key', async () => {
    const { checkRateLimit } = await loadModule()
    const r = await checkRateLimit('test:new', 3, 1)
    expect(r.allowed).toBe(true)
    expect(r.retryInSeconds).toBe(0)
  })

  it('allows calls up to the limit', async () => {
    const { checkRateLimit } = await loadModule()
    const key = 'test:within'
    for (let i = 0; i < 3; i++) {
      const r = await checkRateLimit(key, 3, 1)
      expect(r.allowed).toBe(true)
    }
  })

  it('denies the call that exceeds the limit and returns retryInSeconds', async () => {
    const { checkRateLimit } = await loadModule()
    const key = 'test:exceed'
    for (let i = 0; i < 3; i++) await checkRateLimit(key, 3, 1)
    const r = await checkRateLimit(key, 3, 1)
    expect(r.allowed).toBe(false)
    expect(r.retryInSeconds).toBeGreaterThan(0)
    expect(r.retryInSeconds).toBeLessThanOrEqual(60)
  })

  it('resets after the window elapses', async () => {
    vi.useFakeTimers()
    const { checkRateLimit } = await loadModule()
    const key = 'test:reset'
    for (let i = 0; i < 3; i++) await checkRateLimit(key, 3, 1)
    const denied = await checkRateLimit(key, 3, 1)
    expect(denied.allowed).toBe(false)

    vi.advanceTimersByTime(61 * 1000)
    const recovered = await checkRateLimit(key, 3, 1)
    expect(recovered.allowed).toBe(true)
    vi.useRealTimers()
  })
})
