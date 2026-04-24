// ADR-1025 Phase 4 Sprint 4.1 — nightly verification of all storage configs.
//
// Iterates every export_configurations row with is_verified=true. For
// each, decrypts the stored credentials, runs the 4-step probe against
// the target bucket, and on failure:
//   · flips is_verified=false on the row
//   · INSERTs into public.export_verification_failures (failure history)
//
// Credentials stay in local scope per org; never logged.
//
// Runs as cs_orchestrator (has SELECT + UPDATE on export_configurations,
// INSERT on export_verification_failures, EXECUTE on decrypt_secret).
//
// Scales to ~1000 orgs under Vercel Fluid Compute 300s timeout —
// probe is ~1-2 s per org. Larger populations: add pagination +
// self-re-dispatch (Sprint 4.1b if / when the customer count warrants).

import type postgres from 'postgres'
import { decryptCredentials, deriveOrgKey } from './org-crypto'
import { runVerificationProbe } from './verify'

type Pg = ReturnType<typeof postgres>

const VERIFY_TIME_BUDGET_MS = 270_000 // 4.5 min — stop short of the 300s cap

export interface NightlyVerifySummary {
  checked: number
  failed: number
  succeeded: number
  budget_exceeded: boolean
  failures: Array<{
    org_id: string
    bucket: string
    failed_step: string
    error: string
  }>
}

export interface NightlyVerifyDeps {
  runVerificationProbe?: typeof runVerificationProbe
  now?: () => number
}

interface ConfigRow {
  id: string
  org_id: string
  storage_provider: string
  bucket_name: string
  region: string | null
  write_credential_enc: Buffer
}

export async function verifyAllVerifiedConfigs(
  pg: Pg,
  deps: NightlyVerifyDeps = {},
): Promise<NightlyVerifySummary> {
  const probeFn = deps.runVerificationProbe ?? runVerificationProbe
  const now = deps.now ?? Date.now
  const started = now()

  const rows = await pg<ConfigRow[]>`
    select id, org_id, storage_provider, bucket_name, region, write_credential_enc
      from public.export_configurations
     where is_verified = true
     order by org_id
  `

  const summary: NightlyVerifySummary = {
    checked: 0,
    failed: 0,
    succeeded: 0,
    budget_exceeded: false,
    failures: [],
  }

  for (const row of rows) {
    if (now() - started > VERIFY_TIME_BUDGET_MS) {
      summary.budget_exceeded = true
      break
    }
    summary.checked++

    // Read write_credential_enc + decrypt per-org.
    let endpoint: string
    try {
      endpoint = endpointFor(row)
    } catch (err) {
      await recordFailure(pg, row, 'put', errorMessage(err))
      summary.failed++
      summary.failures.push({
        org_id: row.org_id,
        bucket: row.bucket_name,
        failed_step: 'put',
        error: errorMessage(err),
      })
      continue
    }

    try {
      const derivedKey = await deriveOrgKey(pg, row.org_id)
      const creds = await decryptCredentials(
        pg,
        row.write_credential_enc,
        derivedKey,
      )

      const probe = await probeFn({
        provider: row.storage_provider as 'cs_managed_r2' | 'customer_r2' | 'customer_s3',
        endpoint,
        region: row.region ?? 'auto',
        bucket: row.bucket_name,
        accessKeyId: creds.access_key_id,
        secretAccessKey: creds.secret_access_key,
      })

      if (probe.ok) {
        summary.succeeded++
      } else {
        await recordFailure(
          pg,
          row,
          probe.failedStep ?? 'put',
          probe.error ?? 'unknown',
        )
        summary.failed++
        summary.failures.push({
          org_id: row.org_id,
          bucket: row.bucket_name,
          failed_step: probe.failedStep ?? 'put',
          error: probe.error ?? 'unknown',
        })
      }
    } catch (err) {
      // Any non-probe exception (decrypt error, network blip) counts
      // as a failure — record and continue to the next org so one
      // broken row doesn't stall the sweep.
      await recordFailure(pg, row, 'put', errorMessage(err))
      summary.failed++
      summary.failures.push({
        org_id: row.org_id,
        bucket: row.bucket_name,
        failed_step: 'put',
        error: errorMessage(err),
      })
    }
  }

  return summary
}

async function recordFailure(
  pg: Pg,
  row: ConfigRow,
  failedStep: string,
  errorText: string,
): Promise<void> {
  await pg.begin(async (tx) => {
    await tx`
      update public.export_configurations
         set is_verified = false,
             updated_at  = now()
       where id = ${row.id}
    `
    await tx`
      insert into public.export_verification_failures
        (org_id, export_config_id, probe_id, failed_step,
         error_text, duration_ms, attempted_at)
      values (
        ${row.org_id},
        ${row.id},
        ${'nightly-' + Date.now().toString(36)},
        ${failedStep},
        ${errorText.slice(0, 2000)},
        ${0},
        now()
      )
    `
  })
}

function endpointFor(row: ConfigRow): string {
  // cs_managed_r2 — account-scoped CF R2 endpoint.
  if (row.storage_provider === 'cs_managed_r2') {
    const acct = process.env.CLOUDFLARE_ACCOUNT_ID
    if (!acct) throw new Error('CLOUDFLARE_ACCOUNT_ID not set')
    return `https://${acct}.r2.cloudflarestorage.com`
  }
  // BYOK rows don't store endpoint — derive from region per S3 convention.
  // (Future: persist endpoint on export_configurations; wiring ships when
  // BYOK has its first real customer.)
  const region = row.region ?? 'us-east-1'
  if (row.storage_provider === 'customer_s3') {
    return `https://s3.${region}.amazonaws.com`
  }
  throw new Error(
    `cannot derive endpoint for provider='${row.storage_provider}'`,
  )
}

function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message
  return String(err)
}
