// ADR-1025 Phase 2 Sprint 2.1 — unit tests for provision-org.ts.
//
// Mocks cf-provision + verify via dep injection. Mocks the postgres.js
// tagged-template client with a queue-based stub that returns scripted
// responses in call order.

import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'

// ── Minimal postgres.js tagged-template stub ──────────────────────────────
// postgres.js is used as: `pg\`select ...\`` → Promise<Row[]>.
// Our stub returns scripted rows in call order and records every query.
type StubCall = { query: string; values: unknown[] }
type StubResponses = Array<unknown[] | Error>

function createPgStub(responses: StubResponses) {
  const calls: StubCall[] = []
  let i = 0
  const fn = ((strings: TemplateStringsArray, ...values: unknown[]) => {
    calls.push({ query: strings.join('?'), values })
    if (i >= responses.length) {
      throw new Error(`pg stub: unexpected call #${i + 1} — queue exhausted`)
    }
    const next = responses[i++]
    if (next instanceof Error) return Promise.reject(next)
    return Promise.resolve(next)
  }) as unknown as Parameters<
    typeof import('@/lib/storage/provision-org').provisionStorageForOrg
  >[0]
  // Expose helpers on the function for assertions.
  ;(fn as unknown as { calls: StubCall[] }).calls = calls
  return fn
}

// ── Fixture values ──────────────────────────────────────────────────────
const ORG_ID = '11111111-1111-1111-1111-111111111111'
const ORG_SALT = 'org-salt-fixture-2026'
const CONFIG_ID = '22222222-2222-2222-2222-222222222222'
const EXPECTED_BUCKET = 'cs-cust-deadbeef0000abcdef01'

const BUCKET_META = {
  name: EXPECTED_BUCKET,
  location: 'APAC',
  creation_date: '2026-04-23T00:00:00Z',
}

const TOKEN = {
  token_id: 'ttt-12345',
  access_key_id: 'ttt-12345',
  secret_access_key: 'a'.repeat(64),
}

const GOOD_PROBE = {
  ok: true as const,
  probeId: 'cs-verify-probe-id',
  durationMs: 800,
}

const BAD_PROBE = {
  ok: false as const,
  probeId: 'cs-verify-bad-id',
  durationMs: 240,
  failedStep: 'put' as const,
  error: '401 Unauthorized',
}

// ── Helpers ──────────────────────────────────────────────────────────────
function mkDeps(overrides: Partial<import('@/lib/storage/provision-org').ProvisionDeps> = {}) {
  return {
    deriveBucketName: vi.fn(() => EXPECTED_BUCKET),
    createBucket: vi.fn(async () => BUCKET_META),
    createBucketScopedToken: vi.fn(async () => TOKEN),
    revokeBucketToken: vi.fn(async () => undefined),
    runVerificationProbe: vi.fn(async () => GOOD_PROBE),
    r2Endpoint: vi.fn(() => 'https://acct.r2.cloudflarestorage.com'),
    sleep: vi.fn(async () => undefined),
    ...overrides,
  }
}

beforeEach(() => {
  vi.stubEnv('MASTER_ENCRYPTION_KEY', 'master-key-for-tests-only-32-bytes')
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})

async function load() {
  return await import('@/lib/storage/provision-org')
}

// ═══════════════════════════════════════════════════════════════════════
// Happy path
// ═══════════════════════════════════════════════════════════════════════
describe('provisionStorageForOrg — happy path', () => {
  it('fresh org: creates bucket + mints token + probes + encrypts + upserts', async () => {
    const { provisionStorageForOrg } = await load()
    const pg = createPgStub([
      [], // 1. select existing config: none
      [{ encryption_salt: ORG_SALT }], // 2. deriveOrgKey select
      [{ encrypt_secret: Buffer.from('ciphertext-bytes') }], // 3. encrypt_secret call
      [{ id: CONFIG_ID }], // 4. upsert returning id
    ])
    const deps = mkDeps()
    const result = await provisionStorageForOrg(pg, ORG_ID, deps)

    expect(result.status).toBe('provisioned')
    expect(result.configId).toBe(CONFIG_ID)
    expect(result.bucketName).toBe(EXPECTED_BUCKET)
    expect(result.probe?.ok).toBe(true)

    // CF calls made in order: bucket → token → probe (and propagation sleep between).
    expect(deps.createBucket).toHaveBeenCalledWith(EXPECTED_BUCKET, 'apac')
    expect(deps.createBucketScopedToken).toHaveBeenCalledWith(EXPECTED_BUCKET)
    expect(deps.sleep).toHaveBeenCalledWith(5000)
    expect(deps.runVerificationProbe).toHaveBeenCalledOnce()

    // Verify the probe received the S3 config we expected.
    const probeMock = deps.runVerificationProbe as ReturnType<typeof vi.fn>
    const probeArg = probeMock.mock.calls[0][0]
    expect(probeArg).toMatchObject({
      provider: 'cs_managed_r2',
      bucket: EXPECTED_BUCKET,
      region: 'auto',
      accessKeyId: TOKEN.access_key_id,
      secretAccessKey: TOKEN.secret_access_key,
    })

    // Revoke was not called on success.
    expect(deps.revokeBucketToken).not.toHaveBeenCalled()

    // 4 DB round-trips (no failure-insert).
    expect((pg as unknown as { calls: StubCall[] }).calls).toHaveLength(4)
  })
})

