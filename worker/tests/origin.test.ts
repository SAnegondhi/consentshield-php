import { describe, it, expect } from 'vitest'
import { validateOrigin, rejectOrigin } from '../src/origin'

function reqWithOrigin(origin: string | null, referer?: string | null): Request {
  const headers = new Headers()
  if (origin !== null) headers.set('Origin', origin)
  if (referer) headers.set('Referer', referer)
  return new Request('https://worker.example/v1/events', { method: 'POST', headers })
}

describe('validateOrigin — happy path', () => {
  it('accepts an exact origin match', () => {
    const r = reqWithOrigin('https://shop.example.com')
    expect(validateOrigin(r, ['https://shop.example.com'])).toEqual({
      status: 'valid',
      origin: 'https://shop.example.com',
    })
  })

  it('accepts when one of multiple allowed origins matches', () => {
    const r = reqWithOrigin('https://b.example.com')
    expect(
      validateOrigin(r, ['https://a.example.com', 'https://b.example.com', 'https://c.example.com']),
    ).toEqual({ status: 'valid', origin: 'https://b.example.com' })
  })

  it('falls back to Referer when Origin header is missing', () => {
    const r = reqWithOrigin(null, 'https://shop.example.com/checkout?utm=x')
    const result = validateOrigin(r, ['https://shop.example.com'])
    expect(result.status).toBe('valid')
    if (result.status === 'valid') {
      expect(result.origin).toBe('https://shop.example.com')
    }
  })

  it('normalises Referer to its origin component (path/query stripped)', () => {
    const r = reqWithOrigin(null, 'https://shop.example.com/a/b/c?q=1#frag')
    const result = validateOrigin(r, ['https://shop.example.com'])
    expect(result.status).toBe('valid')
  })
})

describe('validateOrigin — unverified', () => {
  it('returns unverified when neither Origin nor Referer is present', () => {
    const r = reqWithOrigin(null)
    expect(validateOrigin(r, ['https://shop.example.com'])).toEqual({ status: 'unverified' })
  })
})

describe('validateOrigin — rejected', () => {
  it('rejects when allowed_origins is empty (auth boundary, post-banner-secret-removal)', () => {
    const r = reqWithOrigin('https://shop.example.com')
    expect(validateOrigin(r, [])).toEqual({
      status: 'rejected',
      origin: 'https://shop.example.com',
    })
  })

  it('rejects when origin is not in the list', () => {
    const r = reqWithOrigin('https://evil.example.com')
    expect(validateOrigin(r, ['https://shop.example.com'])).toEqual({
      status: 'rejected',
      origin: 'https://evil.example.com',
    })
  })

  it('rejects on scheme mismatch (http vs https)', () => {
    const r = reqWithOrigin('http://shop.example.com')
    expect(validateOrigin(r, ['https://shop.example.com'])).toEqual({
      status: 'rejected',
      origin: 'http://shop.example.com',
    })
  })

  it('rejects on subdomain mismatch (no wildcard support)', () => {
    const r = reqWithOrigin('https://www.shop.example.com')
    expect(validateOrigin(r, ['https://shop.example.com'])).toEqual({
      status: 'rejected',
      origin: 'https://www.shop.example.com',
    })
  })

  it('rejects on port mismatch (explicit port differs from default)', () => {
    // URL.origin includes :port when non-default. https default is 443 → omitted.
    const r = reqWithOrigin('https://shop.example.com:8443')
    expect(validateOrigin(r, ['https://shop.example.com'])).toEqual({
      status: 'rejected',
      origin: 'https://shop.example.com:8443',
    })
  })

  it('rejects null-origin requests (Origin header literally "null")', () => {
    const r = reqWithOrigin('null')
    // "null" is not a valid URL so the catch branch falls through with originHost="null"
    expect(validateOrigin(r, ['https://shop.example.com'])).toEqual({
      status: 'rejected',
      origin: 'null',
    })
  })

  it('does not match when allowed list contains a substring of the origin host', () => {
    // Defends against a mutant that switches `===` to `.includes`.
    const r = reqWithOrigin('https://shop.example.com.attacker.com')
    expect(validateOrigin(r, ['https://shop.example.com'])).toEqual({
      status: 'rejected',
      origin: 'https://shop.example.com.attacker.com',
    })
  })

  it('does not accept an allowed entry that is a prefix of the origin', () => {
    const r = reqWithOrigin('https://shop.example.com')
    // 'https://shop' is a prefix; must NOT match.
    expect(validateOrigin(r, ['https://shop'])).toEqual({
      status: 'rejected',
      origin: 'https://shop.example.com',
    })
  })

  it('uses the URL-parse fallback when an allowed entry is not a valid URL — exact-equal match', () => {
    // Triggers the catch-block fallback in validateOrigin where `new URL(allowed)`
    // throws. Defends against mutants in the fallback branch.
    const r = reqWithOrigin('shop.example.com')
    expect(validateOrigin(r, ['shop.example.com'])).toEqual({
      status: 'valid',
      origin: 'shop.example.com',
    })
  })

  it('uses the URL-parse fallback — non-matching bare-string allowed entry rejects', () => {
    const r = reqWithOrigin('shop.example.com')
    expect(validateOrigin(r, ['other.example.com'])).toEqual({
      status: 'rejected',
      origin: 'shop.example.com',
    })
  })

  it('returns the FIRST origin (Origin wins over Referer when both are present)', () => {
    const headers = new Headers()
    headers.set('Origin', 'https://evil.example.com')
    headers.set('Referer', 'https://shop.example.com/page')
    const r = new Request('https://worker.example/v1/events', { method: 'POST', headers })
    expect(validateOrigin(r, ['https://shop.example.com'])).toEqual({
      status: 'rejected',
      origin: 'https://evil.example.com',
    })
  })
})

describe('rejectOrigin', () => {
  it('returns a 403 with the offending origin in the body', async () => {
    const res = rejectOrigin('https://evil.example.com')
    expect(res.status).toBe(403)
    const body = await res.text()
    expect(body).toContain('https://evil.example.com')
    expect(body).toContain('not in the allowed origins')
  })

  it('sets the CORS allow-origin header so browsers see the 403 (not an opaque CORS error)', () => {
    const res = rejectOrigin('https://evil.example.com')
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*')
  })
})
