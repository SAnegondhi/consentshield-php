// ADR-1005 Sprint 6.1 — dispatcher unit tests.

import { describe, it, expect, beforeEach } from 'vitest'
import { dispatchEvent } from '../../src/lib/notifications/dispatch'
import { createMockAdapter } from '../../src/lib/notifications/adapters/mock'
import {
  registerAdapter,
  resetRegistry,
} from '../../src/lib/notifications/adapters/registry'
import type {
  NotificationChannel,
  NotificationEvent,
} from '../../src/lib/notifications/adapters/types'

const ORG_A = '11111111-1111-1111-1111-111111111111'
const ORG_B = '22222222-2222-2222-2222-222222222222'

function makeChannel(
  overrides: Partial<NotificationChannel> = {},
): NotificationChannel {
  return {
    id: crypto.randomUUID(),
    org_id: ORG_A,
    channel_type: 'mock',
    config: { kind: 'test' },
    alert_types: ['orphan_events_nonzero'],
    is_active: true,
    ...overrides,
  }
}

function makeEvent(
  overrides: Partial<NotificationEvent> = {},
): NotificationEvent {
  return {
    kind: 'orphan_events_nonzero',
    severity: 'warning',
    subject: 'Orphan events detected',
    body: '4 orphan consent events in the last 24h',
    occurred_at: new Date().toISOString(),
    org_id: ORG_A,
    context: { count: 4 },
    ...overrides,
  }
}

let mock: ReturnType<typeof createMockAdapter>

beforeEach(() => {
  resetRegistry()
  mock = createMockAdapter()
  registerAdapter(mock)
})

describe('dispatchEvent', () => {
  it('delivers to every matching channel', async () => {
    const channels = [makeChannel(), makeChannel(), makeChannel()]
    const report = await dispatchEvent(makeEvent(), channels)
    expect(report.total_channels).toBe(3)
    expect(report.succeeded).toBe(3)
    expect(report.failed).toBe(0)
    expect(mock.calls).toHaveLength(3)
  })

  it('skips channels that are inactive', async () => {
    const active = makeChannel()
    const inactive = makeChannel({ is_active: false })
    const report = await dispatchEvent(makeEvent(), [active, inactive])
    expect(report.total_channels).toBe(1)
    expect(mock.calls).toHaveLength(1)
    expect(mock.calls[0].channelId).toBe(active.id)
  })

  it('skips channels whose alert_types does not include the event kind', async () => {
    const subscribed = makeChannel({ alert_types: ['orphan_events_nonzero'] })
    const notSubscribed = makeChannel({ alert_types: ['deletion_sla_overdue'] })
    const report = await dispatchEvent(makeEvent(), [subscribed, notSubscribed])
    expect(report.total_channels).toBe(1)
    expect(mock.calls[0].channelId).toBe(subscribed.id)
  })

  it('skips channels scoped to a different org', async () => {
    const orgA = makeChannel({ org_id: ORG_A })
    const orgB = makeChannel({ org_id: ORG_B })
    const report = await dispatchEvent(
      makeEvent({ org_id: ORG_A }),
      [orgA, orgB],
    )
    expect(report.total_channels).toBe(1)
    expect(mock.calls[0].orgId).toBe(ORG_A)
  })

  it('folds config errors into the report as non-retryable', async () => {
    const bad = makeChannel({ config: {} }) // missing `kind` field
    const report = await dispatchEvent(makeEvent(), [bad])
    expect(report.failed).toBe(1)
    expect(report.outcomes[0].ok).toBe(false)
    expect(report.outcomes[0].config_error).toBe(true)
    expect(report.outcomes[0].attempts).toBe(0)
    expect(mock.calls).toHaveLength(0)
  })

  it('retries retryable failures and reports attempts', async () => {
    mock.setNextResult([
      { ok: false, retryable: true, error: '500', latency_ms: 10 },
      { ok: false, retryable: true, error: '500', latency_ms: 10 },
      { ok: true, external_id: 'ext-ok', latency_ms: 10 },
    ])
    const report = await dispatchEvent(makeEvent(), [makeChannel()], {
      retry: { maxAttempts: 3, backoffMs: [0, 0], sleep: async () => {} },
    })
    expect(report.succeeded).toBe(1)
    expect(report.outcomes[0].attempts).toBe(3)
    expect(report.outcomes[0].external_id).toBe('ext-ok')
    expect(mock.calls).toHaveLength(3)
  })

  it('does not retry non-retryable failures', async () => {
    mock.setNextResult({ ok: false, retryable: false, error: '400', latency_ms: 5 })
    const report = await dispatchEvent(makeEvent(), [makeChannel()], {
      retry: { maxAttempts: 3, backoffMs: [0, 0], sleep: async () => {} },
    })
    expect(report.failed).toBe(1)
    expect(report.outcomes[0].attempts).toBe(1)
    expect(report.outcomes[0].retryable).toBe(false)
    expect(mock.calls).toHaveLength(1)
  })

  it('aggregates per-attempt latency', async () => {
    mock.setNextResult([
      { ok: false, retryable: true, error: '500', latency_ms: 10 },
      { ok: true, external_id: 'x', latency_ms: 20 },
    ])
    const report = await dispatchEvent(makeEvent(), [makeChannel()], {
      retry: { maxAttempts: 2, backoffMs: [0], sleep: async () => {} },
    })
    expect(report.outcomes[0].total_latency_ms).toBe(30)
  })
})
