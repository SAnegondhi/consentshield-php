// ADR-1005 Sprint 6.1 — retry helper for NotificationAdapter.deliver.
//
// Contract:
//   * Max 3 attempts (1 original + 2 retries).
//   * Exponential backoff: 200ms, 600ms between attempts.
//   * Retry only when the adapter marks the failure `retryable: true`
//     (5xx / network timeout / socket error). 4xx / config errors do NOT
//     retry — fixing them requires operator action, not another attempt.
//   * Returns the last DeliveryResult (success or final failure).
//
// Adapters own the retryable decision because different surfaces map
// status codes differently: PagerDuty considers 429 permanent; Slack's
// 429 carries Retry-After and should retry after that delay. The retry
// helper here is intentionally adapter-agnostic; per-adapter backoff
// overrides would live in each adapter's own deliver() if needed.

import type { DeliveryResult } from './types'

export interface RetryConfig {
  maxAttempts: number
  backoffMs: number[] // length must equal maxAttempts - 1
  sleep?: (ms: number) => Promise<void>
}

export const DEFAULT_RETRY: RetryConfig = {
  maxAttempts: 3,
  backoffMs: [200, 600],
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * Wraps a per-attempt deliver callback with retry logic.
 *
 * The callback is `() => Promise<DeliveryResult>` rather than
 * `(channel, event) => ...` so the retry helper stays oblivious to the
 * adapter's call shape. Callers close over whatever args they need.
 *
 * Aggregates per-attempt results on the `attempts` array of the returned
 * envelope so the dispatcher can log every attempt's latency + error.
 */
export interface RetryEnvelope {
  final: DeliveryResult
  attempts: DeliveryResult[]
}

export async function withRetry(
  attempt: () => Promise<DeliveryResult>,
  config: RetryConfig = DEFAULT_RETRY,
): Promise<RetryEnvelope> {
  if (config.backoffMs.length !== config.maxAttempts - 1) {
    throw new Error(
      `RetryConfig mismatch: maxAttempts=${config.maxAttempts} but backoffMs.length=${config.backoffMs.length}; expected ${config.maxAttempts - 1}.`,
    )
  }

  const sleep = config.sleep ?? defaultSleep
  const attempts: DeliveryResult[] = []

  for (let i = 0; i < config.maxAttempts; i++) {
    const result = await attempt()
    attempts.push(result)

    if (result.ok) {
      return { final: result, attempts }
    }

    // Non-retryable failure: give up immediately.
    if (!result.retryable) {
      return { final: result, attempts }
    }

    // Final attempt: don't sleep, just return.
    const isLast = i === config.maxAttempts - 1
    if (isLast) {
      return { final: result, attempts }
    }

    await sleep(config.backoffMs[i])
  }

  // Unreachable, but TypeScript needs an explicit return.
  return { final: attempts[attempts.length - 1], attempts }
}
