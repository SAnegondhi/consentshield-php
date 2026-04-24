// ADR-1025 Phase 4 Sprint 4.1 — nightly verify tests.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// ── pg stub with pg.begin support ────────────────────────────────────────
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
    typeof import('@/lib/storage/nightly-verify').verifyAllVerifiedConfigs
  >[0] & { begin: (cb: (tx: unknown) => Promise<void>) => Promise<void> }
  fn.begin = async (cb: (tx: unknown) => Promise<void>) => {
    await cb(fn)
  }
  ;(fn as unknown as { calls: Array<{ query: string; values: unknown[] }> }).calls = calls
  return fn
}

const ACCOUNT_ID = 'test-account-id-0001'
const SALT = 'fixture-salt'
const DECRYPTED = JSON.stringify({
  access_key_id: 'AKIA_X',
  secret_access_key: 'secret-x',
  token_id: 'tok-old',
})

function configRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'cfg-1',
    org_id: 'org-1',
    storage_provider: 'cs_managed_r2',
    bucket_name: 'cs-cust-bucket',
    region: 'auto',
    write_credential_enc: Buffer.from('cipher'),
    ...overrides,
  }
}

beforeEach(() => {
  vi.stubEnv('MASTER_ENCRYPTION_KEY', 'master-for-tests-only-32-bytes')
  vi.stubEnv('CLOUDFLARE_ACCOUNT_ID', ACCOUNT_ID)
})
afterEach(() => {
  vi.unstubAllEnvs()
  vi.resetModules()
})

async function load() {
  return await import('@/lib/storage/nightly-verify')
}

describe('verifyAllVerifiedConfigs', () => {
  it('zero verified rows → checked=0, failed=0, succeeded=0', async () => {
    const { verifyAllVerifiedConfigs } = await load()
    const pg = makePgStub([[]])
    const summary = await verifyAllVerifiedConfigs(pg, {
      runVerificationProbe: vi.fn(),
    })
    expect(summary).toEqual({
      checked: 0,
      failed: 0,
      succeeded: 0,
      budget_exceeded: false,
      failures: [],
    })
  })

  it('all rows pass → succeeded counter increments', async () => {
    const { verifyAllVerifiedConfigs } = await load()
    const pg = makePgStub([
      [configRow({ id: 'c1', org_id: 'o1' }), configRow({ id: 'c2', org_id: 'o2' })],
      // For org o1: salt lookup, decrypt
      [{ encryption_salt: SALT }],
      [{ decrypt_secret: DECRYPTED }],
      // For org o2: salt lookup, decrypt
      [{ encryption_salt: SALT }],
      [{ decrypt_secret: DECRYPTED }],
    ])
    const probe = vi.fn(async () => ({
      ok: true as const,
      probeId: 'p',
      durationMs: 100,
    }))
    const summary = await verifyAllVerifiedConfigs(pg, {
      runVerificationProbe: probe,
    })
    expect(summary.checked).toBe(2)
    expect(summary.succeeded).toBe(2)
    expect(summary.failed).toBe(0)
    expect(probe).toHaveBeenCalledTimes(2)
  })

  it('probe failure → flips is_verified=false + records failure', async () => {
    const { verifyAllVerifiedConfigs } = await load()
    const pg = makePgStub([
      [configRow()],
      [{ encryption_salt: SALT }],
      [{ decrypt_secret: DECRYPTED }],
      // recordFailure tx: two updates via tx`` which routes through same stub
      [],  // update export_configurations
      [],  // insert export_verification_failures
    ])
    const probe = vi.fn(async () => ({
      ok: false as const,
      probeId: 'p',
      durationMs: 200,
      failedStep: 'put' as const,
      error: '401',
    }))
    const summary = await verifyAllVerifiedConfigs(pg, {
      runVerificationProbe: probe,
    })
    expect(summary.checked).toBe(1)
    expect(summary.failed).toBe(1)
    expect(summary.succeeded).toBe(0)
    expect(summary.failures[0]).toMatchObject({
      org_id: 'org-1',
      bucket: 'cs-cust-bucket',
      failed_step: 'put',
      error: '401',
    })
    const calls = (pg as unknown as { calls: Array<{ query: string }> }).calls
    // Confirm the failure-recording tx fired two queries.
    expect(calls.some((c) => c.query.includes('export_configurations'))).toBe(true)
    expect(calls.some((c) => c.query.includes('export_verification_failures'))).toBe(true)
  })

  it('decrypt error is recorded as a probe failure (does not throw)', async () => {
    const { verifyAllVerifiedConfigs } = await load()
    const pg = makePgStub([
      [configRow()],
      [{ encryption_salt: SALT }],
      new Error('decrypt_secret boom'),
      // recordFailure tx
      [],
      [],
    ])
    const summary = await verifyAllVerifiedConfigs(pg, {
      runVerificationProbe: vi.fn(),
    })
    expect(summary.failed).toBe(1)
    expect(summary.failures[0].error).toMatch(/decrypt_secret boom/)
  })

  it('budget_exceeded flag set when time runs out mid-sweep', async () => {
    const { verifyAllVerifiedConfigs } = await load()
    const pg = makePgStub([
      [
        configRow({ id: 'c1', org_id: 'o1' }),
        configRow({ id: 'c2', org_id: 'o2' }),
      ],
      [{ encryption_salt: SALT }],
      [{ decrypt_secret: DECRYPTED }],
      // second row never reaches — budget exceeded between rows
    ])
    // 1st call: `started = now()` at entry. 2nd call: iter 1 budget check.
    // 3rd call: iter 2 budget check — jump past the budget here so the
    // loop breaks with budget_exceeded=true after processing row 1.
    let nCalls = 0
    const now = vi.fn(() => {
      nCalls++
      return nCalls <= 2 ? 0 : 400_000
    })
    const probe = vi.fn(async () => ({
      ok: true as const,
      probeId: 'p',
      durationMs: 50,
    }))
    const summary = await verifyAllVerifiedConfigs(pg, {
      runVerificationProbe: probe,
      now,
    })
    expect(summary.checked).toBe(1) // only one row before budget tripped
    expect(summary.budget_exceeded).toBe(true)
  })

  it('unknown provider produces a recorded failure (endpoint derivation error)', async () => {
    const { verifyAllVerifiedConfigs } = await load()
    const pg = makePgStub([
      [configRow({ storage_provider: 'mystery_cloud' })],
      // recordFailure tx
      [],
      [],
    ])
    const summary = await verifyAllVerifiedConfigs(pg, {
      runVerificationProbe: vi.fn(),
    })
    expect(summary.failed).toBe(1)
    expect(summary.failures[0].error).toMatch(/mystery_cloud/)
  })
})
