// ADR-1025 Phase 1 Sprint 1.3 — unit tests for the verification probe.
//
// All four probe steps (PUT, GET, content-hash, DELETE) are exercised via
// injected test doubles — no real S3 / R2 calls.

import { describe, expect, it, vi } from 'vitest'
import { createHash } from 'node:crypto'
import { runVerificationProbe } from '@/lib/storage/verify'

// ═══════════════════════════════════════════════════════════
// Fixtures
// ═══════════════════════════════════════════════════════════
const BASE_CONFIG = {
  provider: 'cs_managed_r2' as const,
  endpoint: 'https://fake-account.r2.cloudflarestorage.com',
  region: 'auto',
  bucket: 'cs-cust-testbucket',
  accessKeyId: 'AKIA_TEST',
  secretAccessKey: 'secret-never-logged',
}

const DETERMINISTIC_RANDOM = (n: number) => Buffer.alloc(n, 0xab)
const FIXED_NOW = () => 1_700_000_000_000 // 2023-11-14

function captureExpectedBody(): {
  bodyBuf: Buffer
  hash: string
} {
  // Matches the probe's canonical body shape when fed the fixed random +
  // fixed clock. Tests that want to succeed must return this exact body
  // on GET.
  const probeId = 'cs-verify-' + DETERMINISTIC_RANDOM(12).toString('hex')
  const bodyJson = JSON.stringify({
    probe_id: probeId,
    storage_provider: 'cs_managed_r2',
    timestamp: new Date(FIXED_NOW()).toISOString(),
    cs_version: '1',
  })
  const bodyBuf = Buffer.from(bodyJson, 'utf8')
  const hash = createHash('sha256').update(bodyBuf).digest('hex')
  return { bodyBuf, hash }
}

