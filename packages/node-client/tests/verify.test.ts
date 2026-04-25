// ADR-1006 Phase 1 Sprint 1.2 — verify() compliance behaviour.
//
// Targets the load-bearing rules:
//   - Happy path returns the §5.1 envelope verbatim.
//   - camelCase input → snake_case query string at the network boundary.
//   - 4xx ALWAYS throws (failOpen flag is ignored — caller bug must
//     surface, never silently default-grant).
//   - timeout / network / 5xx + failOpen=false → throws ConsentVerifyError
//     wrapping the cause.
//   - timeout / network / 5xx + failOpen=true → returns OpenFailureEnvelope
//     with the right `cause` discriminator.
//   - traceId round-trips on success AND failure paths.

import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest'
import { ConsentShieldClient, ConsentShieldApiError, ConsentVerifyError, isOpenFailure } from '../src/index'
import type { FetchImpl } from '../src/index'
import type { VerifyEnvelope } from '../src/index'

const VALID_KEY = 'cs_live_abc'
const PROPERTY_ID = '11111111-1111-1111-1111-111111111111'

const SAMPLE_ENVELOPE: VerifyEnvelope = {
  property_id: PROPERTY_ID,
  identifier_type: 'email',
  purpose_code: 'marketing',
  status: 'granted',
  active_artefact_id: '22222222-2222-2222-2222-222222222222',
  revoked_at: null,
  revocation_record_id: null,
  expires_at: null,
  evaluated_at: '2026-04-25T10:00:00.000Z',
}

function jsonResponse(body: unknown, status = 200, traceId?: string): Response {
  const headers: Record<string, string> = { 'content-type': 'application/json' }
  if (traceId) headers['x-cs-trace-id'] = traceId
  return new Response(JSON.stringify(body), { status, headers })
}

function problemResponse(status: number, problem: object, traceId?: string): Response {
  const headers: Record<string, string> = { 'content-type': 'application/problem+json' }
  if (traceId) headers['x-cs-trace-id'] = traceId
  return new Response(JSON.stringify(problem), { status, headers })
}

function makeClient(fetchImpl: FetchImpl, opts: { failOpen?: boolean; maxRetries?: number } = {}) {
  return new ConsentShieldClient({
    apiKey: VALID_KEY,
    baseUrl: 'https://api.example.com',
    fetchImpl,
    sleepImpl: async () => {},
    failOpen: opts.failOpen ?? false,
    maxRetries: opts.maxRetries ?? 0,
  })
}

const VERIFY_INPUT = {
  propertyId: PROPERTY_ID,
  dataPrincipalIdentifier: 'user@example.com',
  identifierType: 'email' as const,
  purposeCode: 'marketing',
}

describe('verify — happy path', () => {
  it('returns the §5.1 envelope verbatim on 200', async () => {
    const fetchMock = vi.fn<FetchImpl>(async () => jsonResponse(SAMPLE_ENVELOPE))
    const client = makeClient(fetchMock)
    const result = await client.verify(VERIFY_INPUT)
    expect(result).toEqual(SAMPLE_ENVELOPE)
    if (!isOpenFailure(result)) {
      expect(result.status).toBe('granted')
    }
  })

  it('camelCase input becomes snake_case query string at the network boundary', async () => {
    const fetchMock = vi.fn<FetchImpl>(async () => jsonResponse(SAMPLE_ENVELOPE))
    const client = makeClient(fetchMock)
    await client.verify(VERIFY_INPUT)

    const [url, init] = fetchMock.mock.calls[0]!
    const parsed = new URL(url as string)
    expect(parsed.pathname).toBe('/v1/consent/verify')
    expect(parsed.searchParams.get('property_id')).toBe(PROPERTY_ID)
    expect(parsed.searchParams.get('data_principal_identifier')).toBe('user@example.com')
    expect(parsed.searchParams.get('identifier_type')).toBe('email')
    expect(parsed.searchParams.get('purpose_code')).toBe('marketing')
    expect(init?.method).toBe('GET')
    const headers = init?.headers as Record<string, string>
    expect(headers.Authorization).toBe(`Bearer ${VALID_KEY}`)
  })

  it('forwards a caller-supplied traceId via X-CS-Trace-Id', async () => {
    const fetchMock = vi.fn<FetchImpl>(async () => jsonResponse(SAMPLE_ENVELOPE, 200, 'echo-trace'))
    const client = makeClient(fetchMock)
    await client.verify({ ...VERIFY_INPUT, traceId: 'caller-trace-1' })

    const [, init] = fetchMock.mock.calls[0]!
    const headers = init?.headers as Record<string, string>
    expect(headers['X-CS-Trace-Id']).toBe('caller-trace-1')
  })
})

