// ADR-1006 Phase 1 Sprint 1.1 — HTTP transport behaviour.
//
// Targets the compliance-load-bearing pieces of the transport:
//   - 2-second default timeout fires + throws ConsentShieldTimeoutError
//   - exponential-backoff retry on 5xx (kicks in 100ms, 400ms, 1600ms)
//   - no retry on 4xx (failure surfaces immediately)
//   - no retry on timeout (latency budget would compound)
//   - Bearer header + Content-Type + JSON body marshalling
//   - traceId from response header lifted onto the response + errors
//   - query-string composition skips undefined/null

import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest'
import { HttpClient, type FetchImpl } from '../src/http'
import {
  ConsentShieldApiError,
  ConsentShieldNetworkError,
  ConsentShieldTimeoutError,
} from '../src/errors'

const VALID_KEY = 'cs_live_abc'
const BASE = 'https://api.example.com'

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

function makeClient(fetchImpl: FetchImpl, overrides: Partial<{ timeoutMs: number; maxRetries: number; sleepImpl: (ms: number) => Promise<void> }> = {}) {
  return new HttpClient({
    baseUrl: BASE,
    apiKey: VALID_KEY,
    timeoutMs: overrides.timeoutMs ?? 2_000,
    maxRetries: overrides.maxRetries ?? 3,
    fetchImpl,
    // Default sleep override skips real backoff so retry tests run fast.
    sleepImpl: overrides.sleepImpl ?? (async () => {}),
  })
}

describe('HttpClient — happy path', () => {
  it('GETs the v1-prefixed URL with Bearer auth + Accept: application/json', async () => {
    const fetchMock = vi.fn<FetchImpl>(async () => jsonResponse({ items: [] }))
    const http = makeClient(fetchMock)

    const res = await http.request<{ items: unknown[] }>({
      method: 'GET',
      path: '/properties',
    })

    expect(res.status).toBe(200)
    expect(res.body).toEqual({ items: [] })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0]!
    expect(url).toBe('https://api.example.com/v1/properties')
    expect(init?.method).toBe('GET')
    const headers = init?.headers as Record<string, string>
    expect(headers.Authorization).toBe(`Bearer ${VALID_KEY}`)
    expect(headers.Accept).toBe('application/json')
    // No Content-Type without a body.
    expect(headers['Content-Type']).toBeUndefined()
  })

  it('POSTs a JSON body + sets Content-Type', async () => {
    const fetchMock = vi.fn<FetchImpl>(async () => jsonResponse({ ok: true }, 201))
    const http = makeClient(fetchMock)
    await http.request({ method: 'POST', path: '/consent/record', body: { x: 1 } })
    const [, init] = fetchMock.mock.calls[0]!
    const headers = init?.headers as Record<string, string>
    expect(headers['Content-Type']).toBe('application/json')
    expect(init?.body).toBe(JSON.stringify({ x: 1 }))
  })

  it('lifts X-CS-Trace-Id from the response onto the result', async () => {
    const fetchMock = vi.fn<FetchImpl>(async () => jsonResponse({ ok: true }, 200, 'trace-abc-123'))
    const http = makeClient(fetchMock)
    const res = await http.request<{ ok: boolean }>({ method: 'GET', path: '/_ping' })
    expect(res.traceId).toBe('trace-abc-123')
  })

  it('forwards a caller-supplied X-CS-Trace-Id on the request', async () => {
    const fetchMock = vi.fn<FetchImpl>(async () => jsonResponse({}))
    const http = makeClient(fetchMock)
    await http.request({ method: 'GET', path: '/_ping', traceId: 'caller-trace' })
    const [, init] = fetchMock.mock.calls[0]!
    const headers = init?.headers as Record<string, string>
    expect(headers['X-CS-Trace-Id']).toBe('caller-trace')
  })

  it('composes a query string from the query option, skipping undefined/null', async () => {
    const fetchMock = vi.fn<FetchImpl>(async () => jsonResponse({}))
    const http = makeClient(fetchMock)
    await http.request({
      method: 'GET',
      path: '/audit',
      query: { since: '2026-01-01', limit: 50, cursor: undefined, include: null, archived: false },
    })
    const [url] = fetchMock.mock.calls[0]!
    expect(url).toBe('https://api.example.com/v1/audit?since=2026-01-01&limit=50&archived=false')
  })

  it('returns null body on 204', async () => {
    const fetchMock = vi.fn<FetchImpl>(async () => new Response(null, { status: 204 }))
    const http = makeClient(fetchMock)
    const res = await http.request<null>({ method: 'DELETE', path: '/x' })
    expect(res.status).toBe(204)
    expect(res.body).toBeNull()
  })
})

