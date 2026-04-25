import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { hmacSHA256, verifyHMAC, isTimestampValid, sha256 } from '../src/hmac'

const ORG = '11111111-1111-1111-1111-111111111111'
const PROP = '22222222-2222-2222-2222-222222222222'
const SECRET = 'super-secret-signing-key-for-tests'

async function sign(orgId: string, propertyId: string, ts: string, secret: string) {
  return hmacSHA256(`${orgId}${propertyId}${ts}`, secret)
}

describe('hmacSHA256', () => {
  it('produces a 64-char lowercase hex digest', async () => {
    const sig = await hmacSHA256('hello', SECRET)
    expect(sig).toMatch(/^[0-9a-f]{64}$/)
    expect(sig.length).toBe(64)
  })

  it('is deterministic for the same (message, secret)', async () => {
    const a = await hmacSHA256('payload', SECRET)
    const b = await hmacSHA256('payload', SECRET)
    expect(a).toBe(b)
  })

  it('produces different digests when the message changes by a single byte', async () => {
    const a = await hmacSHA256('payload', SECRET)
    const b = await hmacSHA256('payloaD', SECRET)
    expect(a).not.toBe(b)
  })

  it('produces different digests when the secret changes by a single byte', async () => {
    const a = await hmacSHA256('payload', 'secret-a')
    const b = await hmacSHA256('payload', 'secret-b')
    expect(a).not.toBe(b)
  })

  it('matches a known RFC 4231 test vector (Test Case 1: key=0x0b*20, data="Hi There")', async () => {
    const key = String.fromCharCode(...new Array(20).fill(0x0b))
    const sig = await hmacSHA256('Hi There', key)
    expect(sig).toBe('b0344c61d8db38535ca8afceaf0bf12b881dc200c9833da726e9376c2e32cff7')
  })
})

describe('sha256', () => {
  it('matches the known empty-string digest', async () => {
    expect(await sha256('')).toBe(
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    )
  })

  it('matches the known "abc" digest', async () => {
    expect(await sha256('abc')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    )
  })

  it('produces 64-char lowercase hex', async () => {
    const h = await sha256('any input')
    expect(h).toMatch(/^[0-9a-f]{64}$/)
  })
})

describe('verifyHMAC — positive', () => {
  it('returns true for a signature produced from the same (org, prop, ts, secret)', async () => {
    const ts = String(Date.now())
    const sig = await sign(ORG, PROP, ts, SECRET)
    expect(await verifyHMAC(ORG, PROP, ts, sig, SECRET)).toBe(true)
  })

  it('verifies signatures across many different timestamps', async () => {
    for (let i = 0; i < 5; i++) {
      const ts = String(Date.now() + i)
      const sig = await sign(ORG, PROP, ts, SECRET)
      expect(await verifyHMAC(ORG, PROP, ts, sig, SECRET)).toBe(true)
    }
  })
})

