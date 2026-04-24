// ADR-1019 Sprint 2.1 — deliverOne unit tests.
//
// Stubs:
//   · pg — queue-based tagged-template stub, supports pg.begin(cb) by
//     reusing the same callable for tx.
//   · putObject — overridden via deps.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { deliverOne } from '@/lib/delivery/deliver-events'

type StubResponses = Array<unknown[] | Error>

interface StubFn {
  (strings: TemplateStringsArray, ...values: unknown[]): Promise<unknown[]>
  begin: (cb: (tx: unknown) => Promise<void>) => Promise<void>
  calls: Array<{ query: string; values: unknown[] }>
}

function makePgStub(responses: StubResponses) {
  const calls: Array<{ query: string; values: unknown[] }> = []
  let i = 0
  const fn = ((strings: TemplateStringsArray, ...values: unknown[]) => {
    calls.push({ query: strings.join('?'), values })
    if (i >= responses.length) {
      return Promise.reject(
        new Error(`pg stub: unexpected call #${i + 1} — queue exhausted`),
      )
    }
    const next = responses[i++]
    if (next instanceof Error) return Promise.reject(next)
    return Promise.resolve(next as unknown[])
  }) as unknown as StubFn
  fn.begin = async (cb) => {
    await cb(fn)
  }
  fn.calls = calls
  return fn
}

// ── Fixtures ─────────────────────────────────────────────────────────────
const ROW_ID = '11111111-2222-4333-8444-555555555555'
const ORG_ID = '99999999-2222-4333-8444-000000000001'
const EC_ID = 'ec000000-2222-4333-8444-aaaaaaaaaaaa'
const SALT = 'test-salt'
const BUCKET = 'cs-cust-acme'
const ACCOUNT_ID = 'cf-acct-test'
const CREDS = { access_key_id: 'AKIA_TEST', secret_access_key: 'shh-secret' }

function joinedRow(overrides: Record<string, unknown> = {}) {
  return {
    id: ROW_ID,
    org_id: ORG_ID,
    event_type: 'consent_event',
    payload: { b: 2, a: 1 },
    attempt_count: 0,
    first_attempted_at: null,
    delivered_at: null,
    created_at: new Date('2026-04-24T10:00:00.000Z'),
    ec_id: EC_ID,
    ec_bucket_name: BUCKET,
    ec_path_prefix: 'acme/',
    ec_region: 'auto',
    ec_storage_provider: 'cs_managed_r2',
    ec_write_credential_enc: Buffer.from('encrypted'),
    ec_is_verified: true,
    ...overrides,
  }
}

beforeEach(() => {
  vi.unstubAllEnvs()
  vi.stubEnv('MASTER_ENCRYPTION_KEY', 'test-master-key')
  vi.stubEnv('CLOUDFLARE_ACCOUNT_ID', ACCOUNT_ID)
})

afterEach(() => {
  vi.unstubAllEnvs()
})

