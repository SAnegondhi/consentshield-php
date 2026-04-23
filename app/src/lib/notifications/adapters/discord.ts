// ADR-1005 Sprint 6.2 — Discord Incoming Webhook adapter.
//
// Config shape on notification_channels.config:
//   { webhook_url: "https://discord.com/api/webhooks/<id>/<token>" }
//
// Discord webhooks accept a `content` text field plus up to 10 `embeds`.
// We render a single embed per event — title, description, colored side-
// bar per severity, and timestamp.
//
// Retry classification:
//   * 204 No Content → success (Discord's normal response).
//   * 200 with body → success (rare; Discord may send JSON).
//   * 429 → retryable (Discord enforces rate limits aggressively; we
//     honour fixed backoff rather than Retry-After for code simplicity).
//   * 5xx → retryable.
//   * 4xx → non-retryable.

import { postJson, isRetryableStatus } from './http'
import type {
  DeliveryResult,
  NotificationAdapter,
  NotificationChannel,
  NotificationEvent,
} from './types'
import { AdapterConfigError } from './types'

const ALLOWED_HOSTS = ['discord.com', 'discordapp.com']

export interface DiscordAdapterOptions {
  fetchImpl?: typeof fetch
  timeoutMs?: number
}

const SEVERITY_DECIMAL: Record<string, number> = {
  // Discord embed `color` is an integer in 0xRRGGBB form.
  info: 0x3b82f6,
  warning: 0xf59e0b,
  critical: 0xdc2626,
}

export function createDiscordAdapter(opts: DiscordAdapterOptions = {}): NotificationAdapter {
  return {
    type: 'discord',

    validateConfig(channel: NotificationChannel): void {
      const webhook = channel.config?.webhook_url
      if (typeof webhook !== 'string' || webhook.length === 0) {
        throw new AdapterConfigError(
          'discord adapter config requires a `webhook_url` string field',
          'discord',
          'webhook_url',
        )
      }
      let parsed: URL
      try {
        parsed = new URL(webhook)
      } catch {
        throw new AdapterConfigError(
          'discord webhook_url is not a valid URL',
          'discord',
          'webhook_url',
        )
      }
      if (parsed.protocol !== 'https:') {
        throw new AdapterConfigError(
          'discord webhook_url must be https',
          'discord',
          'webhook_url',
        )
      }
      const hostOk = ALLOWED_HOSTS.some((h) => parsed.hostname === h)
      if (!hostOk) {
        throw new AdapterConfigError(
          `discord webhook_url host must match one of ${ALLOWED_HOSTS.join(', ')} (got ${parsed.hostname})`,
          'discord',
          'webhook_url',
        )
      }
      if (!parsed.pathname.startsWith('/api/webhooks/')) {
        throw new AdapterConfigError(
          'discord webhook_url path must start with /api/webhooks/',
          'discord',
          'webhook_url',
        )
      }
    },

    async deliver(
      channel: NotificationChannel,
      event: NotificationEvent,
    ): Promise<DeliveryResult> {
      const webhookUrl = channel.config.webhook_url as string
      const payload = buildDiscordPayload(event)

      const outcome = await postJson(webhookUrl, payload, {
        fetchImpl: opts.fetchImpl,
        timeoutMs: opts.timeoutMs,
      })

      if (outcome.kind === 'network') {
        return {
          ok: false,
          retryable: true,
          error: `discord_network_error: ${outcome.error}`,
          latency_ms: outcome.latency_ms,
        }
      }

      const { result } = outcome
      if (result.ok) {
        return { ok: true, latency_ms: result.latency_ms }
      }

      return {
        ok: false,
        retryable: isRetryableStatus(result.status),
        error: `discord_http_${result.status}: ${result.bodyText.slice(0, 200)}`,
        status_code: result.status,
        latency_ms: result.latency_ms,
      }
    },
  }
}

export function buildDiscordPayload(event: NotificationEvent): Record<string, unknown> {
  const color = SEVERITY_DECIMAL[event.severity] ?? 0x6b7280

  const fields: Array<{ name: string; value: string; inline?: boolean }> = [
    { name: 'Severity', value: event.severity, inline: true },
    { name: 'Kind', value: event.kind, inline: true },
    { name: 'Org', value: event.org_id, inline: false },
  ]
  if (event.idempotency_key) {
    fields.push({
      name: 'Idempotency',
      value: event.idempotency_key,
      inline: false,
    })
  }

  return {
    username: 'ConsentShield',
    embeds: [
      {
        title: event.subject,
        description: event.body,
        color,
        fields,
        timestamp: event.occurred_at,
      },
    ],
  }
}
