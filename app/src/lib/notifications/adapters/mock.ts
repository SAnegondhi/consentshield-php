// ADR-1005 Sprint 6.1 — mock adapter for tests.
//
// Every call to deliver() is recorded on an in-memory `events` array so
// assertions can verify dispatch reached the adapter with the right event
// shape. Response can be scripted per-test via `setNextResult()` / the
// `scriptedResults` queue to exercise retry behaviour.
//
// The registry exposes this adapter only when NODE_ENV === 'test'. In
// prod the import is still available but nothing routes to it.

import type {
  DeliveryResult,
  NotificationAdapter,
  NotificationChannel,
  NotificationEvent,
} from './types'
import { AdapterConfigError } from './types'

export interface MockCall {
  channelId: string
  orgId: string
  event: NotificationEvent
  at: number
}

/**
 * The test's handle into the adapter's inbox + response scripting.
 */
export interface MockAdapter extends NotificationAdapter {
  readonly type: 'mock'
  calls: MockCall[]
  reset(): void
  setNextResult(r: DeliveryResult | DeliveryResult[]): void
}

export function createMockAdapter(): MockAdapter {
  const calls: MockCall[] = []
  let scripted: DeliveryResult[] = []

  const defaultOk: DeliveryResult = {
    ok: true,
    external_id: 'mock-external-id',
    latency_ms: 3,
  }

  return {
    type: 'mock',
    calls,

    reset() {
      calls.length = 0
      scripted = []
    },

    setNextResult(r: DeliveryResult | DeliveryResult[]) {
      scripted = Array.isArray(r) ? [...r] : [r]
    },

    validateConfig(channel: NotificationChannel): void {
      // Mock's only required key is `kind` — keeps the config shape
      // distinguishable in tests so we can assert adapter-agnostic code
      // doesn't accidentally reuse a different adapter's config blob.
      if (typeof channel.config?.kind !== 'string') {
        throw new AdapterConfigError(
          'mock adapter config requires a `kind` string field',
          'mock',
          'kind',
        )
      }
    },

    async deliver(
      channel: NotificationChannel,
      event: NotificationEvent,
    ): Promise<DeliveryResult> {
      calls.push({
        channelId: channel.id,
        orgId: channel.org_id,
        event,
        at: Date.now(),
      })
      if (scripted.length > 0) {
        return scripted.shift()!
      }
      return defaultOk
    },
  }
}
