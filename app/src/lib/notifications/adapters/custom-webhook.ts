// ADR-1005 Sprint 6.3 — custom webhook adapter.
//
// Config shape on notification_channels.config:
//   { webhook_url: "https://customer.example.com/hooks/consentshield",
//     signing_secret: "<≥32-char random hex, per-channel>" }
//
// The customer hosts the endpoint. ConsentShield posts a canonical
// JSON payload + two headers:
//   * X-ConsentShield-Timestamp: ISO-8601 occurred_at
//   * X-ConsentShield-Signature: hex(HMAC-SHA256(secret, timestamp + "." + body))
//
// The receiver should:
//   1. Reject if the timestamp is older than ±5 minutes (replay window).
//   2. Recompute the HMAC with its stored secret and compare in constant
//      time against the header.
//   3. Respond with 2xx quickly (process async). Retry expectations are
//      documented at docs/customer-integrations/custom-webhook.md (to be
//      authored under ADR-1015).
//
// Retry classification:
//   * 2xx → success.
//   * 408 / 429 / 5xx → retryable.
//   * Other 4xx → non-retryable (signature mismatch, config drift).

import type {
  DeliveryResult,
  NotificationAdapter,
  NotificationChannel,
  NotificationEvent,
} from './types'
import { AdapterConfigError } from './types'

export interface CustomWebhookAdapterOptions {
  fetchImpl?: typeof fetch
  timeoutMs?: number
  /**
   * HMAC implementation override. Defaults to Node's crypto.subtle.
   * Exposed so Edge-runtime callers can inject WebCrypto's SubtleCrypto.
   */
  hmacHex?: (secret: string, message: string) => Promise<string>
}

const MIN_SIGNING_SECRET_LEN = 32

export function createCustomWebhookAdapter(
  opts: CustomWebhookAdapterOptions = {},
): NotificationAdapter {
  const hmac = opts.hmacHex ?? defaultHmacHex

  return {
    type: 'custom_webhook',

    validateConfig(channel: NotificationChannel): void {
      const webhook = channel.config?.webhook_url
      const secret = channel.config?.signing_secret

      if (typeof webhook !== 'string' || webhook.length === 0) {
        throw new AdapterConfigError(
          'custom_webhook adapter config requires a `webhook_url` string field',
          'custom_webhook',
          'webhook_url',
        )
      }
      let parsed: URL
      try {
        parsed = new URL(webhook)
      } catch {
        throw new AdapterConfigError(
          'custom_webhook webhook_url is not a valid URL',
          'custom_webhook',
          'webhook_url',
        )
      }
      if (parsed.protocol !== 'https:') {
        throw new AdapterConfigError(
          'custom_webhook webhook_url must be https',
          'custom_webhook',
          'webhook_url',
        )
      }
      if (typeof secret !== 'string' || secret.length < MIN_SIGNING_SECRET_LEN) {
        throw new AdapterConfigError(
          `custom_webhook signing_secret must be a string of at least ${MIN_SIGNING_SECRET_LEN} chars`,
          'custom_webhook',
          'signing_secret',
        )
      }
    },

    async deliver(
      channel: NotificationChannel,
      event: NotificationEvent,
    ): Promise<DeliveryResult> {
      const webhookUrl = channel.config.webhook_url as string
      const secret = channel.config.signing_secret as string
      const payload = buildCustomWebhookPayload(event)
      const bodyJson = JSON.stringify(payload)
      const signature = await hmac(secret, `${event.occurred_at}.${bodyJson}`)

      // We cannot reuse postJson's built-in JSON.stringify because we
      // need the exact bytes that were signed. Keep it inline.
      const fetchImpl = opts.fetchImpl ?? globalThis.fetch
      const timeoutMs = opts.timeoutMs ?? 10_000
      const start = Date.now()
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), timeoutMs)

      try {
        const res = await fetchImpl(webhookUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-ConsentShield-Timestamp': event.occurred_at,
            'X-ConsentShield-Signature': signature,
          },
          body: bodyJson,
          signal: controller.signal,
        })
        const latency_ms = Date.now() - start
        if (res.ok) return { ok: true, latency_ms }
        const text = await res.text().catch(() => '')
        const retryable =
          res.status === 408 || res.status === 429 || (res.status >= 500 && res.status < 600)
        return {
          ok: false,
          retryable,
          error: `custom_webhook_http_${res.status}: ${text.slice(0, 200)}`,
          status_code: res.status,
          latency_ms,
        }
      } catch (e) {
        const err = e as Error
        return {
          ok: false,
          retryable: true,
          error: `custom_webhook_network_error: ${err.name === 'AbortError' ? `timeout after ${timeoutMs}ms` : err.message}`,
          latency_ms: Date.now() - start,
        }
      } finally {
        clearTimeout(timer)
      }
    },
  }
}

/**
 * Canonical payload the customer endpoint receives. Stable shape — new
 * fields are additive; renaming is a breaking change requiring an ADR.
 */
export function buildCustomWebhookPayload(event: NotificationEvent): Record<string, unknown> {
  return {
    version: 1,
    kind: event.kind,
    severity: event.severity,
    subject: event.subject,
    body: event.body,
    occurred_at: event.occurred_at,
    org_id: event.org_id,
    idempotency_key: event.idempotency_key ?? null,
    context: event.context,
  }
}

async function defaultHmacHex(secret: string, message: string): Promise<string> {
  const enc = new TextEncoder()
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(message))
  return Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}
