// ADR-1019 Sprint 2.2 — deliverBatch unit tests.
//
// Stubs deliverOne via deps.deliverOneFn so these tests focus on batch
// logic: selection query shape, budget, soft-fail, outcome tallying.

import { describe, expect, it, vi } from 'vitest'
import type {
  DeliverOneResult,
  DeliverOutcome,
} from '@/lib/delivery/deliver-events'
import { deliverBatch } from '@/lib/delivery/deliver-events'

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

function result(
  outcome: DeliverOutcome,
  rowId = '11111111-1111-4111-8111-111111111111',
): DeliverOneResult {
  return { outcome, rowId, durationMs: 1 }
}

describe('deliverBatch', () => {
  it('returns a zero summary on an empty queue', async () => {
    const pg = makePgStub([[]])
    const deliverOneFn = vi.fn()
    const out = await deliverBatch(pg, 200, { deliverOneFn })
    expect(out.attempted).toBe(0)
    expect(out.delivered).toBe(0)
    expect(out.budgetExceeded).toBe(false)
    expect(deliverOneFn).not.toHaveBeenCalled()
  })

  it('delivers a happy batch of 3', async () => {
    const ids = ['a', 'b', 'c'].map(
      (x) => `${x}0000000-1111-4111-8111-111111111111`,
    )
    const pg = makePgStub([ids.map((id) => ({ id }))])
    const deliverOneFn = vi.fn().mockImplementation((_pg, id) =>
      Promise.resolve(result('delivered', id)),
    )
    const out = await deliverBatch(pg, 200, { deliverOneFn })
    expect(out.attempted).toBe(3)
    expect(out.delivered).toBe(3)
    expect(out.outcomes.delivered).toBe(3)
    expect(deliverOneFn).toHaveBeenCalledTimes(3)
  })

  it('tallies mixed outcomes correctly', async () => {
    const ids = ['a', 'b', 'c', 'd'].map(
      (x) => `${x}0000000-1111-4111-8111-111111111111`,
    )
    const pg = makePgStub([ids.map((id) => ({ id }))])
    const outcomesByIndex: DeliverOutcome[] = [
      'delivered',
      'unverified_export_config',
      'upload_failed',
      'decrypt_failed',
    ]
    const deliverOneFn = vi.fn().mockImplementation((_pg, id: string) => {
      const idx = ids.indexOf(id)
      return Promise.resolve(result(outcomesByIndex[idx]!, id))
    })
    const out = await deliverBatch(pg, 200, { deliverOneFn })
    expect(out.attempted).toBe(4)
    expect(out.delivered).toBe(1)
    expect(out.quarantined).toBe(3)
    expect(out.outcomes).toMatchObject({
      delivered: 1,
      unverified_export_config: 1,
      upload_failed: 1,
      decrypt_failed: 1,
    })
  })

  it('stops pulling new rows once the wall-time budget is exceeded', async () => {
    const ids = Array.from({ length: 5 }, (_, i) => `${i}-budget`)
    const pg = makePgStub([ids.map((id) => ({ id }))])
    let clock = 0
    const now = () => {
      clock += 100_000 // 100 s per tick — 3 rows fit in the 270s budget
      return clock
    }
    const deliverOneFn = vi.fn().mockImplementation((_pg, id: string) =>
      Promise.resolve(result('delivered', id)),
    )
    const out = await deliverBatch(pg, 200, { deliverOneFn, now })
    expect(out.attempted).toBeLessThan(5)
    expect(out.budgetExceeded).toBe(true)
  })

  it('soft-fails on a deliverOne throw, marks the row, keeps going', async () => {
    const ids = ['a', 'b', 'c'].map(
      (x) => `${x}0000000-1111-4111-8111-111111111111`,
    )
    const pg = makePgStub([
      ids.map((id) => ({ id })),
      [], // markFailure on the throwing row
    ])
    const deliverOneFn = vi.fn().mockImplementation((_pg, id: string) => {
      if (id.startsWith('b')) {
        return Promise.reject(new Error('transient pg outage'))
      }
      return Promise.resolve(result('delivered', id))
    })
    const out = await deliverBatch(pg, 200, { deliverOneFn })
    expect(out.attempted).toBe(3)
    expect(out.delivered).toBe(2)
    expect(out.outcomes.upload_failed).toBe(1)
    // markFailure UPDATE must have been fired on the throwing row.
    const lastQuery = pg.calls[pg.calls.length - 1]!.query
    expect(lastQuery).toContain('update public.delivery_buffer')
  })

  it('candidate query respects the manual-review threshold + backoff', async () => {
    const pg = makePgStub([[]])
    const deliverOneFn = vi.fn()
    await deliverBatch(pg, 42, { deliverOneFn })
    expect(pg.calls).toHaveLength(1)
    const q = pg.calls[0]!.query
    expect(q).toContain('delivered_at is null')
    expect(q).toContain('attempt_count <')
    expect(q).toContain('last_attempted_at')
    expect(q).toContain('power(2, attempt_count)')
    expect(q).toContain('order by first_attempted_at asc nulls first')
    expect(pg.calls[0]!.values).toContain(42)
  })

  it('respects the caller-provided limit (clamped by route)', async () => {
    const pg = makePgStub([[]])
    const deliverOneFn = vi.fn()
    await deliverBatch(pg, 7, { deliverOneFn })
    expect(pg.calls[0]!.values).toContain(7)
  })
})