describe('HttpClient — timeout (compliance posture)', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('throws ConsentShieldTimeoutError when fetch is slower than timeoutMs', async () => {
    // fetchImpl resolves only when its abort signal fires; the test then
    // verifies the abort was driven by OUR timeout (not the caller's).
    const fetchMock = vi.fn<FetchImpl>((_url, init) => {
      return new Promise((_resolve, reject) => {
        init!.signal!.addEventListener('abort', () => {
          const err: Error & { name?: string } = new Error('aborted')
          err.name = 'AbortError'
          reject(err)
        })
      })
    })
    const http = makeClient(fetchMock, { timeoutMs: 250, maxRetries: 0 })
    // Attach .rejects BEFORE advancing timers so the rejection always has
    // a registered handler at the moment it fires (otherwise Node logs
    // PromiseRejectionHandledWarning + vitest treats it as unhandled).
    const expectation = expect(
      http.request({ method: 'GET', path: '/_ping' }),
    ).rejects.toThrowError(ConsentShieldTimeoutError)

    await vi.advanceTimersByTimeAsync(250)
    await expectation
  })

  it('does NOT retry on timeout (latency budget would compound)', async () => {
    const fetchMock = vi.fn<FetchImpl>((_url, init) => {
      return new Promise((_resolve, reject) => {
        init!.signal!.addEventListener('abort', () => {
          const err: Error & { name?: string } = new Error('aborted')
          err.name = 'AbortError'
          reject(err)
        })
      })
    })
    const http = makeClient(fetchMock, { timeoutMs: 100, maxRetries: 5 })
    const expectation = expect(
      http.request({ method: 'GET', path: '/_ping' }),
    ).rejects.toThrowError(ConsentShieldTimeoutError)
    await vi.advanceTimersByTimeAsync(100)
    await expectation
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})

describe('HttpClient — retries on 5xx + transport errors', () => {
  it('retries up to maxRetries times on 503 then succeeds', async () => {
    const fetchMock = vi
      .fn<FetchImpl>()
      .mockResolvedValueOnce(jsonResponse({}, 503))
      .mockResolvedValueOnce(jsonResponse({}, 503))
      .mockResolvedValueOnce(jsonResponse({ ok: true }, 200))
    const http = makeClient(fetchMock)
    const res = await http.request<{ ok: boolean }>({ method: 'GET', path: '/_ping' })
    expect(res.body).toEqual({ ok: true })
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })

  it('throws ConsentShieldApiError(503) after maxRetries+1 failed attempts', async () => {
    const fetchMock = vi.fn<FetchImpl>(async () =>
      problemResponse(
        503,
        { type: 'x', title: 'Service Unavailable', status: 503, detail: 'down' },
        'trace-fail',
      ),
    )
    const http = makeClient(fetchMock, { maxRetries: 2 })
    await expect(
      http.request({ method: 'GET', path: '/_ping' }),
    ).rejects.toMatchObject({
      name: 'ConsentShieldApiError',
      status: 503,
      traceId: 'trace-fail',
    })
    expect(fetchMock).toHaveBeenCalledTimes(3) // 1 initial + 2 retries
  })

  it('retries on transport (network) errors then surfaces ConsentShieldNetworkError', async () => {
    const fetchMock = vi.fn<FetchImpl>(async () => {
      throw new TypeError('fetch failed')
    })
    const http = makeClient(fetchMock, { maxRetries: 2 })
    await expect(
      http.request({ method: 'GET', path: '/_ping' }),
    ).rejects.toBeInstanceOf(ConsentShieldNetworkError)
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })

  it('does NOT retry on 400/401/403/404 — surfaces ConsentShieldApiError immediately', async () => {
    for (const status of [400, 401, 403, 404, 410, 422]) {
      const fetchMock = vi.fn<FetchImpl>(async () =>
        problemResponse(status, {
          type: 'x',
          title: 'Bad Request',
          status,
          detail: `code-${status}`,
        }),
      )
      const http = makeClient(fetchMock, { maxRetries: 5 })
      await expect(
        http.request({ method: 'GET', path: '/_ping' }),
      ).rejects.toBeInstanceOf(ConsentShieldApiError)
      expect(fetchMock).toHaveBeenCalledTimes(1)
    }
  })

  it('honours maxRetries=0 (single attempt, no retries)', async () => {
    const fetchMock = vi.fn<FetchImpl>(async () => jsonResponse({}, 503))
    const http = makeClient(fetchMock, { maxRetries: 0 })
    await expect(
      http.request({ method: 'GET', path: '/_ping' }),
    ).rejects.toBeInstanceOf(ConsentShieldApiError)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})

describe('HttpClient — caller AbortSignal', () => {
  it('re-throws the caller AbortError when the caller aborts', async () => {
    const ctrl = new AbortController()
    const fetchMock = vi.fn<FetchImpl>((_url, init) => {
      return new Promise((_resolve, reject) => {
        init!.signal!.addEventListener('abort', () => {
          const err: Error & { name?: string } = new Error('aborted')
          err.name = 'AbortError'
          reject(err)
        })
      })
    })
    const http = makeClient(fetchMock, { timeoutMs: 5_000 })
    const promise = http.request({ method: 'GET', path: '/_ping', signal: ctrl.signal })
    ctrl.abort()
    await expect(promise).rejects.toMatchObject({ name: 'AbortError' })
  })
})

describe('HttpClient — ProblemJson parsing', () => {
  it('parses a problem+json body onto ConsentShieldApiError.problem', async () => {
    const fetchMock = vi.fn<FetchImpl>(async () =>
      problemResponse(
        403,
        {
          type: 'https://consentshield.in/errors/forbidden',
          title: 'Forbidden',
          status: 403,
          detail: 'This key does not have the required scope: read',
        },
        'trace-403',
      ),
    )
    const http = makeClient(fetchMock, { maxRetries: 0 })
    try {
      await http.request({ method: 'GET', path: '/_ping' })
      expect.fail('expected throw')
    } catch (e) {
      expect(e).toBeInstanceOf(ConsentShieldApiError)
      const apiErr = e as ConsentShieldApiError
      expect(apiErr.status).toBe(403)
      expect(apiErr.problem?.title).toBe('Forbidden')
      expect(apiErr.problem?.detail).toContain('required scope')
      expect(apiErr.traceId).toBe('trace-403')
    }
  })

  it('tolerates a non-JSON error body — ApiError.problem is undefined', async () => {
    const fetchMock = vi.fn<FetchImpl>(
      async () => new Response('plain text error', { status: 500 }),
    )
    const http = makeClient(fetchMock, { maxRetries: 0 })
    await expect(
      http.request({ method: 'GET', path: '/_ping' }),
    ).rejects.toMatchObject({ name: 'ConsentShieldApiError', problem: undefined })
  })
})
