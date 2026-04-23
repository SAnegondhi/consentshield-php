import { describe, expect, it } from 'vitest'
import {
  buildSlackPayload,
  createSlackAdapter,
} from '../../src/lib/notifications/adapters/slack'
import { AdapterConfigError } from '../../src/lib/notifications/adapters/types'
import type {
  NotificationChannel,
  NotificationEvent,
} from '../../src/lib/notifications/adapters/types'

const VALID_WEBHOOK = 'https://hooks.slack.com/services/T000/B000/secret'

function channel(overrides: Partial<NotificationChannel> = {}): NotificationChannel {
  return {
    id: 'ch-slack-1',
    org_id: 'org-1',
    channel_type: 'slack',
    config: { webhook_url: VALID_WEBHOOK },
    alert_types: ['orphan_events_nonzero'],
    is_active: true,
    ...overrides,
  }
}

function event(overrides: Partial<NotificationEvent> = {}): NotificationEvent {
  return {
    kind: 'orphan_events_nonzero',
    severity: 'warning',
    subject: 'Orphan consent events detected',
    body: '*3* events still orphaned after 15 minutes.',
    occurred_at: '2026-04-22T11:00:00Z',
    org_id: 'org-1',
    context: { orphan_count: 3 },
    idempotency_key: 'orphan:2026-04-22T11:00',
    ...overrides,
  }
}

describe('ADR-1005 Sprint 6.2 — slack adapter: validateConfig', () => {
  const adapter = createSlackAdapter()

  it('accepts a valid hooks.slack.com URL', () => {
    expect(() => adapter.validateConfig(channel())).not.toThrow()
  })

  it('rejects a missing webhook_url', () => {
    expect(() => adapter.validateConfig(channel({ config: {} }))).toThrow(AdapterConfigError)
  })

  it('rejects a malformed URL', () => {
    expect(() =>
      adapter.validateConfig(channel({ config: { webhook_url: 'not-a-url' } })),
    ).toThrow(/valid URL/i)
  })

  it('rejects http scheme', () => {
    expect(() =>
      adapter.validateConfig(
        channel({ config: { webhook_url: 'http://hooks.slack.com/services/a/b/c' } }),
      ),
    ).toThrow(/https/i)
  })

  it('rejects the wrong host', () => {
    expect(() =>
      adapter.validateConfig(
        channel({ config: { webhook_url: 'https://example.com/hook' } }),
      ),
    ).toThrow(/hooks.slack.com/)
  })
})

describe('ADR-1005 Sprint 6.2 — slack adapter: buildSlackPayload', () => {
  it('produces header + section + context blocks', () => {
    const p = buildSlackPayload(event()) as {
      attachments: Array<{
        blocks: Array<{ type: string; text?: { text: string }; elements?: unknown[] }>
      }>
    }
    const blocks = p.attachments[0].blocks
    expect(blocks).toHaveLength(3)
    expect(blocks[0].type).toBe('header')
    expect(blocks[1].type).toBe('section')
    expect(blocks[2].type).toBe('context')
  })

  it('omits the idempotency context line when the key is absent', () => {
    const p = buildSlackPayload(event({ idempotency_key: undefined })) as {
      attachments: Array<{ blocks: Array<{ elements?: unknown[] }> }>
    }
    const contextBlock = p.attachments[0].blocks[2]
    expect(contextBlock.elements).toHaveLength(3)
  })
})

describe('ADR-1005 Sprint 6.2 — slack adapter: deliver', () => {
  it('200 → ok=true with latency_ms', async () => {
    const adapter = createSlackAdapter({
      fetchImpl: mockFetch(200, 'ok'),
    })
    const res = await adapter.deliver(channel(), event())
    expect(res.ok).toBe(true)
    if (res.ok) expect(res.latency_ms).toBeGreaterThanOrEqual(0)
  })

  it('500 → ok=false retryable=true', async () => {
    const adapter = createSlackAdapter({
      fetchImpl: mockFetch(500, 'server_error'),
    })
    const res = await adapter.deliver(channel(), event())
    expect(res.ok).toBe(false)
    if (!res.ok) {
      expect(res.retryable).toBe(true)
      expect(res.status_code).toBe(500)
    }
  })

  it('429 → ok=false retryable=true', async () => {
    const adapter = createSlackAdapter({
      fetchImpl: mockFetch(429, 'rate_limited'),
    })
    const res = await adapter.deliver(channel(), event())
    if (!res.ok) expect(res.retryable).toBe(true)
  })

  it('404 → ok=false retryable=false (webhook revoked / bad path)', async () => {
    const adapter = createSlackAdapter({
      fetchImpl: mockFetch(404, 'invalid_webhook'),
    })
    const res = await adapter.deliver(channel(), event())
    if (!res.ok) {
      expect(res.retryable).toBe(false)
      expect(res.status_code).toBe(404)
    }
  })

  it('network error → ok=false retryable=true', async () => {
    const adapter = createSlackAdapter({
      fetchImpl: async () => {
        throw new Error('connection refused')
      },
    })
    const res = await adapter.deliver(channel(), event())
    expect(res.ok).toBe(false)
    if (!res.ok) {
      expect(res.retryable).toBe(true)
      expect(res.error).toMatch(/connection refused/)
    }
  })
})

function mockFetch(status: number, body: string): typeof fetch {
  return (async () =>
    new Response(body, {
      status,
      headers: { 'content-type': 'text/plain' },
    })) as typeof fetch
}
