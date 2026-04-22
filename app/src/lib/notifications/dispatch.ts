// ADR-1005 Sprint 6.1 — notification dispatch.
//
// Responsibility:
//   1. Resolve the set of `notification_channels` rows that should receive
//      an event (org_id match + is_active + alert_types ∋ event.kind).
//   2. For each row, look up the adapter in the registry, validate its
//      config, and call deliver() behind the retry helper.
//   3. Aggregate per-channel outcomes into a DispatchReport.
//
// The dispatcher never throws on delivery failure — every failure is
// folded into the report so the caller can write an audit row / surface
// a UI error without try/catch soup. Programmer errors (missing adapter,
// malformed config) DO throw synchronously — those are bugs, not
// runtime failures.

import type { RetryConfig } from './adapters/retry'
import { DEFAULT_RETRY, withRetry, type RetryEnvelope } from './adapters/retry'
import { getAdapter } from './adapters/registry'
import type {
  NotificationChannel,
  NotificationEvent,
} from './adapters/types'
import { AdapterConfigError } from './adapters/types'

export interface ChannelDispatchOutcome {
  channel_id: string
  channel_type: string
  ok: boolean
  external_id?: string
  attempts: number
  total_latency_ms: number
  error?: string
  retryable?: boolean
  config_error?: boolean
}

export interface DispatchReport {
  event_kind: string
  event_severity: string
  org_id: string
  total_channels: number
  succeeded: number
  failed: number
  outcomes: ChannelDispatchOutcome[]
}

export interface DispatchOptions {
  retry?: RetryConfig
}

export async function dispatchEvent(
  event: NotificationEvent,
  channels: NotificationChannel[],
  options: DispatchOptions = {},
): Promise<DispatchReport> {
  const targets = channels.filter(
    (c) => c.is_active && c.org_id === event.org_id && c.alert_types.includes(event.kind),
  )

  const retry = options.retry ?? DEFAULT_RETRY
  const outcomes: ChannelDispatchOutcome[] = []

  for (const channel of targets) {
    outcomes.push(await dispatchOne(channel, event, retry))
  }

  return {
    event_kind: event.kind,
    event_severity: event.severity,
    org_id: event.org_id,
    total_channels: targets.length,
    succeeded: outcomes.filter((o) => o.ok).length,
    failed: outcomes.filter((o) => !o.ok).length,
    outcomes,
  }
}

async function dispatchOne(
  channel: NotificationChannel,
  event: NotificationEvent,
  retry: RetryConfig,
): Promise<ChannelDispatchOutcome> {
  const adapter = getAdapter(channel.channel_type)

  try {
    adapter.validateConfig(channel)
  } catch (e) {
    if (e instanceof AdapterConfigError) {
      return {
        channel_id: channel.id,
        channel_type: channel.channel_type,
        ok: false,
        attempts: 0,
        total_latency_ms: 0,
        error: `config.${e.field}: ${e.message}`,
        retryable: false,
        config_error: true,
      }
    }
    throw e
  }

  const envelope: RetryEnvelope = await withRetry(
    () => adapter.deliver(channel, event),
    retry,
  )

  const totalLatency = envelope.attempts.reduce((sum, a) => sum + a.latency_ms, 0)

  if (envelope.final.ok) {
    return {
      channel_id: channel.id,
      channel_type: channel.channel_type,
      ok: true,
      external_id: envelope.final.external_id,
      attempts: envelope.attempts.length,
      total_latency_ms: totalLatency,
    }
  }

  return {
    channel_id: channel.id,
    channel_type: channel.channel_type,
    ok: false,
    attempts: envelope.attempts.length,
    total_latency_ms: totalLatency,
    error: envelope.final.error,
    retryable: envelope.final.retryable,
  }
}
