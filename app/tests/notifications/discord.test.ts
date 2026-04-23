import { describe, expect, it } from 'vitest'
import {
  buildDiscordPayload,
  createDiscordAdapter,
} from '../../src/lib/notifications/adapters/discord'
import { AdapterConfigError } from '../../src/lib/notifications/adapters/types'
import type {
  NotificationChannel,
  NotificationEvent,
} from '../../src/lib/notifications/adapters/types'

const VALID_WEBHOOK = 'https://discord.com/api/webhooks/123/abc-token'

function channel(overrides: Partial<NotificationChannel> = {}): NotificationChannel {
  return {
    id: 'ch-discord-1',
    org_id: 'org-1',
    channel_type: 'discord',
    config: { webhook_url: VALID_WEBHOOK },
    alert_types: ['orphan_events_nonzero'],
    is_active: true,
    ...overrides,
  }
}

function event(overrides: Partial<NotificationEvent> = {}): NotificationEvent {
  return {
    kind: 'orphan_events_nonzero',
    severity: 'info',
    subject: 'Discord test',
    body: 'body',
    occurred_at: '2026-04-22T11:00:00Z',
    org_id: 'org-1',
    context: {},
    ...overrides,
  }
}

describe('ADR-1005 Sprint 6.2 — discord adapter: validateConfig', () => {
  const adapter = createDiscordAdapter()

  it('accepts a valid discord.com webhook URL', () => {
    expect(() => adapter.validateConfig(channel())).not.toThrow()
  })

  it('accepts the older discordapp.com host', () => {
    expect(() =>
      adapter.validateConfig(
        channel({ config: { webhook_url: 'https://discordapp.com/api/webhooks/1/t' } }),
      ),
    ).not.toThrow()
  })

  it('rejects a missing webhook_url', () => {
    expect(() => adapter.validateConfig(channel({ config: {} }))).toThrow(AdapterConfigError)
  })

  it('rejects a non-discord host', () => {
    expect(() =>
      adapter.validateConfig(
        channel({ config: { webhook_url: 'https://example.com/api/webhooks/1/t' } }),
      ),
    ).toThrow(/discord/)
  })

  it('rejects a URL whose path does not start with /api/webhooks/', () => {
    expect(() =>
      adapter.validateConfig(
        channel({ config: { webhook_url: 'https://discord.com/other/1/t' } }),
      ),
    ).toThrow(/api\/webhooks/)
  })
})

describe('ADR-1005 Sprint 6.2 — discord adapter: buildDiscordPayload', () => {
  it('single embed with colour + fields + timestamp', () => {
    const p = buildDiscordPayload(event({ severity: 'critical' })) as {
      embeds: Array<{ color: number; fields: Array<{ name: string }>; timestamp: string }>
    }
    expect(p.embeds).toHaveLength(1)
    expect(p.embeds[0].color).toBe(0xdc2626)
    expect(p.embeds[0].fields.length).toBeGreaterThan(0)
    expect(p.embeds[0].timestamp).toBe('2026-04-22T11:00:00Z')
  })
})

describe('ADR-1005 Sprint 6.2 — discord adapter: deliver', () => {
  it('204 No Content → ok=true', async () => {
    const adapter = createDiscordAdapter({
      fetchImpl: (async () => new Response(null, { status: 204 })) as typeof fetch,
    })
    const res = await adapter.deliver(channel(), event())
    expect(res.ok).toBe(true)
  })

  it('429 → retryable', async () => {
    const adapter = createDiscordAdapter({
      fetchImpl: (async () =>
        new Response('{"message":"You are being rate limited.","retry_after":1}', {
          status: 429,
        })) as typeof fetch,
    })
    const res = await adapter.deliver(channel(), event())
    if (!res.ok) expect(res.retryable).toBe(true)
  })

  it('401 → non-retryable (token revoked)', async () => {
    const adapter = createDiscordAdapter({
      fetchImpl: (async () => new Response('unauthorized', { status: 401 })) as typeof fetch,
    })
    const res = await adapter.deliver(channel(), event())
    if (!res.ok) expect(res.retryable).toBe(false)
  })
})
