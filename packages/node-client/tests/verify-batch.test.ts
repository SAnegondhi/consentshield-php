// ADR-1006 Phase 1 Sprint 1.2 — verifyBatch() compliance behaviour.
//
// Same fail-closed/open + 4xx-always-throws contract as verify(). The
// extra surface here is client-side input validation BEFORE any network
// call: empty array, > 10000 entries, non-string entries.

import { describe, it, expect, vi } from 'vitest'
import { ConsentShieldClient, ConsentShieldApiError, ConsentVerifyError, isOpenFailure } from '../src/index'
import type { FetchImpl, VerifyBatchEnvelope, VerifyBatchInput } from '../src/index'

const VALID_KEY = 'cs_live_abc'
const PROPERTY_ID = '11111111-1111-1111-1111-111111111111'

function jsonResponse(body: unknown, status = 200, traceId?: string): Response {
  const headers: Record<string, string> = { 'content-type': 'application/json' }
  if (traceId) headers['x-cs-trace-id'] = traceId
  return new Response(JSON.stringify(body), { status, headers })
}

function problemResponse(status: number, problem: object): Response {
  return new Response(JSON.stringify(problem), {
    status,
    headers: { 'content-type': 'application/problem+json' },
  })
}

function makeClient(fetchImpl: FetchImpl, opts: { failOpen?: boolean } = {}) {
  return new ConsentShieldClient({
    apiKey: VALID_KEY,
    baseUrl: 'https://api.example.com',
    fetchImpl,
    sleepImpl: async () => {},
    failOpen: opts.failOpen ?? false,
    maxRetries: 0,
  })
}

const BASE_INPUT: VerifyBatchInput = {
  propertyId: PROPERTY_ID,
  identifierType: 'email',
  purposeCode: 'marketing',
  identifiers: ['a@x.com', 'b@x.com', 'c@x.com'],
}

const SAMPLE_BATCH: VerifyBatchEnvelope = {
  property_id: PROPERTY_ID,
  identifier_type: 'email',
  purpose_code: 'marketing',
  evaluated_at: '2026-04-25T10:00:00.000Z',
  results: [
    { identifier: 'a@x.com', status: 'granted', active_artefact_id: 'aid-a', revoked_at: null, revocation_record_id: null, expires_at: null },
    { identifier: 'b@x.com', status: 'revoked', active_artefact_id: null, revoked_at: '2026-04-01T00:00:00Z', revocation_record_id: 'rev-b', expires_at: null },
    { identifier: 'c@x.com', status: 'never_consented', active_artefact_id: null, revoked_at: null, revocation_record_id: null, expires_at: null },
  ],
}

describe('verifyBatch — happy path', () => {
  it('POSTs the snake_case body and returns the response envelope verbatim', async () => {
    const fetchMock = vi.fn<FetchImpl>(async () => jsonResponse(SAMPLE_BATCH))
    const client = makeClient(fetchMock)
    const result = await client.verifyBatch(BASE_INPUT)
    expect(result).toEqual(SAMPLE_BATCH)

    const [url, init] = fetchMock.mock.calls[0]!
    expect(url).toBe('https://api.example.com/v1/consent/verify/batch')
    expect(init?.method).toBe('POST')
    const headers = init?.headers as Record<string, string>
    expect(headers['Content-Type']).toBe('application/json')
    const sentBody = JSON.parse(init?.body as string)
    expect(sentBody).toEqual({
      property_id: PROPERTY_ID,
      identifier_type: 'email',
      purpose_code: 'marketing',
      identifiers: ['a@x.com', 'b@x.com', 'c@x.com'],
    })
  })

  it('preserves input order in the results array (server contract)', async () => {
    const fetchMock = vi.fn<FetchImpl>(async () => jsonResponse(SAMPLE_BATCH))
    const client = makeClient(fetchMock)
    const result = await client.verifyBatch(BASE_INPUT)
    if (!isOpenFailure(result)) {
      expect(result.results.map((r) => r.identifier)).toEqual(['a@x.com', 'b@x.com', 'c@x.com'])
    }
  })
})