describe('verifyHMAC — negative (defends against the "always-true" mutation class)', () => {
  it('rejects when the signature length differs (returns false, does not throw)', async () => {
    const ts = String(Date.now())
    expect(await verifyHMAC(ORG, PROP, ts, 'short', SECRET)).toBe(false)
    expect(await verifyHMAC(ORG, PROP, ts, '', SECRET)).toBe(false)
  })

  it('rejects when a single signature byte is flipped (low nibble)', async () => {
    const ts = String(Date.now())
    const sig = await sign(ORG, PROP, ts, SECRET)
    // Flip the last hex char so length stays equal but content differs.
    const tampered = sig.slice(0, -1) + (sig.endsWith('0') ? '1' : '0')
    expect(await verifyHMAC(ORG, PROP, ts, tampered, SECRET)).toBe(false)
  })

  it('rejects when a single signature byte is flipped (high nibble)', async () => {
    const ts = String(Date.now())
    const sig = await sign(ORG, PROP, ts, SECRET)
    const head = sig.slice(0, 1)
    const newHead = head === 'a' ? 'b' : 'a'
    const tampered = newHead + sig.slice(1)
    expect(await verifyHMAC(ORG, PROP, ts, tampered, SECRET)).toBe(false)
  })

  it('rejects when org_id is wrong', async () => {
    const ts = String(Date.now())
    const sig = await sign(ORG, PROP, ts, SECRET)
    const otherOrg = '99999999-9999-9999-9999-999999999999'
    expect(await verifyHMAC(otherOrg, PROP, ts, sig, SECRET)).toBe(false)
  })

  it('rejects when property_id is wrong', async () => {
    const ts = String(Date.now())
    const sig = await sign(ORG, PROP, ts, SECRET)
    const otherProp = '99999999-9999-9999-9999-999999999999'
    expect(await verifyHMAC(ORG, otherProp, ts, sig, SECRET)).toBe(false)
  })

  it('rejects when timestamp is wrong', async () => {
    const ts = String(Date.now())
    const sig = await sign(ORG, PROP, ts, SECRET)
    const otherTs = String(Number(ts) + 1)
    expect(await verifyHMAC(ORG, PROP, otherTs, sig, SECRET)).toBe(false)
  })

  it('rejects when the secret is wrong', async () => {
    const ts = String(Date.now())
    const sig = await sign(ORG, PROP, ts, SECRET)
    expect(await verifyHMAC(ORG, PROP, ts, sig, 'a-different-secret')).toBe(false)
  })

  it('rejects an empty signature', async () => {
    expect(await verifyHMAC(ORG, PROP, '0', '', SECRET)).toBe(false)
  })

  it('does not match the all-zero signature', async () => {
    expect(await verifyHMAC(ORG, PROP, '0', '0'.repeat(64), SECRET)).toBe(false)
  })

  it('rejects an oversized signature even when its 64-char prefix matches the expected digest', async () => {
    // Defends against a mutant that drops the length-equality guard in the
    // timing-safe comparison. Without that guard, an attacker who learns a
    // valid signature could append arbitrary bytes and still verify, because
    // the loop only iterates up to a.length (64) and never inspects the
    // trailing bytes. This is a real auth-bypass mutation — must die.
    const ts = String(Date.now())
    const sig = await sign(ORG, PROP, ts, SECRET)
    expect(await verifyHMAC(ORG, PROP, ts, sig + 'AAAA', SECRET)).toBe(false)
    expect(await verifyHMAC(ORG, PROP, ts, sig + '0'.repeat(64), SECRET)).toBe(false)
  })

  it('treats org/property as a single concatenated message — boundary is order-sensitive', async () => {
    const ts = String(Date.now())
    const sigForOrgProp = await sign(ORG, PROP, ts, SECRET)
    // If the implementation accidentally swapped order the sig would still verify; this
    // catches a mutant that reorders concatenation.
    expect(await verifyHMAC(PROP, ORG, ts, sigForOrgProp, SECRET)).toBe(false)
  })
})

describe('isTimestampValid — window boundary', () => {
  const NOW = 1_700_000_000_000

  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(NOW)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('accepts the exact current timestamp', () => {
    expect(isTimestampValid(String(NOW))).toBe(true)
  })

  it('accepts a timestamp exactly at the +window boundary (5 min default)', () => {
    expect(isTimestampValid(String(NOW + 5 * 60 * 1000))).toBe(true)
  })

  it('accepts a timestamp exactly at the -window boundary (5 min default)', () => {
    expect(isTimestampValid(String(NOW - 5 * 60 * 1000))).toBe(true)
  })

  it('rejects a timestamp 1 ms past the +window', () => {
    expect(isTimestampValid(String(NOW + 5 * 60 * 1000 + 1))).toBe(false)
  })

  it('rejects a timestamp 1 ms past the -window', () => {
    expect(isTimestampValid(String(NOW - 5 * 60 * 1000 - 1))).toBe(false)
  })

  it('rejects a timestamp far in the future (1 hour)', () => {
    expect(isTimestampValid(String(NOW + 60 * 60 * 1000))).toBe(false)
  })

  it('rejects a timestamp far in the past (1 hour)', () => {
    expect(isTimestampValid(String(NOW - 60 * 60 * 1000))).toBe(false)
  })

  it('rejects non-numeric input', () => {
    expect(isTimestampValid('not-a-number')).toBe(false)
    expect(isTimestampValid('')).toBe(false)
    expect(isTimestampValid('NaN')).toBe(false)
  })

  it('respects a custom window argument (1 second)', () => {
    expect(isTimestampValid(String(NOW + 999), 1000)).toBe(true)
    expect(isTimestampValid(String(NOW + 1001), 1000)).toBe(false)
  })

  it('uses absolute distance — a one-second window rejects -1001 ms too', () => {
    expect(isTimestampValid(String(NOW - 999), 1000)).toBe(true)
    expect(isTimestampValid(String(NOW - 1001), 1000)).toBe(false)
  })
})
