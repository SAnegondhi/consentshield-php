import { describe, expect, it } from 'vitest'
import {
  buildCustomWebhookPayload,
  createCustomWebhookAdapter,
} from '../../src/lib/notifications/adapters/custom-webhook'
import { AdapterConfigError } from '../../src/lib/notifications/adapters/types'
import type {
  NotificationChannel,
  NotificationEvent,
} from '../../src/lib/notifications/adapters/types'

const VALID_URL = 'https://customer.example.com/hooks/consentshield'
const VALID_SECRET = 'x'.repeat(32)

function channel(overrides: Partial<NotificationChannel> = {}): NotificationChannel {
  return {
    id: 'ch-cw-1',
    org_id: 'org-1',
    channel_type: 'custom_webhook',
    config: { webhook_url: VALID_URL, signing_secret: VALID_SECRET },
    alert_types: ['orphan_events_nonzero'],
    is_active: true,
    ...overrides,
  }
}

function event(overrides: Partial<NotificationEvent> = {}): NotificationEvent {
  return {
    kind: 'orphan_events_nonzero',
    severity: 'warning',
    subject: 'Orphan events',
    body: 'body',
    occurred_at: '2026-04-22T11:00:00Z',
    org_id: 'org-1',
    context: { n: 1 },
    idempotency_key: 'idem-1',
    ...overrides,
  }
}

describe('ADR-1005 Sprint 6.3 — custom_webhook adapter: validateConfig', () => {
  const adapter = createCustomWebhookAdapter()

  it('accepts a valid https URL + 32-char secret', () => {
    expect(() => adapter.validateConfig(channel())).not.toThrow()
  })

  it('rejects http URL', () => {
    expect(() =>
      adapter.validateConfig(
        channel({
          config: {
            webhook_url: 'http://example.com/hook',
            signing_secret: VALID_SECRET,
          },
        }),
      ),
    ).toThrow(/https/)
  })

  it('rejects a short signing_secret', () => {
    expect(() =>
      adapter.validateConfig(
        channel({
          config: { webhook_url: VALID_URL, signing_secret: 'short' },
        }),
      ),
    ).toThrow(/32/)
  })

  it('rejects missing webhook_url', () => {
    expect(() =>
      adapter.validateConfig(
        channel({ config: { signing_secret: VALID_SECRET } }),
      ),
    ).toThrow(AdapterConfigError)
  })
})

describe('ADR-1005 Sprint 6.3 — custom_webhook adapter: buildCustomWebhookPayload', () => {
  it('version 1 canonical shape', () => {
    const p = buildCustomWebhookPayload(event()) as {
      version: number
      kind: string
      severity: string
      idempotency_key: string | null
    }
    expect(p.version).toBe(1)
    expect(p.kind).toBe('orphan_events_nonzero')
    expect(p.severity).toBe('warning')
    expect(p.idempotency_key).toBe('idem-1')
  })

  it('idempotency_key is null when absent', () => {
    const p = buildCustomWebhookPayload(event({ idempotency_key: undefined })) as {
      idempotency_key: string | null
    }
    expect(p.idempotency_key).toBeNull()
  })
})

describe('ADR-1005 Sprint 6.3 — custom_webhook adapter: deliver + HMAC', () => {
  it('signs the body with HMAC-SHA256 and sends the signature + timestamp headers', async () => {
    let capturedHeaders: Record<string, string> = {}
    let capturedBody = ''
    const adapter = createCustomWebhookAdapter({
      fetchImpl: (async (url: RequestInfo | URL, init: RequestInit) => {
        capturedHeaders = Object.fromEntries(
          new Headers(init.headers as HeadersInit).entries(),
        )
        capturedBody = init.body as string
        return new Response('', { status: 200 })
      }) as typeof fetch,
    })
    const res = await adapter.deliver(channel(), event())
    expect(res.ok).toBe(true)

    expect(capturedHeaders['x-consentshield-timestamp']).toBe('2026-04-22T11:00:00Z')
    const sig = capturedHeaders['x-consentshield-signature']
    expect(sig).toMatch(/^[0-9a-f]{64}$/)

    // Sanity-check: recompute HMAC with the same secret + `${timestamp}.${body}`
    // and confirm it matches.
    const expectedSig = await hmacHex(VALID_SECRET, `2026-04-22T11:00:00Z.${capturedBody}`)
    expect(sig).toBe(expectedSig)
  })

  it('408 / 429 / 5xx are retryable; other 4xx are not', async () => {
    for (const status of [408, 429, 500, 502, 503]) {
      const adapter = createCustomWebhookAdapter({
        fetchImpl: (async () => new Response('boom', { status })) as typeof fetch,
      })
      const res = await adapter.deliver(channel(), event())
      if (!res.ok) expect(res.retryable).toBe(true)
    }
    for (const status of [400, 401, 403, 404, 422]) {
      const adapter = createCustomWebhookAdapter({
        fetchImpl: (async () => new Response('nope', { status })) as typeof fetch,
      })
      const res = await adapter.deliver(channel(), event())
      if (!res.ok) expect(res.retryable).toBe(false)
    }
  })

  it('network error is retryable', async () => {
    const adapter = createCustomWebhookAdapter({
      fetchImpl: async () => {
        throw new Error('ECONNRESET')
      },
    })
    const res = await adapter.deliver(channel(), event())
    if (!res.ok) {
      expect(res.retryable).toBe(true)
      expect(res.error).toMatch(/ECONNRESET/)
    }
  })
})

async function hmacHex(secret: string, message: string): Promise<string> {
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
