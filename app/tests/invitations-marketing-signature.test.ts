import { describe, expect, it } from 'vitest'
import { signPayload, verifyPayload } from '../src/lib/invitations/marketing-signature'

// ADR-0044 Phase 2.6 — HMAC sign/verify for /api/internal/invites.

const SECRET = 'test-secret-please-ignore'
const BODY = JSON.stringify({ email: 'founder@acme.in', plan_code: 'growth' })

describe('marketing signature', () => {
  it('sign → verify round-trip with the same secret and body', () => {
    const { timestamp, signature } = signPayload(BODY, SECRET)
    const verdict = verifyPayload(BODY, SECRET, { timestamp, signature })
    expect(verdict).toEqual({ ok: true })
  })

  it('tampered body fails', () => {
    const { timestamp, signature } = signPayload(BODY, SECRET)
    const verdict = verifyPayload(BODY + '  ', SECRET, { timestamp, signature })
    expect(verdict).toEqual({ ok: false, reason: 'bad_signature' })
  })

  it('wrong secret fails', () => {
    const { timestamp, signature } = signPayload(BODY, SECRET)
    const verdict = verifyPayload(BODY, 'different-secret', { timestamp, signature })
    expect(verdict).toEqual({ ok: false, reason: 'bad_signature' })
  })

  it('missing headers returns missing_headers', () => {
    expect(verifyPayload(BODY, SECRET, { timestamp: null, signature: null }).ok).toBe(false)
    expect(
      verifyPayload(BODY, SECRET, {
        timestamp: '1700000000',
        signature: null,
      }),
    ).toEqual({ ok: false, reason: 'missing_headers' })
  })

  it('stale timestamp (> 5 min old) rejected', () => {
    const now = Date.now()
    const { timestamp, signature } = signPayload(BODY, SECRET, now - 10 * 60 * 1000)
    const verdict = verifyPayload(BODY, SECRET, { timestamp, signature }, now)
    expect(verdict).toEqual({ ok: false, reason: 'stale' })
  })

  it('future-drift timestamp (> 5 min ahead) rejected', () => {
    const now = Date.now()
    const { timestamp, signature } = signPayload(BODY, SECRET, now + 10 * 60 * 1000)
    const verdict = verifyPayload(BODY, SECRET, { timestamp, signature }, now)
    expect(verdict).toEqual({ ok: false, reason: 'stale' })
  })

  it('non-numeric timestamp rejected as missing', () => {
    const { signature } = signPayload(BODY, SECRET)
    expect(
      verifyPayload(BODY, SECRET, { timestamp: 'not-a-number', signature }),
    ).toEqual({ ok: false, reason: 'missing_headers' })
  })

  it('signature with different length rejected without timingSafeEqual crash', () => {
    const { timestamp } = signPayload(BODY, SECRET)
    expect(
      verifyPayload(BODY, SECRET, { timestamp, signature: 'tooshort' }),
    ).toEqual({ ok: false, reason: 'bad_signature' })
  })
})
