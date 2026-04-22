// ADR-1005 Sprint 6.1 — retry helper unit tests.

import { describe, it, expect } from 'vitest'
import { withRetry, type RetryConfig } from '../../src/lib/notifications/adapters/retry'
import type { DeliveryResult } from '../../src/lib/notifications/adapters/types'

// Zero-sleep config so tests run fast; attempt count + order stays the
// same as production.
const testConfig: RetryConfig = {
  maxAttempts: 3,
  backoffMs: [200, 600],
  sleep: async () => {},
}

function ok(): DeliveryResult {
  return { ok: true, external_id: 'ext', latency_ms: 1 }
}

function retryableFail(): DeliveryResult {
  return { ok: false, retryable: true, error: '500 server', latency_ms: 2 }
}

function fatalFail(): DeliveryResult {
  return { ok: false, retryable: false, error: '400 bad', latency_ms: 2 }
}

describe('withRetry', () => {
  it('returns immediately on first-attempt success', async () => {
    let calls = 0
    const env = await withRetry(async () => {
      calls++
      return ok()
    }, testConfig)
    expect(calls).toBe(1)
    expect(env.attempts).toHaveLength(1)
    expect(env.final.ok).toBe(true)
  })

  it('does not retry on non-retryable failure', async () => {
    let calls = 0
    const env = await withRetry(async () => {
      calls++
      return fatalFail()
    }, testConfig)
    expect(calls).toBe(1)
    expect(env.final.ok).toBe(false)
    if (!env.final.ok) expect(env.final.retryable).toBe(false)
  })

  it('retries up to maxAttempts on retryable failure', async () => {
    let calls = 0
    const env = await withRetry(async () => {
      calls++
      return retryableFail()
    }, testConfig)
    expect(calls).toBe(3)
    expect(env.attempts).toHaveLength(3)
    expect(env.final.ok).toBe(false)
  })

  it('stops retrying once a retry succeeds', async () => {
    const outcomes = [retryableFail(), retryableFail(), ok()]
    let calls = 0
    const env = await withRetry(async () => {
      return outcomes[calls++]
    }, testConfig)
    expect(calls).toBe(3)
    expect(env.final.ok).toBe(true)
    expect(env.attempts).toHaveLength(3)
  })

  it('rejects a config where backoff length != maxAttempts - 1', async () => {
    await expect(
      withRetry(async () => ok(), {
        maxAttempts: 3,
        backoffMs: [100], // wrong length
        sleep: async () => {},
      }),
    ).rejects.toThrow(/RetryConfig mismatch/)
  })

  it('calls sleep between attempts with the configured backoff', async () => {
    const sleeps: number[] = []
    const env = await withRetry(
      async () => retryableFail(),
      {
        maxAttempts: 3,
        backoffMs: [123, 456],
        sleep: async (ms) => {
          sleeps.push(ms)
        },
      },
    )
    expect(sleeps).toEqual([123, 456])
    expect(env.attempts).toHaveLength(3)
  })

  it('does not sleep after the final attempt', async () => {
    const sleeps: number[] = []
    await withRetry(async () => retryableFail(), {
      maxAttempts: 2,
      backoffMs: [50],
      sleep: async (ms) => {
        sleeps.push(ms)
      },
    })
    expect(sleeps).toEqual([50])
  })
})