describe('verify — synchronous input validation', () => {
  it('rejects missing propertyId synchronously', async () => {
    const fetchMock = vi.fn<FetchImpl>(async () => jsonResponse(SAMPLE_ENVELOPE))
    const client = makeClient(fetchMock)
    await expect(
      client.verify({ ...VERIFY_INPUT, propertyId: '' }),
    ).rejects.toThrow(/propertyId is required/)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('rejects each missing/empty required field', async () => {
    const fetchMock = vi.fn<FetchImpl>(async () => jsonResponse(SAMPLE_ENVELOPE))
    const client = makeClient(fetchMock)
    for (const field of ['propertyId', 'dataPrincipalIdentifier', 'identifierType', 'purposeCode'] as const) {
      await expect(
        client.verify({ ...VERIFY_INPUT, [field]: '' } as unknown as typeof VERIFY_INPUT),
      ).rejects.toThrow(new RegExp(`${field} is required`))
    }
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('verify — fail-CLOSED default behaviour', () => {
  it('throws ConsentVerifyError on a 5xx (NOT ConsentShieldApiError directly)', async () => {
    const fetchMock = vi.fn<FetchImpl>(async () =>
      problemResponse(503, { type: 't', title: 'Service Unavailable', status: 503, detail: 'down' }, 'trace-503'),
    )
    const client = makeClient(fetchMock)
    try {
      await client.verify(VERIFY_INPUT)
      expect.fail('expected throw')
    } catch (e) {
      expect(e).toBeInstanceOf(ConsentVerifyError)
      const verr = e as ConsentVerifyError
      expect(verr.cause).toBeInstanceOf(ConsentShieldApiError)
      expect(verr.traceId).toBe('trace-503')
    }
  })

  it('throws ConsentVerifyError on a transport error', async () => {
    const fetchMock = vi.fn<FetchImpl>(async () => {
      throw new TypeError('fetch failed')
    })
    const client = makeClient(fetchMock)
    await expect(client.verify(VERIFY_INPUT)).rejects.toBeInstanceOf(ConsentVerifyError)
  })
})

describe('verify — fail-OPEN opt-in', () => {
  it('returns OpenFailureEnvelope on 5xx when failOpen=true', async () => {
    const fetchMock = vi.fn<FetchImpl>(async () =>
      problemResponse(503, { type: 't', title: 'down', status: 503, detail: 'eek' }, 'trace-open'),
    )
    const client = makeClient(fetchMock, { failOpen: true })
    const result = await client.verify(VERIFY_INPUT)
    expect(isOpenFailure(result)).toBe(true)
    if (isOpenFailure(result)) {
      expect(result.status).toBe('open_failure')
      expect(result.cause).toBe('server_error')
      expect(result.traceId).toBe('trace-open')
      expect(result.reason).toContain('503')
    }
  })

  it('returns OpenFailureEnvelope on transport error when failOpen=true', async () => {
    const fetchMock = vi.fn<FetchImpl>(async () => {
      throw new TypeError('fetch failed')
    })
    const client = makeClient(fetchMock, { failOpen: true })
    const result = await client.verify(VERIFY_INPUT)
    expect(isOpenFailure(result)).toBe(true)
    if (isOpenFailure(result)) expect(result.cause).toBe('network')
  })

  it('discriminates timeout via cause: timeout when failOpen=true', async () => {
    vi.useFakeTimers()
    try {
      const fetchMock = vi.fn<FetchImpl>(
        (_url, init) =>
          new Promise((_resolve, reject) => {
            init!.signal!.addEventListener('abort', () => {
              const err: Error & { name?: string } = new Error('aborted')
              err.name = 'AbortError'
              reject(err)
            })
          }),
      )
      const client = new ConsentShieldClient({
        apiKey: VALID_KEY,
        baseUrl: 'https://api.example.com',
        fetchImpl: fetchMock,
        sleepImpl: async () => {},
        failOpen: true,
        timeoutMs: 100,
        maxRetries: 0,
      })

      const promise = client.verify(VERIFY_INPUT)
      await vi.advanceTimersByTimeAsync(100)
      const result = await promise
      expect(isOpenFailure(result)).toBe(true)
      if (isOpenFailure(result)) expect(result.cause).toBe('timeout')
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('verify — 4xx is NEVER opened (compliance contract)', () => {
  it('throws ConsentShieldApiError on 422 even when failOpen=true', async () => {
    const fetchMock = vi.fn<FetchImpl>(async () =>
      problemResponse(422, { type: 't', title: 'Unprocessable Entity', status: 422, detail: 'bad input' }),
    )
    const client = makeClient(fetchMock, { failOpen: true })
    await expect(client.verify(VERIFY_INPUT)).rejects.toBeInstanceOf(ConsentShieldApiError)
  })

  it('throws ConsentShieldApiError on 403 even when failOpen=true (scope errors must not be silenced)', async () => {
    const fetchMock = vi.fn<FetchImpl>(async () =>
      problemResponse(403, { type: 't', title: 'Forbidden', status: 403, detail: 'no scope' }),
    )
    const client = makeClient(fetchMock, { failOpen: true })
    try {
      await client.verify(VERIFY_INPUT)
      expect.fail('expected throw')
    } catch (e) {
      expect(e).toBeInstanceOf(ConsentShieldApiError)
      expect((e as ConsentShieldApiError).status).toBe(403)
    }
  })

  it('throws ConsentShieldApiError on 404 even when failOpen=true (property-not-found must not be silenced)', async () => {
    const fetchMock = vi.fn<FetchImpl>(async () =>
      problemResponse(404, { type: 't', title: 'Not Found', status: 404, detail: 'no property' }),
    )
    const client = makeClient(fetchMock, { failOpen: true })
    await expect(client.verify(VERIFY_INPUT)).rejects.toBeInstanceOf(ConsentShieldApiError)
  })
})
