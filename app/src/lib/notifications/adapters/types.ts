// ADR-1005 Sprint 6.1 — NotificationAdapter interface.
//
// Every non-email delivery channel (Slack, Teams, Discord, PagerDuty,
// custom webhook) implements this shape. Email stays on Resend and does
// not go through the adapter pipeline.
//
// The v1 interface is deliberately minimal:
//   * One method: `deliver(channel, event)`.
//   * Transport error taxonomy is { retryable, non-retryable } — per-adapter
//     mapping decides which HTTP statuses go in which bucket.
//   * No channel-specific formatting API: each adapter renders its own
//     markup from the common NotificationEvent envelope.
//
// Adapters are registered by `channel_type` (see registry.ts). The
// dispatcher (dispatch.ts) pulls rows from `notification_channels`, routes
// each row to the adapter whose type matches, wraps calls with retry.ts.

/**
 * The channel row shape as it lives on `public.notification_channels`.
 * `config` varies by adapter — Slack stores `{ webhook_url }`, PagerDuty
 * stores `{ routing_key }`, etc. Per-adapter config shape is validated
 * by the adapter itself.
 */
export interface NotificationChannel {
  id: string
  org_id: string
  channel_type: ChannelType
  config: Record<string, unknown>
  alert_types: string[]
  is_active: boolean
}

/**
 * Every channel type the system knows about. Adding a new one is a
 * type-level addition + a registry entry; the dispatcher picks it up
 * automatically via the registry.
 */
export type ChannelType =
  | 'slack'
  | 'teams'
  | 'discord'
  | 'pagerduty'
  | 'custom_webhook'
  | 'mock' // tests only — the `registry` exposes it only when NODE_ENV=test.

/**
 * Common event envelope — every adapter sees the same shape. Per-event
 * payload goes in `context` and is serialised verbatim into the channel's
 * native format (Slack blocks / Teams adaptive card / PagerDuty custom_details).
 *
 * `kind` is the alert type (e.g. 'orphan_events_nonzero', 'deletion_sla_overdue');
 *   must match a value in `notification_channels.alert_types` for a row to be
 *   considered a delivery target for this event.
 *
 * `severity` drives routing priority + native visual emphasis — PagerDuty
 *   maps this to its own levels; Slack/Teams prefix with coloured badges.
 *
 * `idempotency_key` is optional but strongly recommended — PagerDuty uses
 *   it as dedup_key; custom_webhook signs it into the body.
 */
export interface NotificationEvent {
  kind: string
  severity: Severity
  subject: string
  body: string
  occurred_at: string
  org_id: string
  context: Record<string, unknown>
  idempotency_key?: string
}

export type Severity = 'info' | 'warning' | 'critical'

/**
 * Per-delivery outcome envelope. `ok=true` carries the adapter's
 * external_id (Slack ts, PagerDuty dedup_key, webhook response-id) if the
 * remote returned one. `ok=false` carries the retryable flag so the retry
 * helper can decide whether to back off or give up.
 */
export type DeliveryResult =
  | { ok: true; external_id?: string; latency_ms: number }
  | {
      ok: false
      retryable: boolean
      error: string
      status_code?: number
      latency_ms: number
    }

/**
 * The adapter shape. Implementations are pure: no DB writes, no logging.
 * Callers (dispatch.ts) persist the outcome.
 */
export interface NotificationAdapter {
  readonly type: ChannelType

  /**
   * Validate that `channel.config` has the fields this adapter needs.
   * Throws `AdapterConfigError` synchronously — never swallow validation
   * into a DeliveryResult so config mistakes surface loudly at test-send
   * time rather than at the next incident.
   */
  validateConfig(channel: NotificationChannel): void

  /**
   * Deliver the event to the channel. Network errors / non-2xx responses
   * MUST return `ok: false` with an accurate `retryable` flag — throwing
   * is reserved for programmer errors (bad config, missing registry entry).
   */
  deliver(channel: NotificationChannel, event: NotificationEvent): Promise<DeliveryResult>
}

/**
 * Thrown by `adapter.validateConfig` when the row's `config` jsonb is
 * missing a required field or has a wrong type. Surfaces to the UI as a
 * configuration error (HTTP 400) rather than a retryable delivery failure.
 */
export class AdapterConfigError extends Error {
  constructor(
    message: string,
    public readonly channelType: ChannelType,
    public readonly field: string,
  ) {
    super(message)
    this.name = 'AdapterConfigError'
  }
}

/**
 * Thrown by the registry when no adapter is registered for a channel_type.
 * This is a programmer error — either the adapter wasn't registered on
 * boot or the DB has a channel row the code doesn't understand yet.
 */
export class UnknownAdapterError extends Error {
  constructor(public readonly channelType: string) {
    super(`No adapter registered for channel_type=${channelType}`)
    this.name = 'UnknownAdapterError'
  }
}
