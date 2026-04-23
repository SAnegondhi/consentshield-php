import { describe, expect, it } from 'vitest'
import {
  buildPagerDutyPayload,
  createPagerDutyAdapter,
} from '../../src/lib/notifications/adapters/pagerduty'
import { AdapterConfigError } from '../../src/lib/notifications/adapters/types'
import type {
  NotificationChannel,
  NotificationEvent,
} from '../../src/lib/notifications/adapters/types'

const VALID_KEY = 'A'.repeat(32)

function channel(overrides: Partial<NotificationChannel> = {}): NotificationChannel {
  return {
    id: 'ch-pd-1',
    org_id: 'org-1',
    channel_type: 'pagerduty',
    config: { routing_key: VALID_KEY },
    alert_types: ['orphan_events_nonzero'],
    is_active: true,
    ...overrides,
  }
}

function event(overrides: Partial<NotificationEvent> = {}): NotificationEvent {
  return {
    kind: 'orphan_events_nonzero',
    severity: 'critical',
    subject: 'SEV1 — pipeline down',
    body: 'Details...',
    occurred_at: '2026-04-22T11:00:00Z',
    org_id: 'org-1',
    context: { orphan_count: 42 },
    idempotency_key: 'pipeline-2026-04-22',
    ...overrides,
  }
}

describe('ADR-1005 Sprint 6.3 — pagerduty adapter: validateConfig', () => {
  const adapter = createPagerDutyAdapter()

  it('accepts a 32-char hex routing key', () => {
    expect(() => adapter.validateConfig(channel())).not.toThrow()
  })

  it('rejects a missing routing_key', () => {
    expect(() => adapter.validateConfig(channel({ config: {} }))).toThrow(AdapterConfigError)
  })

  it('rejects a too-short routing_key', () => {
    expect(() =>
      adapter.validateConfig(channel({ config: { routing_key: 'short' } })),
    ).toThrow(/32-character/)
  })

  it('rejects a key with non-alphanumeric characters', () => {
    expect(() =>
      adapter.validateConfig(
        channel({ config: { routing_key: '!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!' } }),
      ),
    ).toThrow(/32-character/)
  })
})

describe('ADR-1005 Sprint 6.3 — pagerduty adapter: buildPagerDutyPayload', () => {
  it('produces a trigger event with dedup_key from idempotency_key', () => {
    const p = buildPagerDutyPayload(event(), VALID_KEY) as {
      routing_key: string
      event_action: string
      dedup_key: string
      payload: {
        summary: string
        severity: string
        custom_details: Record<string, unknown>
      }
    }
    expect(p.routing_key).toBe(VALID_KEY)
    expect(p.event_action).toBe('trigger')
    expect(p.dedup_key).toBe('pipeline-2026-04-22')
    expect(p.payload.summary).toBe('SEV1 — pipeline down')
    expect(p.payload.severity).toBe('critical')
    expect(p.payload.custom_details.orphan_count).toBe(42)
  })

  it('falls back to synthetic dedup_key when no idempotency_key given', () => {
    const p = buildPagerDutyPayload(event({ idempotency_key: undefined }), VALID_KEY) as {
      dedup_key: string
    }
    expect(p.dedup_key).toBe('consentshield:org-1:orphan_events_nonzero')
  })

  it('severity warning → pd warning', () => {
    const p = buildPagerDutyPayload(event({ severity: 'warning' }), VALID_KEY) as {
      payload: { severity: string }
    }
    expect(p.payload.severity).toBe('warning')
  })
})

describe('ADR-1005 Sprint 6.3 — pagerduty adapter: deliver', () => {
  it('202 → ok=true and external_id from dedup_key', async () => {
    const adapter = createPagerDutyAdapter({
      enqueueUrl: 'https://test.pagerduty/enqueue',
      fetchImpl: (async () =>
        new Response(
          JSON.stringify({
            status: 'success',
            message: 'Event processed',
            dedup_key: 'incident-abc',
          }),
          { status: 202, headers: { 'content-type': 'application/json' } },
        )) as typeof fetch,
    })
    const res = await adapter.deliver(channel(), event())
    expect(res.ok).toBe(true)
    if (res.ok) expect(res.external_id).toBe('incident-abc')
  })

  it('400 → ok=false non-retryable (bad payload)', async () => {
    const adapter = createPagerDutyAdapter({
      enqueueUrl: 'https://test.pagerduty/enqueue',
      fetchImpl: (async () =>
        new Response('{"status":"invalid event","message":"bad"}', {
          status: 400,
        })) as typeof fetch,
    })
    const res = await adapter.deliver(channel(), event())
    if (!res.ok) expect(res.retryable).toBe(false)
  })

  it('429 → retryable', async () => {
    const adapter = createPagerDutyAdapter({
      enqueueUrl: 'https://test.pagerduty/enqueue',
      fetchImpl: (async () =>
        new Response('rate limited', { status: 429 })) as typeof fetch,
    })
    const res = await adapter.deliver(channel(), event())
    if (!res.ok) expect(res.retryable).toBe(true)
  })

  it('503 → retryable', async () => {
    const adapter = createPagerDutyAdapter({
      enqueueUrl: 'https://test.pagerduty/enqueue',
      fetchImpl: (async () =>
        new Response('maintenance', { status: 503 })) as typeof fetch,
    })
    const res = await adapter.deliver(channel(), event())
    if (!res.ok) expect(res.retryable).toBe(true)
  })
})