function makeHappyFetchResponding(body: Buffer) {
  return vi.fn(
    async () =>
      new Response(new Uint8Array(body), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
  )
}

// ═══════════════════════════════════════════════════════════
// Happy path
// ═══════════════════════════════════════════════════════════
describe('runVerificationProbe — happy path', () => {
  it('PUT + GET + content-hash + DELETE all succeed → ok=true, no failedStep', async () => {
    const { bodyBuf } = captureExpectedBody()
    const putFn = vi.fn(async () => ({ status: 200, etag: '"abc"' }))
    const presignFn = vi.fn(() => 'https://fake/signed-url')
    const deleteFn = vi.fn(async () => ({ status: 204 }))
    const fetchFn = makeHappyFetchResponding(bodyBuf)

    const result = await runVerificationProbe(BASE_CONFIG, {
      putObject: putFn,
      presignGet: presignFn,
      deleteObject: deleteFn,
      fetchFn,
      now: FIXED_NOW,
      randomBytesFn: DETERMINISTIC_RANDOM,
    })

    expect(result.ok).toBe(true)
    expect(result.failedStep).toBeUndefined()
    expect(result.error).toBeUndefined()
    expect(result.probeId).toMatch(/^cs-verify-[0-9a-f]{24}$/)
    expect(result.durationMs).toBeGreaterThanOrEqual(0)

    // Every step was called exactly once.
    expect(putFn).toHaveBeenCalledOnce()
    expect(presignFn).toHaveBeenCalledOnce()
    expect(fetchFn).toHaveBeenCalledOnce()
    expect(deleteFn).toHaveBeenCalledOnce()

    // PUT was passed the same body we're expecting. Verifies the probe
    // doesn't tamper with the body between compose + upload.
    const putCall = putFn.mock.calls[0][0]
    expect(Buffer.compare(putCall.body as Buffer, bodyBuf)).toBe(0)
    expect(putCall.bucket).toBe('cs-cust-testbucket')
    expect(putCall.key).toMatch(/^cs-verify-[0-9a-f]{24}\.txt$/)
  })

  it('DELETE failure → ok=true with failedStep=delete + error populated (sentinel aged by lifecycle)', async () => {
    const { bodyBuf } = captureExpectedBody()
    const putFn = vi.fn(async () => ({ status: 200, etag: null }))
    const presignFn = vi.fn(() => 'https://fake/signed-url')
    const deleteFn = vi.fn(async () => {
      throw new Error('DELETE 503 — transient')
    })
    const fetchFn = makeHappyFetchResponding(bodyBuf)

    const result = await runVerificationProbe(BASE_CONFIG, {
      putObject: putFn,
      presignGet: presignFn,
      deleteObject: deleteFn,
      fetchFn,
      now: FIXED_NOW,
      randomBytesFn: DETERMINISTIC_RANDOM,
    })

    expect(result.ok).toBe(true)
    expect(result.failedStep).toBe('delete')
    expect(result.error).toMatch(/DELETE 503/)
  })
})

// ═══════════════════════════════════════════════════════════
// Failure paths
// ═══════════════════════════════════════════════════════════
describe('runVerificationProbe — failure branches', () => {
  it('PUT throws → ok=false failedStep=put; no further calls made', async () => {
    const putFn = vi.fn(async () => {
      throw new Error('R2 PUT failed: 403 Forbidden')
    })
    const presignFn = vi.fn(() => '')
    const deleteFn = vi.fn(async () => ({ status: 204 }))
    const fetchFn = vi.fn(async () => new Response('should not be called'))

    const result = await runVerificationProbe(BASE_CONFIG, {
      putObject: putFn,
      presignGet: presignFn,
      deleteObject: deleteFn,
      fetchFn,
      now: FIXED_NOW,
      randomBytesFn: DETERMINISTIC_RANDOM,
    })

    expect(result.ok).toBe(false)
    expect(result.failedStep).toBe('put')
    expect(result.error).toMatch(/403 Forbidden/)
    expect(presignFn).not.toHaveBeenCalled()
    expect(fetchFn).not.toHaveBeenCalled()
    expect(deleteFn).not.toHaveBeenCalled()
  })

  it('GET returns 404 → ok=false failedStep=get + no DELETE attempted', async () => {
    const putFn = vi.fn(async () => ({ status: 200, etag: null }))
    const presignFn = vi.fn(() => 'https://fake/signed-url')
    const deleteFn = vi.fn(async () => ({ status: 204 }))
    const fetchFn = vi.fn(
      async () => new Response('not found', { status: 404 }),
    )

    const result = await runVerificationProbe(BASE_CONFIG, {
      putObject: putFn,
      presignGet: presignFn,
      deleteObject: deleteFn,
      fetchFn,
      now: FIXED_NOW,
      randomBytesFn: DETERMINISTIC_RANDOM,
    })

    expect(result.ok).toBe(false)
    expect(result.failedStep).toBe('get')
    expect(result.error).toMatch(/HTTP 404/)
    expect(deleteFn).not.toHaveBeenCalled()
  })

  it('GET fetch throws network error → ok=false failedStep=get', async () => {
    const putFn = vi.fn(async () => ({ status: 200, etag: null }))
    const presignFn = vi.fn(() => 'https://fake/signed-url')
    const deleteFn = vi.fn(async () => ({ status: 204 }))
    const fetchFn = vi.fn(async () => {
      throw new TypeError('fetch failed')
    })

    const result = await runVerificationProbe(BASE_CONFIG, {
      putObject: putFn,
      presignGet: presignFn,
      deleteObject: deleteFn,
      fetchFn,
      now: FIXED_NOW,
      randomBytesFn: DETERMINISTIC_RANDOM,
    })

    expect(result.ok).toBe(false)
    expect(result.failedStep).toBe('get')
    expect(result.error).toMatch(/fetch failed/)
  })

  it('content-hash mismatch → ok=false failedStep=content_hash; DELETE not called', async () => {
    const putFn = vi.fn(async () => ({ status: 200, etag: null }))
    const presignFn = vi.fn(() => 'https://fake/signed-url')
    const deleteFn = vi.fn(async () => ({ status: 204 }))
    // Returns the WRONG body — simulates silent-rewrite bug in R2.
    const tamperedBody = Buffer.from('{"tampered":true}')
    const fetchFn = vi.fn(
      async () =>
        new Response(new Uint8Array(tamperedBody), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
    )

    const result = await runVerificationProbe(BASE_CONFIG, {
      putObject: putFn,
      presignGet: presignFn,
      deleteObject: deleteFn,
      fetchFn,
      now: FIXED_NOW,
      randomBytesFn: DETERMINISTIC_RANDOM,
    })

    expect(result.ok).toBe(false)
    expect(result.failedStep).toBe('content_hash')
    expect(result.error).toMatch(/expected sha256=.*got sha256=/)
    expect(deleteFn).not.toHaveBeenCalled()
  })
})

// ═══════════════════════════════════════════════════════════
// Body composition + probe id
// ═══════════════════════════════════════════════════════════
describe('runVerificationProbe — body composition', () => {
  it('probeId format: cs-verify-<24-hex>, key: probeId + .txt', async () => {
    const { bodyBuf } = captureExpectedBody()
    const putFn = vi.fn(async () => ({ status: 200, etag: null }))
    const presignFn = vi.fn(() => 'https://fake')
    const deleteFn = vi.fn(async () => ({ status: 204 }))
    const fetchFn = makeHappyFetchResponding(bodyBuf)

    const result = await runVerificationProbe(BASE_CONFIG, {
      putObject: putFn,
      presignGet: presignFn,
      deleteObject: deleteFn,
      fetchFn,
      now: FIXED_NOW,
      randomBytesFn: DETERMINISTIC_RANDOM,
    })

    expect(result.probeId).toMatch(/^cs-verify-[0-9a-f]{24}$/)
    expect(putFn.mock.calls[0][0].key).toBe(result.probeId + '.txt')
  })

  it('body payload includes probe_id, storage_provider, timestamp, cs_version', async () => {
    const { bodyBuf } = captureExpectedBody()
    const putFn = vi.fn(async () => ({ status: 200, etag: null }))
    const presignFn = vi.fn(() => 'https://fake')
    const deleteFn = vi.fn(async () => ({ status: 204 }))
    const fetchFn = makeHappyFetchResponding(bodyBuf)

    await runVerificationProbe(BASE_CONFIG, {
      putObject: putFn,
      presignGet: presignFn,
      deleteObject: deleteFn,
      fetchFn,
      now: FIXED_NOW,
      randomBytesFn: DETERMINISTIC_RANDOM,
    })

    const putBody = putFn.mock.calls[0][0].body as Buffer
    const payload = JSON.parse(putBody.toString('utf8')) as Record<string, unknown>
    expect(payload.probe_id).toMatch(/^cs-verify-[0-9a-f]{24}$/)
    expect(payload.storage_provider).toBe('cs_managed_r2')
    expect(payload.timestamp).toBe(new Date(FIXED_NOW()).toISOString())
    expect(payload.cs_version).toBe('1')
    // No PII / customer data.
    expect(Object.keys(payload)).toHaveLength(4)
  })
})