// ─────────────────────────────────────────────────────────────────────────
describe('deliverOne', () => {
  it('returns not_found when the row does not exist', async () => {
    const pg = makePgStub([[]])
    const result = await deliverOne(pg, ROW_ID, { putObject: vi.fn() })
    expect(result.outcome).toBe('not_found')
    expect(pg.calls).toHaveLength(1)
  })

  it('returns already_delivered when delivered_at is set', async () => {
    const pg = makePgStub([[joinedRow({ delivered_at: new Date() })]])
    const putObject = vi.fn()
    const result = await deliverOne(pg, ROW_ID, { putObject })
    expect(result.outcome).toBe('already_delivered')
    expect(putObject).not.toHaveBeenCalled()
  })

  it('quarantines rows with no export_config', async () => {
    const pg = makePgStub([
      [joinedRow({ ec_id: null, ec_write_credential_enc: null })],
      [], // markFailure update
    ])
    const putObject = vi.fn()
    const result = await deliverOne(pg, ROW_ID, { putObject })
    expect(result.outcome).toBe('no_export_config')
    expect(result.error).toBe('no_export_config')
    expect(putObject).not.toHaveBeenCalled()
    expect(pg.calls[1]!.query).toContain('update public.delivery_buffer')
  })

  it('quarantines rows whose export_config is not verified', async () => {
    const pg = makePgStub([
      [joinedRow({ ec_is_verified: false })],
      [], // markFailure update
    ])
    const putObject = vi.fn()
    const result = await deliverOne(pg, ROW_ID, { putObject })
    expect(result.outcome).toBe('unverified_export_config')
    expect(putObject).not.toHaveBeenCalled()
  })

  it('records endpoint_failed when provider is unsupported', async () => {
    const pg = makePgStub([
      [joinedRow({ ec_storage_provider: 'customer_r2' })],
      [], // markFailure update
    ])
    const putObject = vi.fn()
    const result = await deliverOne(pg, ROW_ID, { putObject })
    expect(result.outcome).toBe('endpoint_failed')
    expect(result.error).toMatch(/customer_r2/)
    expect(putObject).not.toHaveBeenCalled()
  })

  it('records decrypt_failed when decrypt_secret returns empty', async () => {
    const pg = makePgStub([
      [joinedRow()],
      [{ encryption_salt: SALT }],            // deriveOrgKey
      [{ decrypt_secret: null }],             // decryptCredentials — empty
      [],                                      // markFailure update
    ])
    const putObject = vi.fn()
    const result = await deliverOne(pg, ROW_ID, { putObject })
    expect(result.outcome).toBe('decrypt_failed')
    expect(putObject).not.toHaveBeenCalled()
  })

  it('records upload_failed when putObject throws', async () => {
    const pg = makePgStub([
      [joinedRow()],
      [{ encryption_salt: SALT }],
      [{ decrypt_secret: JSON.stringify(CREDS) }],
      [], // markFailure
    ])
    const putObject = vi.fn().mockRejectedValue(
      new Error('R2 PUT failed: 403 Forbidden'),
    )
    const result = await deliverOne(pg, ROW_ID, { putObject })
    expect(result.outcome).toBe('upload_failed')
    expect(result.error).toMatch(/403/)
    expect(putObject).toHaveBeenCalledTimes(1)
    // Last pg call must be the markFailure UPDATE (not a DELETE).
    const last = pg.calls[pg.calls.length - 1]!
    expect(last.query).toContain('update public.delivery_buffer')
    expect(last.query).not.toContain('delete')
  })

  it('delivers the happy path — PUT + UPDATE delivered_at + DELETE', async () => {
    const pg = makePgStub([
      [joinedRow()],
      [{ encryption_salt: SALT }],
      [{ decrypt_secret: JSON.stringify(CREDS) }],
      [], // tx UPDATE delivered_at
      [], // tx DELETE
    ])
    const putObject = vi.fn().mockResolvedValue({ status: 200, etag: '"abc"' })
    const result = await deliverOne(pg, ROW_ID, { putObject })

    expect(result.outcome).toBe('delivered')
    expect(result.bucket).toBe(BUCKET)
    expect(result.objectKey).toBe(
      `acme/consent_event/2026/04/24/${ROW_ID}.json`,
    )
    expect(putObject).toHaveBeenCalledTimes(1)

    const putArgs = putObject.mock.calls[0]![0]
    expect(putArgs.endpoint).toBe(
      `https://${ACCOUNT_ID}.r2.cloudflarestorage.com`,
    )
    expect(putArgs.bucket).toBe(BUCKET)
    expect(putArgs.accessKeyId).toBe(CREDS.access_key_id)
    expect(putArgs.secretAccessKey).toBe(CREDS.secret_access_key)
    expect(putArgs.contentType).toBe('application/json; charset=utf-8')

    // Canonical body — keys sorted + trailing LF.
    expect(putArgs.body.toString('utf8')).toBe('{"a":1,"b":2}\n')

    // Metadata headers.
    expect(putArgs.metadata).toEqual({
      'cs-row-id': ROW_ID,
      'cs-org-id': ORG_ID,
      'cs-event-type': 'consent_event',
      'cs-created-at': '2026-04-24T10:00:00.000Z',
    })

    // tx UPDATE + DELETE both ran.
    const queries = pg.calls.map((c) => c.query)
    expect(queries[queries.length - 2]).toContain(
      'update public.delivery_buffer set delivered_at',
    )
    expect(queries[queries.length - 1]).toContain(
      'delete from public.delivery_buffer',
    )
  })
})
