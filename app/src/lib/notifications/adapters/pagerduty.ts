// ADR-1005 Sprint 6.3 — PagerDuty Events API v2 adapter.
//
// Config shape on notification_channels.config:
//   { routing_key: "<32-char hex integration key>" }
//
// Events API v2 reference:
//   https://developer.pagerduty.com/api-reference/YXBpOjI3NDgyNjU-pager-duty-v2-events-api
//
// Submission: POST https://events.pagerduty.com/v2/enqueue with:
//   {
//     routing_key, event_action: "trigger" | "acknowledge" | "resolve",
//     dedup_key?: <string>,
//     payload: { summary, source, severity, component?, group?, class?, custom_details? }
//   }
//
// Success: 202 Accepted with { status: "success", message, dedup_key }.
//   We capture dedup_key as `external_id` for the DeliveryResult so
//   downstream "acknowledge" / "resolve" events can target the same
//   incident without the DB.
//
// Retry classification:
//   * 202 → success.
//   * 429 → retryable (rate-limited).
//   * 5xx → retryable.
//   * 400 / 401 / 403 → non-retryable (bad key, malformed payload).

import { postJson } from './http'
import type {
  DeliveryResult,
  NotificationAdapter,
  NotificationChannel,
  NotificationEvent,
} from './types'
import { AdapterConfigError } from './types'

const PAGERDUTY_ENQUEUE_URL = 'https://events.pagerduty.com/v2/enqueue'
const ROUTING_KEY_PATTERN = /^[A-Za-z0-9]{32}$/

export interface PagerDutyAdapterOptions {
  fetchImpl?: typeof fetch
  timeoutMs?: number
  /** Override the PagerDuty Events API URL for tests. */
  enqueueUrl?: string
}

const SEVERITY_MAP: Record<string, 'info' | 'warning' | 'error' | 'critical'> = {
  info: 'info',
  warning: 'warning',
  // Our 'critical' maps to PD 'critical' — top severity. PD doesn't
  // have 'error' in the outbound direction; it's accepted as an input.
  critical: 'critical',
}

export function createPagerDutyAdapter(
  opts: PagerDutyAdapterOptions = {},
): NotificationAdapter {
  const enqueueUrl = opts.enqueueUrl ?? PAGERDUTY_ENQUEUE_URL

  return {
    type: 'pagerduty',

    validateConfig(channel: NotificationChannel): void {
      const routingKey = channel.config?.routing_key
      if (typeof routingKey !== 'string' || routingKey.length === 0) {
        throw new AdapterConfigError(
          'pagerduty adapter config requires a `routing_key` string field',
          'pagerduty',
          'routing_key',
        )
      }
      if (!ROUTING_KEY_PATTERN.test(routingKey)) {
        throw new AdapterConfigError(
          'pagerduty routing_key must be a 32-character hex integration key',
          'pagerduty',
          'routing_key',
        )
      }
    },

    async deliver(
      channel: NotificationChannel,
      event: NotificationEvent,
    ): Promise<DeliveryResult> {
      const routingKey = channel.config.routing_key as string
      const payload = buildPagerDutyPayload(event, routingKey)

      const outcome = await postJson(enqueueUrl, payload, {
        fetchImpl: opts.fetchImpl,
        timeoutMs: opts.timeoutMs,
      })

      if (outcome.kind === 'network') {
        return {
          ok: false,
          retryable: true,
          error: `pagerduty_network_error: ${outcome.error}`,
          latency_ms: outcome.latency_ms,
        }
      }

      const { result } = outcome
      if (result.ok) {
        // Body shape per PagerDuty docs: { status, message, dedup_key }.
        let dedupKey: string | undefined
        try {
          const parsed = JSON.parse(result.bodyText) as {
            dedup_key?: string
          }
          dedupKey = parsed.dedup_key
        } catch {
          // Ignore — success response without parseable body.
        }
        return {
          ok: true,
          external_id: dedupKey,
          latency_ms: result.latency_ms,
        }
      }

      const isRetryable = result.status === 429 || (result.status >= 500 && result.status < 600)

      return {
        ok: false,
        retryable: isRetryable,
        error: `pagerduty_http_${result.status}: ${result.bodyText.slice(0, 200)}`,
        status_code: result.status,
        latency_ms: result.latency_ms,
      }
    },
  }
}

/**
 * Construct the Events API v2 payload. Exposed for tests to assert shape.
 */
export function buildPagerDutyPayload(
  event: NotificationEvent,
  routingKey: string,
): Record<string, unknown> {
  const pdSeverity = SEVERITY_MAP[event.severity] ?? 'warning'

  return {
    routing_key: routingKey,
    event_action: 'trigger',
    // dedup_key lets PD collapse repeat pages for the same incident. We
    // prefer the explicit idempotency_key on the event; otherwise fall
    // back to a synthetic key that groups by kind + org.
    dedup_key: event.idempotency_key ?? `consentshield:${event.org_id}:${event.kind}`,
    payload: {
      summary: event.subject,
      source: `consentshield/${event.org_id}`,
      severity: pdSeverity,
      component: event.kind,
      group: 'consentshield',
      class: event.kind,
      custom_details: {
        body: event.body,
        kind: event.kind,
        severity_internal: event.severity,
        occurred_at: event.occurred_at,
        org_id: event.org_id,
        ...event.context,
      },
    },
  }
}
