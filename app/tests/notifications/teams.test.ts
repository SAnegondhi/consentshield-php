import { describe, expect, it } from 'vitest'
import {
  buildTeamsPayload,
  createTeamsAdapter,
} from '../../src/lib/notifications/adapters/teams'
import { AdapterConfigError } from '../../src/lib/notifications/adapters/types'
import type {
  NotificationChannel,
  NotificationEvent,
} from '../../src/lib/notifications/adapters/types'

const VALID_WEBHOOK =
  'https://prod-01.centralindia.logic.azure.com:443/workflows/abc/triggers/When_a_HTTP_request_is_received/paths/invoke?sig=x'

function channel(overrides: Partial<NotificationChannel> = {}): NotificationChannel {
  return {
    id: 'ch-teams-1',
    org_id: 'org-1',
    channel_type: 'teams',
    config: { webhook_url: VALID_WEBHOOK },
    alert_types: ['orphan_events_nonzero'],
    is_active: true,
    ...overrides,
  }
}

function event(overrides: Partial<NotificationEvent> = {}): NotificationEvent {
  return {
    kind: 'orphan_events_nonzero',
    severity: 'critical',
    subject: 'Orphan events critical',
    body: 'Pipeline has been orphaning events for 30 minutes.',
    occurred_at: '2026-04-22T11:00:00Z',
    org_id: 'org-1',
    context: { orphan_count: 15 },
    ...overrides,
  }
}

describe('ADR-1005 Sprint 6.2 — teams adapter: validateConfig', () => {
  const adapter = createTeamsAdapter()

  it('accepts a logic.azure.com workflow URL', () => {
    expect(() => adapter.validateConfig(channel())).not.toThrow()
  })

  it('accepts a webhook.office.com URL (classic)', () => {
    expect(() =>
      adapter.validateConfig(
        channel({
          config: {
            webhook_url: 'https://xxx.webhook.office.com/webhookb2/abc/IncomingWebhook/def/ghi',
          },
        }),
      ),
    ).not.toThrow()
  })

  it('rejects a missing webhook_url', () => {
    expect(() => adapter.validateConfig(channel({ config: {} }))).toThrow(AdapterConfigError)
  })

  it('rejects a non-Microsoft host', () => {
    expect(() =>
      adapter.validateConfig(
        channel({ config: { webhook_url: 'https://hooks.slack.com/services/a/b/c' } }),
      ),
    ).toThrow(/logic.azure.com|webhook.office.com/)
  })

  it('rejects http scheme', () => {
    expect(() =>
      adapter.validateConfig(
        channel({ config: { webhook_url: VALID_WEBHOOK.replace('https://', 'http://') } }),
      ),
    ).toThrow(/https/i)
  })
})

describe('ADR-1005 Sprint 6.2 — teams adapter: buildTeamsPayload', () => {
  it('wraps an AdaptiveCard in a message envelope', () => {
    const p = buildTeamsPayload(event()) as {
      type: string
      attachments: Array<{
        contentType: string
        content: { type: string; version: string; body: unknown[] }
      }>
    }
    expect(p.type).toBe('message')
    expect(p.attachments).toHaveLength(1)
    expect(p.attachments[0].contentType).toBe(
      'application/vnd.microsoft.card.adaptive',
    )
    expect(p.attachments[0].content.type).toBe('AdaptiveCard')
    expect(p.attachments[0].content.body).toHaveLength(3)
  })

  it('severity critical maps to attention-coloured title', () => {
    const p = buildTeamsPayload(event({ severity: 'critical' })) as {
      attachments: Array<{ content: { body: Array<{ color?: string }> } }>
    }
    expect(p.attachments[0].content.body[0].color).toBe('attention')
  })
})

describe('ADR-1005 Sprint 6.2 — teams adapter: deliver', () => {
  it('202 Accepted → ok=true', async () => {
    const adapter = createTeamsAdapter({
      fetchImpl: (async () => new Response('', { status: 202 })) as typeof fetch,
    })
    const res = await adapter.deliver(channel(), event())
    expect(res.ok).toBe(true)
  })

  it('500 → retryable', async () => {
    const adapter = createTeamsAdapter({
      fetchImpl: (async () => new Response('boom', { status: 500 })) as typeof fetch,
    })
    const res = await adapter.deliver(channel(), event())
    if (!res.ok) expect(res.retryable).toBe(true)
  })

  it('400 → non-retryable', async () => {
    const adapter = createTeamsAdapter({
      fetchImpl: (async () => new Response('bad-body', { status: 400 })) as typeof fetch,
    })
    const res = await adapter.deliver(channel(), event())
    if (!res.ok) expect(res.retryable).toBe(false)
  })
})
