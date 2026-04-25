// ADR-1006 Phase 1 Sprint 1.1 — ConsentShieldClient constructor + defaults.

import { describe, it, expect, afterEach, vi } from 'vitest'
import { ConsentShieldClient } from '../src/index'

const VALID_KEY = 'cs_live_abc123def456'

describe('ConsentShieldClient — constructor validation', () => {
  it('accepts a well-formed apiKey + applies SDK defaults', () => {
    const client = new ConsentShieldClient({ apiKey: VALID_KEY })
    expect(client.baseUrl).toBe('https://app.consentshield.in')
    expect(client.timeoutMs).toBe(2_000)
    expect(client.maxRetries).toBe(3)
    expect(client.failOpen).toBe(false)
  })

  it('honours a custom baseUrl + trims trailing slashes', () => {
    const client = new ConsentShieldClient({
      apiKey: VALID_KEY,
      baseUrl: 'https://staging.example.com///',
    })
    expect(client.baseUrl).toBe('https://staging.example.com')
  })

  it('honours custom timeoutMs and maxRetries', () => {
    const client = new ConsentShieldClient({
      apiKey: VALID_KEY,
      timeoutMs: 5_000,
      maxRetries: 0,
    })
    expect(client.timeoutMs).toBe(5_000)
    expect(client.maxRetries).toBe(0)
  })

  it('rejects a missing options object', () => {
    expect(() => new ConsentShieldClient(undefined as unknown as never)).toThrow(
      /requires an options object/,
    )
  })

  it('rejects a non-string apiKey', () => {
    expect(
      () => new ConsentShieldClient({ apiKey: 12345 as unknown as string }),
    ).toThrow(/cs_live_/)
  })

  it('rejects an apiKey without the cs_live_ prefix', () => {
    expect(() => new ConsentShieldClient({ apiKey: 'sk_live_xyz' })).toThrow(
      /cs_live_/,
    )
  })

  it('rejects an apiKey with the wrong-case prefix', () => {
    expect(() => new ConsentShieldClient({ apiKey: 'CS_LIVE_xyz' })).toThrow(
      /cs_live_/,
    )
  })

  it('rejects a non-positive timeoutMs', () => {
    expect(
      () => new ConsentShieldClient({ apiKey: VALID_KEY, timeoutMs: 0 }),
    ).toThrow(/positive finite number/)
    expect(
      () => new ConsentShieldClient({ apiKey: VALID_KEY, timeoutMs: -100 }),
    ).toThrow(/positive finite number/)
    expect(
      () =>
        new ConsentShieldClient({ apiKey: VALID_KEY, timeoutMs: Infinity }),
    ).toThrow(/positive finite number/)
  })

  it('rejects a non-integer or negative maxRetries', () => {
    expect(
      () => new ConsentShieldClient({ apiKey: VALID_KEY, maxRetries: -1 }),
    ).toThrow(/non-negative integer/)
    expect(
      () => new ConsentShieldClient({ apiKey: VALID_KEY, maxRetries: 1.5 }),
    ).toThrow(/non-negative integer/)
  })

  it('honours an explicit failOpen=true (compliance opt-in)', () => {
    const client = new ConsentShieldClient({ apiKey: VALID_KEY, failOpen: true })
    expect(client.failOpen).toBe(true)
  })
})

describe('ConsentShieldClient — CONSENT_VERIFY_FAIL_OPEN env override', () => {
  const originalValue = process.env.CONSENT_VERIFY_FAIL_OPEN

  afterEach(() => {
    if (originalValue === undefined) {
      delete process.env.CONSENT_VERIFY_FAIL_OPEN
    } else {
      process.env.CONSENT_VERIFY_FAIL_OPEN = originalValue
    }
  })

  it('reads CONSENT_VERIFY_FAIL_OPEN=true from env when option absent', () => {
    process.env.CONSENT_VERIFY_FAIL_OPEN = 'true'
    const client = new ConsentShieldClient({ apiKey: VALID_KEY })
    expect(client.failOpen).toBe(true)
  })

  it('reads "1" as truthy from env', () => {
    process.env.CONSENT_VERIFY_FAIL_OPEN = '1'
    const client = new ConsentShieldClient({ apiKey: VALID_KEY })
    expect(client.failOpen).toBe(true)
  })

  it('explicit failOpen=false in options overrides env=true', () => {
    process.env.CONSENT_VERIFY_FAIL_OPEN = 'true'
    const client = new ConsentShieldClient({ apiKey: VALID_KEY, failOpen: false })
    expect(client.failOpen).toBe(false)
  })

  it('treats env=falsey as failOpen=false (the safe default)', () => {
    process.env.CONSENT_VERIFY_FAIL_OPEN = 'false'
    expect(new ConsentShieldClient({ apiKey: VALID_KEY }).failOpen).toBe(false)
    process.env.CONSENT_VERIFY_FAIL_OPEN = '0'
    expect(new ConsentShieldClient({ apiKey: VALID_KEY }).failOpen).toBe(false)
    process.env.CONSENT_VERIFY_FAIL_OPEN = 'yes'
    expect(new ConsentShieldClient({ apiKey: VALID_KEY }).failOpen).toBe(false)
  })
})

describe('ConsentShieldClient.ping', () => {
  it('GETs /v1/_ping with the Bearer apiKey + resolves to true on 200', async () => {
    type FetchImpl = (input: string, init?: RequestInit) => Promise<Response>
    const fetchMock = vi.fn<FetchImpl>(async () =>
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    )
    const client = new ConsentShieldClient({
      apiKey: VALID_KEY,
      baseUrl: 'https://api.example.com',
      fetchImpl: fetchMock,
    })
    await expect(client.ping()).resolves.toBe(true)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const call = fetchMock.mock.calls[0]
    expect(call).toBeDefined()
    const [url, init] = call!
    expect(url).toBe('https://api.example.com/v1/_ping')
    const headers = init?.headers as Record<string, string>
    expect(headers.Authorization).toBe(`Bearer ${VALID_KEY}`)
    expect(init?.method).toBe('GET')
  })
})
