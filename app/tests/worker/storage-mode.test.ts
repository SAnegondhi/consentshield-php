// ADR-1003 Sprint 1.1 — storage-mode resolver (Worker side).
//
// Direct unit tests against the helper's KV lookup — Miniflare
// unnecessary here because the helper is a pure function of
// env.BANNER_KV.get(...). Resetting the module-scope cache between
// tests keeps each assertion independent.

import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  __resetStorageModeCacheForTests,
  getStorageMode,
  isStorageMode,
  isZeroStorage,
  storageModeCacheTtlMs,
} from '../../../worker/src/storage-mode'

type GetKvValue = (key: string, type: 'json') => Promise<unknown>

function makeEnv(map: Record<string, string> | null): {
  env: { BANNER_KV: { get: GetKvValue } }
  spy: ReturnType<typeof vi.fn>
} {
  const spy = vi.fn(async (key: string, type: 'json') => {
    if (key === 'storage_modes:v1' && type === 'json') return map
    return null
  })
  return {
    env: { BANNER_KV: { get: spy as unknown as GetKvValue } },
    spy,
  }
}

beforeEach(() => {
  __resetStorageModeCacheForTests()
})

describe('isStorageMode', () => {
  it('accepts the three canonical values', () => {
    expect(isStorageMode('standard')).toBe(true)
    expect(isStorageMode('insulated')).toBe(true)
    expect(isStorageMode('zero_storage')).toBe(true)
  })
  it('rejects anything else', () => {
    expect(isStorageMode('ZERO_STORAGE')).toBe(false)
    expect(isStorageMode('')).toBe(false)
    expect(isStorageMode(null)).toBe(false)
    expect(isStorageMode(undefined)).toBe(false)
    expect(isStorageMode(42)).toBe(false)
  })
})

describe('getStorageMode', () => {
  const ORG = '11111111-1111-4111-8111-111111111111'

  it('returns the mapped mode for a known org', async () => {
    const { env } = makeEnv({ [ORG]: 'zero_storage' })
    expect(await getStorageMode(env as never, ORG)).toBe('zero_storage')
  })

  it('returns standard when the org is not in the bundle', async () => {
    const { env } = makeEnv({ 'other-org': 'insulated' })
    expect(await getStorageMode(env as never, ORG)).toBe('standard')
  })

  it('returns standard when the KV key is missing (bootstrap)', async () => {
    const { env } = makeEnv(null)
    expect(await getStorageMode(env as never, ORG)).toBe('standard')
  })

  it('returns standard when the KV value is an unexpected shape', async () => {
    const env = {
      BANNER_KV: {
        get: async () => ['array', 'not', 'an', 'object'],
      },
    }
    expect(await getStorageMode(env as never, ORG)).toBe('standard')
  })

  it('coerces unknown mode strings to standard (fail-safe)', async () => {
    const { env } = makeEnv({ [ORG]: 'ZERO_STORAGE' })
    expect(await getStorageMode(env as never, ORG)).toBe('standard')
  })

  it('caches the bundle for 60 s — one KV read covers many lookups', async () => {
    const { env, spy } = makeEnv({
      [ORG]: 'zero_storage',
      'other-org': 'insulated',
    })
    let t = 1_000
    const now = () => t
    await getStorageMode(env as never, ORG, { now })
    await getStorageMode(env as never, 'other-org', { now })
    await getStorageMode(env as never, 'unknown-org', { now })
    expect(spy).toHaveBeenCalledTimes(1)
  })

  it('re-reads KV after the cache TTL expires', async () => {
    const { env, spy } = makeEnv({ [ORG]: 'zero_storage' })
    let t = 1_000
    const now = () => t
    await getStorageMode(env as never, ORG, { now })
    t += storageModeCacheTtlMs() + 1
    await getStorageMode(env as never, ORG, { now })
    expect(spy).toHaveBeenCalledTimes(2)
  })
})

describe('isZeroStorage', () => {
  const ORG = '22222222-2222-4222-8222-222222222222'
  it('true when the org is zero_storage', async () => {
    const { env } = makeEnv({ [ORG]: 'zero_storage' })
    expect(await isZeroStorage(env as never, ORG)).toBe(true)
  })
  it('false for standard', async () => {
    const { env } = makeEnv({ [ORG]: 'standard' })
    expect(await isZeroStorage(env as never, ORG)).toBe(false)
  })
  it('false for insulated', async () => {
    const { env } = makeEnv({ [ORG]: 'insulated' })
    expect(await isZeroStorage(env as never, ORG)).toBe(false)
  })
  it('false for unknown orgs (fail-safe)', async () => {
    const { env } = makeEnv({})
    expect(await isZeroStorage(env as never, ORG)).toBe(false)
  })
})
