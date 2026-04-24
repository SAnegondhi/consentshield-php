// ADR-1003 Sprint 1.1 — storage-mode resolver (Next.js side).

import { describe, expect, it, vi } from 'vitest'
import { getStorageMode, isStorageMode } from '@/lib/storage/mode'

interface StubFn {
  (strings: TemplateStringsArray, ...values: unknown[]): Promise<unknown[]>
  calls: Array<{ query: string; values: unknown[] }>
}

function makePgStub(responses: Array<unknown[] | Error>) {
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
  fn.calls = calls
  return fn
}

const ORG_ID = '11111111-1111-4111-8111-111111111111'

describe('isStorageMode', () => {
  it('narrows to the canonical three', () => {
    expect(isStorageMode('standard')).toBe(true)
    expect(isStorageMode('insulated')).toBe(true)
    expect(isStorageMode('zero_storage')).toBe(true)
    expect(isStorageMode('other')).toBe(false)
    expect(isStorageMode(null)).toBe(false)
  })
})

describe('getStorageMode', () => {
  it('returns the mode reported by public.get_storage_mode', async () => {
    const pg = makePgStub([[{ mode: 'zero_storage' }]])
    expect(await getStorageMode(pg as never, ORG_ID)).toBe('zero_storage')
    expect(pg.calls[0]!.query).toContain('get_storage_mode')
    expect(pg.calls[0]!.values).toContain(ORG_ID)
  })

  it('falls back to standard on null', async () => {
    const pg = makePgStub([[{ mode: null }]])
    expect(await getStorageMode(pg as never, ORG_ID)).toBe('standard')
  })

  it('falls back to standard on an unknown mode string', async () => {
    const pg = makePgStub([[{ mode: 'ZERO_STORAGE' }]])
    expect(await getStorageMode(pg as never, ORG_ID)).toBe('standard')
  })

  it('falls back to standard on empty result', async () => {
    const pg = makePgStub([[]])
    expect(await getStorageMode(pg as never, ORG_ID)).toBe('standard')
  })
})