describe('verifyBatch — client-side gates (no network round-trip)', () => {
  it('throws RangeError synchronously on empty identifiers array', async () => {
    const fetchMock = vi.fn<FetchImpl>(async () => jsonResponse(SAMPLE_BATCH))
    const client = makeClient(fetchMock)
    await expect(client.verifyBatch({ ...BASE_INPUT, identifiers: [] })).rejects.toBeInstanceOf(
      RangeError,
    )
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('throws RangeError synchronously when length > 10000 (matches server cap, saves the 413 round-trip)', async () => {
    const fetchMock = vi.fn<FetchImpl>(async () => jsonResponse(SAMPLE_BATCH))
    const client = makeClient(fetchMock)
    const tooMany = Array.from({ length: 10_001 }, (_v, i) => `id-${i}@x.com`)
    await expect(client.verifyBatch({ ...BASE_INPUT, identifiers: tooMany })).rejects.toThrow(
      /exceeds limit 10000/,
    )
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('accepts exactly 10000 identifiers (boundary equal-to-limit is allowed)', async () => {
    const fetchMock = vi.fn<FetchImpl>(async () => jsonResponse(SAMPLE_BATCH))
    const client = makeClient(fetchMock)
    const atLimit = Array.from({ length: 10_000 }, (_v, i) => `id-${i}@x.com`)
    await client.verifyBatch({ ...BASE_INPUT, identifiers: atLimit })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('throws TypeError when identifiers is not an array', async () => {
    const fetchMock = vi.fn<FetchImpl>(async () => jsonResponse(SAMPLE_BATCH))
    const client = makeClient(fetchMock)
    await expect(
      client.verifyBatch({ ...BASE_INPUT, identifiers: 'not-an-array' as unknown as string[] }),
    ).rejects.toBeInstanceOf(TypeError)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('throws TypeError when an entry is not a string', async () => {
    const fetchMock = vi.fn<FetchImpl>(async () => jsonResponse(SAMPLE_BATCH))
    const client = makeClient(fetchMock)
    await expect(
      client.verifyBatch({
        ...BASE_INPUT,
        identifiers: ['a@x.com', 42 as unknown as string, 'c@x.com'],
      }),
    ).rejects.toThrow(/identifiers\[1\]/)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('throws TypeError when an entry is an empty string', async () => {
    const fetchMock = vi.fn<FetchImpl>(async () => jsonResponse(SAMPLE_BATCH))
    const client = makeClient(fetchMock)
    await expect(
      client.verifyBatch({ ...BASE_INPUT, identifiers: ['a@x.com', '', 'c@x.com'] }),
    ).rejects.toThrow(/identifiers\[1\]/)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('rejects each missing required scalar field synchronously', async () => {
    const fetchMock = vi.fn<FetchImpl>(async () => jsonResponse(SAMPLE_BATCH))
    const client = makeClient(fetchMock)
    for (const field of ['propertyId', 'identifierType', 'purposeCode'] as const) {
      await expect(
        client.verifyBatch({ ...BASE_INPUT, [field]: '' } as unknown as VerifyBatchInput),
      ).rejects.toThrow(new RegExp(`${field} is required`))
    }
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('verifyBatch — fail-CLOSED default behaviour', () => {
  it('throws ConsentVerifyError on 5xx', async () => {
    const fetchMock = vi.fn<FetchImpl>(async () =>
      problemResponse(503, { type: 't', title: 'down', status: 503, detail: 'eek' }),
    )
    const client = makeClient(fetchMock)
    await expect(client.verifyBatch(BASE_INPUT)).rejects.toBeInstanceOf(ConsentVerifyError)
  })
})

describe('verifyBatch — fail-OPEN opt-in', () => {
  it('returns OpenFailureEnvelope on 5xx when failOpen=true', async () => {
    const fetchMock = vi.fn<FetchImpl>(async () =>
      problemResponse(503, { type: 't', title: 'down', status: 503, detail: 'eek' }),
    )
    const client = makeClient(fetchMock, { failOpen: true })
    const result = await client.verifyBatch(BASE_INPUT)
    expect(isOpenFailure(result)).toBe(true)
    if (isOpenFailure(result)) expect(result.cause).toBe('server_error')
  })
})

describe('verifyBatch — 4xx never opens', () => {
  it('throws ConsentShieldApiError on 422 even when failOpen=true', async () => {
    const fetchMock = vi.fn<FetchImpl>(async () =>
      problemResponse(422, { type: 't', title: 'Unprocessable Entity', status: 422, detail: 'bad' }),
    )
    const client = makeClient(fetchMock, { failOpen: true })
    await expect(client.verifyBatch(BASE_INPUT)).rejects.toBeInstanceOf(ConsentShieldApiError)
  })

  it('throws ConsentShieldApiError on 413 (server-side cap) even when failOpen=true', async () => {
    // Server returns 413 if the client-side gate is somehow bypassed (e.g.
    // the cap is raised on the SDK but not on the server). Either way it
    // must surface, never silently open.
    const fetchMock = vi.fn<FetchImpl>(async () =>
      problemResponse(413, { type: 't', title: 'Payload Too Large', status: 413, detail: 'too big' }),
    )
    const client = makeClient(fetchMock, { failOpen: true })
    await expect(client.verifyBatch(BASE_INPUT)).rejects.toBeInstanceOf(ConsentShieldApiError)
  })
})
