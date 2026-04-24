// ADR-1025 Phase 4 Sprint 4.1 — rotate-org tests.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

function makePgStub(responses: Array<unknown[] | Error>) {
  const calls: Array<{ query: string; values: unknown[] }> = []
  let i = 0
  const fn = ((strings: TemplateStringsArray, ...values: unknown[]) => {
    calls.push({ query: strings.join('?'), values })
    if (i >= responses.length) {
      throw new Error(`pg stub: unexpected call #${i + 1}`)
    }
    const next = responses[i++]
    if (next instanceof Error) return Promise.reject(next)
    return Promise.resolve(next)
  }) as unknown as Parameters<
    typeof import('@/lib/storage/rotate-org').rotateStorageCredentials
  >[0]
  ;(fn as unknown as { calls: Array<{ query: string; values: unknown[] }> }).calls = calls
  return fn
}

const ORG_ID = 'org-fixture'
const SALT = 'fixture-salt'
const OLD_CREDS = JSON.stringify({
  access_key_id: 'AKIA_OLD',
  secret_access_key: 'secret-old',
  token_id: 'old-token-id',
})

function configRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'cfg-1',
    org_id: ORG_ID,
    storage_provider: 'cs_managed_r2',
    bucket_name: 'cs-cust-bucket',
    region: 'auto',
    write_credential_enc: Buffer.from('cipher-old'),
    ...overrides,
  }
}

function mkDeps(
  overrides: Partial<
    import('@/lib/storage/rotate-org').RotateDeps
  > = {},
) {
  return {
    createBucketScopedToken: vi.fn(async () => ({
      token_id: 'new-token-id',
      access_key_id: 'AKIA_NEW',
      secret_access_key: 'secret-new',
    })),
    revokeBucketToken: vi.fn(async () => undefined),
    runVerificationProbe: vi.fn(async () => ({
      ok: true as const,
      probeId: 'p',
      durationMs: 300,
    })),
    r2Endpoint: vi.fn(() => 'https://test-acct.r2.cloudflarestorage.com'),
    sleep: vi.fn(async () => undefined),
    ...overrides,
  }
}

beforeEach(() => {
  vi.stubEnv('MASTER_ENCRYPTION_KEY', 'master-for-tests-only-32-bytes')
})
afterEach(() => {
  vi.unstubAllEnvs()
  vi.resetModules()
})

async function load() {
  return await import('@/lib/storage/rotate-org')
}

describe('rotateStorageCredentials', () => {
  it('not_found when no export_configurations row', async () => {
    const { rotateStorageCredentials } = await load()
    const pg = makePgStub([[]])
    const result = await rotateStorageCredentials(pg, ORG_ID, mkDeps())
    expect(result.status).toBe('not_found')
  })

  it('not_eligible for BYOK providers', async () => {
    const { rotateStorageCredentials } = await load()
    const pg = makePgStub([[configRow({ storage_provider: 'customer_r2' })]])
    const result = await rotateStorageCredentials(pg, ORG_ID, mkDeps())
    expect(result.status).toBe('not_eligible')
  })

  it('happy path: mints new token, probes, swaps, revokes old', async () => {
    const { rotateStorageCredentials } = await load()
    const pg = makePgStub([
      [configRow()],                           // load cfg
      [{ encryption_salt: SALT }],             // deriveOrgKey
      [{ decrypt_secret: OLD_CREDS }],         // decrypt old
      [{ encrypt_secret: Buffer.from('new-cipher') }], // encrypt new
      [],                                      // update export_configurations
    ])
    const deps = mkDeps()
    const result = await rotateStorageCredentials(pg, ORG_ID, deps)
    expect(result.status).toBe('rotated')
    expect(result.old_token_id).toBe('old-token-id')
    expect(result.new_token_id).toBe('new-token-id')
    expect(deps.createBucketScopedToken).toHaveBeenCalledWith('cs-cust-bucket')
    expect(deps.sleep).toHaveBeenCalledWith(5000)
    // Old token revoked.
    expect(deps.revokeBucketToken).toHaveBeenCalledWith('old-token-id')
  })

  it('probe failure → revokes NEW token, leaves old in place, records error', async () => {
    const { rotateStorageCredentials } = await load()
    const pg = makePgStub([
      [configRow()],
      [{ encryption_salt: SALT }],
      [{ decrypt_secret: OLD_CREDS }],
      // No encrypt, no swap update. Just the recordRotationError update.
      [],
    ])
    const deps = mkDeps({
      runVerificationProbe: vi.fn(async () => ({
        ok: false as const,
        probeId: 'p',
        durationMs: 200,
        failedStep: 'put' as const,
        error: '401',
      })),
    })
    const result = await rotateStorageCredentials(pg, ORG_ID, deps)
    expect(result.status).toBe('failed')
    expect(result.error).toMatch(/probe failed at put/)
    // New token revoked, old NOT touched.
    expect(deps.revokeBucketToken).toHaveBeenCalledWith('new-token-id')
    expect(deps.revokeBucketToken).not.toHaveBeenCalledWith('old-token-id')
  })

  it('encrypt failure → rolls back by revoking new token', async () => {
    const { rotateStorageCredentials } = await load()
    const pg = makePgStub([
      [configRow()],
      [{ encryption_salt: SALT }],
      [{ decrypt_secret: OLD_CREDS }],
      new Error('encrypt_secret failed'), // encrypt throws
      // recordRotationError update
      [],
    ])
    const deps = mkDeps()
    const result = await rotateStorageCredentials(pg, ORG_ID, deps)
    expect(result.status).toBe('failed')
    expect(deps.revokeBucketToken).toHaveBeenCalledWith('new-token-id')
    expect(deps.revokeBucketToken).not.toHaveBeenCalledWith('old-token-id')
  })

  it('revoke-old failure is swallowed (best-effort)', async () => {
    const { rotateStorageCredentials } = await load()
    const pg = makePgStub([
      [configRow()],
      [{ encryption_salt: SALT }],
      [{ decrypt_secret: OLD_CREDS }],
      [{ encrypt_secret: Buffer.from('new-cipher') }],
      [],
    ])
    const deps = mkDeps({
      revokeBucketToken: vi.fn(async (tokenId: string) => {
        if (tokenId === 'old-token-id') throw new Error('CF 500')
        return undefined
      }),
    })
    const result = await rotateStorageCredentials(pg, ORG_ID, deps)
    // Still rotated despite revoke failure.
    expect(result.status).toBe('rotated')
  })
})