// ═══════════════════════════════════════════════════════════════════════
// Idempotency — already-verified row short-circuits
// ═══════════════════════════════════════════════════════════════════════
describe('provisionStorageForOrg — idempotency', () => {
  it('already_verified row: short-circuits; no CF calls at all', async () => {
    const { provisionStorageForOrg } = await load()
    const pg = createPgStub([
      [{ id: CONFIG_ID, is_verified: true }], // existing + verified
    ])
    const deps = mkDeps()
    const result = await provisionStorageForOrg(pg, ORG_ID, deps)

    expect(result.status).toBe('already_provisioned')
    expect(result.configId).toBe(CONFIG_ID)
    expect(result.bucketName).toBe(EXPECTED_BUCKET)
    expect(result.probe).toBeUndefined()

    expect(deps.createBucket).not.toHaveBeenCalled()
    expect(deps.createBucketScopedToken).not.toHaveBeenCalled()
    expect(deps.runVerificationProbe).not.toHaveBeenCalled()
    // Only the SELECT existing-config ran.
    expect((pg as unknown as { calls: StubCall[] }).calls).toHaveLength(1)
  })

  it('existing row with is_verified=false: full re-provision runs', async () => {
    const { provisionStorageForOrg } = await load()
    const pg = createPgStub([
      [{ id: CONFIG_ID, is_verified: false }], // exists but not verified
      [{ encryption_salt: ORG_SALT }],
      [{ encrypt_secret: Buffer.from('ciphertext-bytes') }],
      [{ id: CONFIG_ID }],
    ])
    const deps = mkDeps()
    const result = await provisionStorageForOrg(pg, ORG_ID, deps)

    expect(result.status).toBe('provisioned')
    expect(deps.createBucket).toHaveBeenCalledOnce()
    expect(deps.createBucketScopedToken).toHaveBeenCalledOnce()
    expect(deps.runVerificationProbe).toHaveBeenCalledOnce()
  })
})

// ═══════════════════════════════════════════════════════════════════════
// Verification-failure path
// ═══════════════════════════════════════════════════════════════════════
describe('provisionStorageForOrg — probe failure', () => {
  it('probe returns ok=false: inserts verification_failures row + revokes token + does NOT upsert config', async () => {
    const { provisionStorageForOrg } = await load()
    const pg = createPgStub([
      [], // select existing config
      [], // insert verification_failures (no returning)
    ])
    const deps = mkDeps({ runVerificationProbe: vi.fn(async () => BAD_PROBE) })
    const result = await provisionStorageForOrg(pg, ORG_ID, deps)

    expect(result.status).toBe('verification_failed')
    expect(result.configId).toBeNull()
    expect(result.bucketName).toBe(EXPECTED_BUCKET)
    expect(result.probe).toMatchObject({ ok: false, failedStep: 'put' })

    expect(deps.revokeBucketToken).toHaveBeenCalledWith(TOKEN.token_id)

    // Did not call encrypt_secret or upsert.
    const calls = (pg as unknown as { calls: StubCall[] }).calls
    expect(calls).toHaveLength(2)
    expect(calls[1].query).toContain('export_verification_failures')
  })

  it('probe failure + revoke throws: probe-failure status still returned (revoke is best-effort)', async () => {
    const { provisionStorageForOrg } = await load()
    const pg = createPgStub([[], []])
    const deps = mkDeps({
      runVerificationProbe: vi.fn(async () => BAD_PROBE),
      revokeBucketToken: vi.fn(async () => {
        throw new Error('CF API 500')
      }),
    })
    const result = await provisionStorageForOrg(pg, ORG_ID, deps)
    expect(result.status).toBe('verification_failed')
  })
})

// ═══════════════════════════════════════════════════════════════════════
// Config errors
// ═══════════════════════════════════════════════════════════════════════
describe('provisionStorageForOrg — config errors', () => {
  it('MASTER_ENCRYPTION_KEY missing → throws', async () => {
    vi.stubEnv('MASTER_ENCRYPTION_KEY', '')
    const { provisionStorageForOrg } = await load()
    const pg = createPgStub([
      [],
      [{ encryption_salt: ORG_SALT }],
    ])
    await expect(
      provisionStorageForOrg(pg, ORG_ID, mkDeps()),
    ).rejects.toThrow('MASTER_ENCRYPTION_KEY')
  })

  it('org has no encryption_salt → throws', async () => {
    const { provisionStorageForOrg } = await load()
    const pg = createPgStub([
      [],
      [], // no org row
    ])
    await expect(
      provisionStorageForOrg(pg, ORG_ID, mkDeps()),
    ).rejects.toThrow('missing encryption_salt')
  })
})

// ═══════════════════════════════════════════════════════════════════════
// CF-level errors propagate (library handles retry/409 internally)
// ═══════════════════════════════════════════════════════════════════════
describe('provisionStorageForOrg — CF errors surface', () => {
  it('createBucket throws auth error: propagates', async () => {
    const { provisionStorageForOrg, CfProvisionError } = await load()
    const pg = createPgStub([[]])
    const deps = mkDeps({
      createBucket: vi.fn(async () => {
        throw new CfProvisionError('CF API 401 on /accounts', 'auth')
      }),
    })
    await expect(
      provisionStorageForOrg(pg, ORG_ID, deps),
    ).rejects.toBeInstanceOf(CfProvisionError)
  })

  it('createBucketScopedToken throws server error: propagates + bucket stays created', async () => {
    const { provisionStorageForOrg, CfProvisionError } = await load()
    const pg = createPgStub([[]])
    const deps = mkDeps({
      createBucketScopedToken: vi.fn(async () => {
        throw new CfProvisionError('CF API 500', 'server')
      }),
    })
    await expect(
      provisionStorageForOrg(pg, ORG_ID, deps),
    ).rejects.toBeInstanceOf(CfProvisionError)
    // Bucket was created but token mint failed — caller retry will 409-reuse.
    expect(deps.createBucket).toHaveBeenCalledOnce()
  })
})
