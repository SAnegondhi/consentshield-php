// ADR-1005 Sprint 6.2 — Microsoft Teams webhook adapter.
//
// Config shape on notification_channels.config:
//   { webhook_url: "https://prod-NN.<region>.logic.azure.com:443/workflows/<guid>/triggers/..." }
//
// Teams classic Office-365 connector webhooks were deprecated in late
// 2025 and fully turned off mid-2026. The current supported path is the
// Workflows app (Power Automate under the hood). Its HTTP trigger
// accepts any JSON body, but to render as a rich card in the channel
// the body must be an Adaptive Card v1.5 envelope wrapped in the
// Microsoft "message" outer shape:
//   {
//     "type": "message",
//     "attachments": [{
//       "contentType": "application/vnd.microsoft.card.adaptive",
//       "content": { <AdaptiveCard> }
//     }]
//   }
//
// Retry classification:
//   * 2xx (usually 202 — Workflows accepts + queues the post).
//   * 429 → retryable.
//   * 5xx → retryable.
//   * 4xx / other → non-retryable.

import { postJson, isRetryableStatus } from './http'
import type {
  DeliveryResult,
  NotificationAdapter,
  NotificationChannel,
  NotificationEvent,
} from './types'
import { AdapterConfigError } from './types'

const ALLOWED_HOSTS = ['logic.azure.com', 'webhook.office.com']

export interface TeamsAdapterOptions {
  fetchImpl?: typeof fetch
  timeoutMs?: number
}

const SEVERITY_COLOR: Record<string, string> = {
  info: 'good',
  warning: 'warning',
  critical: 'attention',
}

export function createTeamsAdapter(opts: TeamsAdapterOptions = {}): NotificationAdapter {
  return {
    type: 'teams',

    validateConfig(channel: NotificationChannel): void {
      const webhook = channel.config?.webhook_url
      if (typeof webhook !== 'string' || webhook.length === 0) {
        throw new AdapterConfigError(
          'teams adapter config requires a `webhook_url` string field',
          'teams',
          'webhook_url',
        )
      }
      let parsed: URL
      try {
        parsed = new URL(webhook)
      } catch {
        throw new AdapterConfigError(
          'teams webhook_url is not a valid URL',
          'teams',
          'webhook_url',
        )
      }
      if (parsed.protocol !== 'https:') {
        throw new AdapterConfigError(
          'teams webhook_url must be https',
          'teams',
          'webhook_url',
        )
      }
      const hostOk = ALLOWED_HOSTS.some((h) => parsed.hostname.endsWith(h))
      if (!hostOk) {
        throw new AdapterConfigError(
          `teams webhook_url host must match one of ${ALLOWED_HOSTS.join(', ')} (got ${parsed.hostname})`,
          'teams',
          'webhook_url',
        )
      }
    },

    async deliver(
      channel: NotificationChannel,
      event: NotificationEvent,
    ): Promise<DeliveryResult> {
      const webhookUrl = channel.config.webhook_url as string
      const payload = buildTeamsPayload(event)

      const outcome = await postJson(webhookUrl, payload, {
        fetchImpl: opts.fetchImpl,
        timeoutMs: opts.timeoutMs,
      })

      if (outcome.kind === 'network') {
        return {
          ok: false,
          retryable: true,
          error: `teams_network_error: ${outcome.error}`,
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
        error: `teams_http_${result.status}: ${result.bodyText.slice(0, 200)}`,
        status_code: result.status,
        latency_ms: result.latency_ms,
      }
    },
  }
}

/**
 * Adaptive-Card-in-message envelope. Exposed for tests.
 */
export function buildTeamsPayload(event: NotificationEvent): Record<string, unknown> {
  const color = SEVERITY_COLOR[event.severity] ?? 'default'

  const facts: Array<{ title: string; value: string }> = [
    { title: 'Severity', value: event.severity },
    { title: 'Kind', value: event.kind },
    { title: 'When', value: event.occurred_at },
    { title: 'Org', value: event.org_id },
  ]
  if (event.idempotency_key) {
    facts.push({ title: 'Idempotency', value: event.idempotency_key })
  }

  return {
    type: 'message',
    attachments: [
      {
        contentType: 'application/vnd.microsoft.card.adaptive',
        contentUrl: null,
        content: {
          $schema: 'http://adaptivecards.io/schemas/adaptive-card.json',
          type: 'AdaptiveCard',
          version: '1.5',
          body: [
            {
              type: 'TextBlock',
              text: event.subject,
              weight: 'Bolder',
              size: 'Large',
              color,
              wrap: true,
            },
            {
              type: 'TextBlock',
              text: event.body,
              wrap: true,
              spacing: 'Small',
            },
            {
              type: 'FactSet',
              facts,
              spacing: 'Medium',
            },
          ],
        },
      },
    ],
  }
}
