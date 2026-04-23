// ADR-1025 Phase 1 Sprint 1.3 — verification probe for any storage config.
//
// Runs a PUT → GET → content-hash → DELETE round-trip against the given
// S3-compatible bucket with the given credentials. Used by:
//
//   · Phase 2 Sprint 2.1 auto-provisioning — immediately after a new
//     CS-managed bucket + token are created; success flips the
//     export_configurations row's is_verified=true.
//   · Phase 3 Sprint 3.1 BYOK validation — runs against user-supplied
//     credentials before persisting.
//   · Phase 4 Sprint 4.1 nightly verify cron — re-runs against every
//     is_verified=true row; catches silently-revoked BYOK tokens.
//
// The probe's sentinel is a canonical JSON blob carrying a probe id,
// storage provider tag, timestamp, and cs_version. Never PII, never
// customer data. Random 12-byte object key (`cs-verify-<hex>.txt`) so
// concurrent probes from different orgs cannot collide.

import { createHash, randomBytes } from 'node:crypto'
import { deleteObject, presignGet, putObject } from './sigv4'

export interface StorageConfig {
  provider: 'cs_managed_r2' | 'customer_r2' | 'customer_s3'
  endpoint: string
  region: string
  bucket: string
  accessKeyId: string
  secretAccessKey: string
}

export type ProbeStep = 'put' | 'get' | 'content_hash' | 'delete'

export interface ProbeResult {
  ok: boolean
  probeId: string
  durationMs: number
  failedStep?: ProbeStep
  error?: string
}

// Dependency-injection surface for testability. Each slot defaults to the
// real implementation; tests override with mocks.
export interface ProbeDeps {
  putObject?: typeof putObject
  presignGet?: typeof presignGet
  deleteObject?: typeof deleteObject
  fetchFn?: typeof fetch
  now?: () => number
  randomBytesFn?: (n: number) => Buffer
}

export async function runVerificationProbe(
  config: StorageConfig,
  deps: ProbeDeps = {},
): Promise<ProbeResult> {
  const now = deps.now ?? (() => Date.now())
  const rb = deps.randomBytesFn ?? randomBytes
  const doPut = deps.putObject ?? putObject
  const doPresign = deps.presignGet ?? presignGet
  const doDelete = deps.deleteObject ?? deleteObject
  const fetchFn = deps.fetchFn ?? fetch

  const probeId = 'cs-verify-' + rb(12).toString('hex')
  const key = probeId + '.txt'
  const bodyJson = JSON.stringify({
    probe_id: probeId,
    storage_provider: config.provider,
    timestamp: new Date(now()).toISOString(),
    cs_version: '1',
  })
  const bodyBuf = Buffer.from(bodyJson, 'utf8')
  const expectedHash = createHash('sha256').update(bodyBuf).digest('hex')
  const started = now()

  const sigv4Opts = {
    endpoint: config.endpoint,
    region: config.region,
    bucket: config.bucket,
    key,
    accessKeyId: config.accessKeyId,
    secretAccessKey: config.secretAccessKey,
  }

  // 1. PUT — if this fails, credentials / bucket / network is broken.
  try {
    await doPut({
      ...sigv4Opts,
      body: bodyBuf,
      contentType: 'application/json; charset=utf-8',
    })
  } catch (err) {
    return {
      ok: false,
      probeId,
      durationMs: now() - started,
      failedStep: 'put',
      error: errorMessage(err),
    }
  }

  // 2. GET — presigned URL + fetch. Retrieves the bytes so we can hash
  // compare (ETag can differ from body sha256 on multipart uploads).
  let fetched: Uint8Array
  try {
    const url = doPresign({ ...sigv4Opts, expiresIn: 300 })
    const response = await fetchFn(url)
    if (!response.ok) {
      return {
        ok: false,
        probeId,
        durationMs: now() - started,
        failedStep: 'get',
        error: `HTTP ${response.status}`,
      }
    }
    fetched = new Uint8Array(await response.arrayBuffer())
  } catch (err) {
    return {
      ok: false,
      probeId,
      durationMs: now() - started,
      failedStep: 'get',
      error: errorMessage(err),
    }
  }

  // 3. Content-hash check — catches a silent-truncation / silent-rewrite
  // bug that 200+ETag-match wouldn't surface.
  const actualHash = createHash('sha256').update(Buffer.from(fetched)).digest('hex')
  if (actualHash !== expectedHash) {
    return {
      ok: false,
      probeId,
      durationMs: now() - started,
      failedStep: 'content_hash',
      error: `expected sha256=${expectedHash}, got sha256=${actualHash}`,
    }
  }

  // 4. DELETE the sentinel. If DELETE fails, the probe is still ok=true —
  // the bucket's lifecycle policy will sweep cs-verify-* objects. Record
  // the failure so the operator can see it in the returned envelope.
  try {
    await doDelete(sigv4Opts)
  } catch (err) {
    return {
      ok: true,
      probeId,
      durationMs: now() - started,
      failedStep: 'delete',
      error: errorMessage(err),
    }
  }

  return { ok: true, probeId, durationMs: now() - started }
}

function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message
  return String(err)
}
