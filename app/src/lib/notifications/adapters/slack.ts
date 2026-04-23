// ADR-1005 Sprint 6.2 — Slack Incoming Webhook adapter.
//
// Config shape on notification_channels.config:
//   { webhook_url: "https://hooks.slack.com/services/T.../B.../<secret>" }
//
// Delivery format: Block Kit — a header with the subject, a section with
// the body, and context fields with severity + occurred_at + event.kind.
// Operators can rewrite this rendering without touching the protocol;
// Slack accepts any valid Block Kit payload through a classic webhook.
//
// Retry classification:
//   * 2xx → success (Slack classic webhooks return plain text "ok").
//   * 429 → retryable; honours Retry-After when present (capped to 60s).
//   * 5xx → retryable (Slack is down).
//   * 4xx / other → non-retryable (config, revoked webhook, bad payload).

import { postJson, isRetryableStatus } from './http'
import type {
  DeliveryResult,
  NotificationAdapter,
  NotificationChannel,
  NotificationEvent,
} from './types'
import { AdapterConfigError } from './types'

const SLACK_HOST = 'hooks.slack.com'

export interface SlackAdapterOptions {
  fetchImpl?: typeof fetch
  timeoutMs?: number
}

const SEVERITY_EMOJI: Record<string, string> = {
  info: ':information_source:',
  warning: ':warning:',
  critical: ':rotating_light:',
}

const SEVERITY_COLOR: Record<string, string> = {
  info: '#3b82f6',
  warning: '#f59e0b',
  critical: '#dc2626',
}

export function createSlackAdapter(opts: SlackAdapterOptions = {}): NotificationAdapter {
  return {
    type: 'slack',

    validateConfig(channel: NotificationChannel): void {
      const webhook = channel.config?.webhook_url
      if (typeof webhook !== 'string' || webhook.length === 0) {
        throw new AdapterConfigError(
          'slack adapter config requires a `webhook_url` string field',
          'slack',
          'webhook_url',
        )
      }
      let parsed: URL
      try {
        parsed = new URL(webhook)
      } catch {
        throw new AdapterConfigError(
          `slack webhook_url is not a valid URL`,
          'slack',
          'webhook_url',
        )
      }
      if (parsed.protocol !== 'https:' || parsed.hostname !== SLACK_HOST) {
        throw new AdapterConfigError(
          `slack webhook_url must be https://${SLACK_HOST}/… (got ${parsed.protocol}//${parsed.hostname})`,
          'slack',
          'webhook_url',
        )
      }
    },

    async deliver(
      channel: NotificationChannel,
      event: NotificationEvent,
    ): Promise<DeliveryResult> {
      const webhookUrl = channel.config.webhook_url as string
      const payload = buildSlackPayload(event)

      const outcome = await postJson(webhookUrl, payload, {
        fetchImpl: opts.fetchImpl,
        timeoutMs: opts.timeoutMs,
      })

      if (outcome.kind === 'network') {
        return {
          ok: false,
          retryable: true,
          error: `slack_network_error: ${outcome.error}`,
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
        error: `slack_http_${result.status}: ${result.bodyText.slice(0, 200)}`,
        status_code: result.status,
        latency_ms: result.latency_ms,
      }
    },
  }
}

/**
 * Block Kit payload — a header, a markdown section, and a context row.
 * Exposed for tests to assert the exact shape.
 */
export function buildSlackPayload(event: NotificationEvent): Record<string, unknown> {
  const emoji = SEVERITY_EMOJI[event.severity] ?? ''
  const color = SEVERITY_COLOR[event.severity] ?? '#6b7280'

  const contextElements: Array<{ type: 'mrkdwn'; text: string }> = [
    { type: 'mrkdwn', text: `*Severity:* ${event.severity}` },
    { type: 'mrkdwn', text: `*Kind:* \`${event.kind}\`` },
    { type: 'mrkdwn', text: `*When:* ${event.occurred_at}` },
  ]
  if (event.idempotency_key) {
    contextElements.push({
      type: 'mrkdwn',
      text: `*Idempotency:* \`${event.idempotency_key}\``,
    })
  }

  return {
    // Fallback text shown in notifications where blocks are not rendered.
    text: `${emoji} ${event.subject}`,
    attachments: [
      {
        color,
        blocks: [
          {
            type: 'header',
            text: { type: 'plain_text', text: event.subject, emoji: true },
          },
          {
            type: 'section',
            text: { type: 'mrkdwn', text: event.body },
          },
          {
            type: 'context',
            elements: contextElements,
          },
        ],
      },
    ],
  }
}
