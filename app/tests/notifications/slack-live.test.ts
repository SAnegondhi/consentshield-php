import { describe, expect, it } from 'vitest'
import { createSlackAdapter } from '../../src/lib/notifications/adapters/slack'
import type {
  NotificationChannel,
  NotificationEvent,
} from '../../src/lib/notifications/adapters/types'

// ADR-1005 Sprint 6.2 — live Slack delivery test.
//
// Exercises the Slack adapter end-to-end against a real Incoming Webhook
// URL. Skips when SLACK_WEBHOOK_URL is not set so CI + non-credentialled
// runs stay green.
//
// The test posts ONE message per run. Inspect the #consentshield-alerts
// channel (or whichever channel the webhook targets) to confirm the
// Block Kit render looks right.

const WEBHOOK = process.env.SLACK_WEBHOOK_URL
const skipSuite = WEBHOOK ? describe : describe.skip

skipSuite('ADR-1005 Sprint 6.2 — slack adapter LIVE delivery', () => {
  it('POSTs a Block Kit message and gets ok=true', async () => {
    const adapter = createSlackAdapter()
    const channel: NotificationChannel = {
      id: 'live-slack',
      org_id: 'live-smoke-org',
      channel_type: 'slack',
      config: { webhook_url: WEBHOOK! },
      alert_types: ['phase6_smoke'],
      is_active: true,
    }
    const event: NotificationEvent = {
      kind: 'phase6_smoke',
      severity: 'info',
      subject: 'ConsentShield ADR-1005 Phase 6 Sprint 6.2 — live smoke',
      body:
        'If you can see this in Slack, the adapter + NotificationEvent '
        + 'envelope + Block Kit rendering all work end-to-end.',
      occurred_at: new Date().toISOString(),
      org_id: 'live-smoke-org',
      context: {
        sprint: '6.2',
        adapters_tested: ['slack', 'teams', 'discord', 'pagerduty', 'custom_webhook'],
      },
      idempotency_key: `phase6-smoke-${Date.now()}`,
    }
    const res = await adapter.deliver(channel, event)
    expect(res.ok).toBe(true)
    if (res.ok) {
      expect(res.latency_ms).toBeGreaterThan(0)
    }
  }, 15_000)
})
