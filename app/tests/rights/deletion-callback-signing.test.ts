// ADR-1014 Phase 3 Sprint 3.4 — deletion-receipt callback signature verifier.
//
// Unit tests for `app/src/lib/rights/callback-signing.ts` — the HMAC-SHA256
// helper that guards `/api/v1/deletion-receipts/[id]` against unsigned or
// tampered callbacks. Route handler rejects with 403 unless this helper
// returns true; this file is the proof that tampered / absent / short /
// long / wrong-secret signatures all return false.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createHmac } from 'node:crypto'

describe('callback-signing — signCallback / verifyCallback', () => {
  const SECRET = 'test-secret-' + 'a'.repeat(40)

  beforeEach(() => {
    vi.stubEnv('DELETION_CALLBACK_SECRET', SECRET)
    vi.resetModules()
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    vi.restoreAllMocks()
  })

  async function load() {
    return (await import('@/lib/rights/callback-signing')) as typeof import('@/lib/rights/callback-signing')
  }

  it('signCallback — HMAC-SHA256(receipt_id, secret) as lowercase hex, 64 chars', async () => {
    const { signCallback } = await load()
    const id = 'abcd1234-5678-90ab-cdef-1234567890ab'
    const sig = signCallback(id)
    expect(sig).toMatch(/^[0-9a-f]{64}$/)

    // Matches the Node crypto reference implementation.
    const expected = createHmac('sha256', SECRET).update(id).digest('hex')
    expect(sig).toBe(expected)
  })

  it('signCallback — two calls with same input produce identical output (deterministic)', async () => {
    const { signCallback } = await load()
    const id = 'deadbeef-0000-0000-0000-000000000001'
    expect(signCallback(id)).toBe(signCallback(id))
  })

  it('signCallback — different ids produce different signatures', async () => {
    const { signCallback } = await load()
    const a = signCallback('id-one')
    const b = signCallback('id-two')
    expect(a).not.toBe(b)
  })

  it('signCallback — throws when DELETION_CALLBACK_SECRET is missing', async () => {
    vi.stubEnv('DELETION_CALLBACK_SECRET', '')
    vi.resetModules()
    const { signCallback } = await load()
    expect(() => signCallback('some-id')).toThrow(
      /DELETION_CALLBACK_SECRET must be set/,
    )
  })

  it('verifyCallback — correct signature returns true', async () => {
    const { signCallback, verifyCallback } = await load()
    const id = 'valid-receipt-id'
    expect(verifyCallback(id, signCallback(id))).toBe(true)
  })

  it('verifyCallback — tampered signature returns false (one hex char flipped)', async () => {
    const { signCallback, verifyCallback } = await load()
    const id = 'tamper-test-id'
    const good = signCallback(id)
    // Flip first char — deterministic + always produces a different sig.
    const tampered =
      (good[0] === 'a' ? 'b' : 'a') + good.slice(1)
    expect(tampered).not.toBe(good)
    expect(verifyCallback(id, tampered)).toBe(false)
  })

  it('verifyCallback — wrong length signature returns false (short)', async () => {
    const { verifyCallback } = await load()
    expect(verifyCallback('receipt', 'abc123')).toBe(false)
  })

  it('verifyCallback — wrong length signature returns false (long, even if prefix matches)', async () => {
    const { signCallback, verifyCallback } = await load()
    const id = 'long-sig-test'
    const good = signCallback(id)
    const longer = good + 'ff'
    expect(verifyCallback(id, longer)).toBe(false)
  })

  it('verifyCallback — empty signature returns false', async () => {
    const { verifyCallback } = await load()
    expect(verifyCallback('receipt-id', '')).toBe(false)
  })

  it('verifyCallback — wrong receipt_id returns false (signed for a different id)', async () => {
    const { signCallback, verifyCallback } = await load()
    const signedForA = signCallback('receipt-A')
    expect(verifyCallback('receipt-B', signedForA)).toBe(false)
  })

  it('verifyCallback — missing DELETION_CALLBACK_SECRET returns false (no throw)', async () => {
    vi.stubEnv('DELETION_CALLBACK_SECRET', '')
    vi.resetModules()
    const { verifyCallback } = await load()
    // Any signature should fail fast when the server has no secret to
    // compare against. The verifier must NOT treat missing secret as
    // "skip auth" — it must return false.
    expect(verifyCallback('some-id', 'ff'.repeat(32))).toBe(false)
  })

  it('verifyCallback — different secret on the receiver rejects signatures from the original secret', async () => {
    // Sign with secret A, verify with secret B. Must return false. This
    // protects against a key-rotation scenario where the sender's secret
    // falls out of sync with the receiver's.
    vi.stubEnv('DELETION_CALLBACK_SECRET', 'secret-A')
    vi.resetModules()
    const { signCallback } = await load()
    const sig = signCallback('rotation-test')

    vi.stubEnv('DELETION_CALLBACK_SECRET', 'secret-B')
    vi.resetModules()
    const { verifyCallback } = await load()
    expect(verifyCallback('rotation-test', sig)).toBe(false)
  })

  it('buildCallbackUrl — embeds receipt id + HMAC sig in querystring', async () => {
    vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://app.example.invalid')
    vi.resetModules()
    const { buildCallbackUrl, signCallback } = await load()
    const id = '99999999-8888-7777-6666-555555555555'
    const url = buildCallbackUrl(id)
    expect(url).toBe(
      `https://app.example.invalid/api/v1/deletion-receipts/${id}?sig=${signCallback(id)}`,
    )
  })

  it('buildCallbackUrl — explicit appUrl arg overrides env', async () => {
    vi.resetModules()
    const { buildCallbackUrl, signCallback } = await load()
    const id = 'test-id'
    const url = buildCallbackUrl(id, 'https://custom.example.invalid')
    expect(url).toBe(
      `https://custom.example.invalid/api/v1/deletion-receipts/${id}?sig=${signCallback(id)}`,
    )
  })
})
