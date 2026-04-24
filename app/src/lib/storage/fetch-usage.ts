// ADR-1025 Phase 4 Sprint 4.2 — monthly storage usage snapshot capture.
//
// Runs once a month via pg_cron. For every cs_managed_r2 org:
//   1. Load export_configurations + org plan_code + plans.storage_bytes_limit
//   2. Call CF R2 usage API: GET /accounts/{id}/r2/buckets/{bucket}/usage
//   3. UPSERT a storage_usage_snapshots row (unique on org_id + snapshot_date)
//   4. If over-ceiling, insert an ops_readiness_flag so sales can outreach
//
// Customer-BYOK buckets are NOT captured — the usage API is account-scoped
// and we don't have customer credentials. BYOK orgs get their own usage
// panel by pointing at their own CF/AWS console (documented in the
// dashboard storage panel).

import type postgres from 'postgres'

type Pg = ReturnType<typeof postgres>

const FETCH_TIMEOUT_MS = 15_000
const TIME_BUDGET_MS = 270_000

export interface UsageSnapshotSummary {
  captured: number
  failed: number
  over_ceiling: number
  budget_exceeded: boolean
  failures: Array<{ org_id: string; bucket: string; error: string }>
}

export interface UsageSnapshotDeps {
  fetchFn?: typeof fetch
  now?: () => number
  nowDate?: () => Date
}

interface OrgConfig {
  org_id: string
  bucket_name: string
  storage_provider: string
  plan_code: string | null
  plan_ceiling_bytes: string | number | null
}

interface CfUsageResponse {
  success: boolean
  result?: {
    payloadSize: string | number
    metadataSize: string | number
    objectCount: string | number
  }
  errors?: Array<{ message: string }>
}

export async function captureStorageUsageSnapshots(
  pg: Pg,
  deps: UsageSnapshotDeps = {},
): Promise<UsageSnapshotSummary> {
  const fetchFn = deps.fetchFn ?? fetch
  const now = deps.now ?? Date.now
  const nowDate = deps.nowDate ?? (() => new Date())
  const started = now()

  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID
  const accountToken = process.env.CLOUDFLARE_ACCOUNT_API_TOKEN
  if (!accountId || !accountToken) {
    throw new Error(
      'CLOUDFLARE_ACCOUNT_ID + CLOUDFLARE_ACCOUNT_API_TOKEN must be set',
    )
  }

  // Join export_configurations with plans to snapshot the ceiling at
  // capture time.
  const rows = await pg<OrgConfig[]>`
    select
      ec.org_id,
      ec.bucket_name,
      ec.storage_provider,
      a.plan_code,
      p.storage_bytes_limit as plan_ceiling_bytes
    from public.export_configurations ec
    join public.organisations o on o.id = ec.org_id
    left join public.accounts a on a.id = o.account_id
    left join public.plans p on p.plan_code = a.plan_code
    where ec.storage_provider = 'cs_managed_r2'
  `

  const snapshotDate = nowDate().toISOString().slice(0, 10)
  const summary: UsageSnapshotSummary = {
    captured: 0,
    failed: 0,
    over_ceiling: 0,
    budget_exceeded: false,
    failures: [],
  }

  for (const row of rows) {
    if (now() - started > TIME_BUDGET_MS) {
      summary.budget_exceeded = true
      break
    }

    try {
      const usage = await fetchUsage(
        accountId,
        accountToken,
        row.bucket_name,
        fetchFn,
      )
      const payload = toInt(usage.result?.payloadSize)
      const metadata = toInt(usage.result?.metadataSize)
      const count = toInt(usage.result?.objectCount)
      const ceiling = toIntOrNull(row.plan_ceiling_bytes)
      const isOver = ceiling !== null && payload + metadata > ceiling

      await pg`
        insert into public.storage_usage_snapshots
          (org_id, snapshot_date, storage_provider, bucket_name,
           payload_bytes, metadata_bytes, object_count,
           plan_code, plan_ceiling_bytes)
        values (
          ${row.org_id}, ${snapshotDate}, ${row.storage_provider},
          ${row.bucket_name},
          ${payload}, ${metadata}, ${count},
          ${row.plan_code}, ${ceiling}
        )
        on conflict (org_id, snapshot_date) do update set
          payload_bytes      = excluded.payload_bytes,
          metadata_bytes     = excluded.metadata_bytes,
          object_count       = excluded.object_count,
          plan_code          = excluded.plan_code,
          plan_ceiling_bytes = excluded.plan_ceiling_bytes,
          captured_at        = now(),
          error_text         = null
      `

      summary.captured++
      if (isOver) summary.over_ceiling++
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      summary.failed++
      summary.failures.push({
        org_id: row.org_id,
        bucket: row.bucket_name,
        error: msg,
      })
      // Record the failure so the admin widget shows the missing data.
      await pg`
        insert into public.storage_usage_snapshots
          (org_id, snapshot_date, storage_provider, bucket_name,
           plan_code, plan_ceiling_bytes, error_text)
        values (
          ${row.org_id}, ${snapshotDate}, ${row.storage_provider},
          ${row.bucket_name},
          ${row.plan_code}, ${toIntOrNull(row.plan_ceiling_bytes)},
          ${msg.slice(0, 2000)}
        )
        on conflict (org_id, snapshot_date) do update set
          error_text  = excluded.error_text,
          captured_at = now()
      `.catch(() => undefined)
    }
  }

  return summary
}

async function fetchUsage(
  accountId: string,
  accountToken: string,
  bucketName: string,
  fetchFn: typeof fetch,
): Promise<CfUsageResponse> {
  const ac = new AbortController()
  const timer = setTimeout(() => ac.abort(), FETCH_TIMEOUT_MS)
  try {
    const resp = await fetchFn(
      `https://api.cloudflare.com/client/v4/accounts/${accountId}/r2/buckets/${bucketName}/usage`,
      {
        method: 'GET',
        headers: { Authorization: `Bearer ${accountToken}` },
        signal: ac.signal,
      },
    )
    if (!resp.ok) {
      throw new Error(
        `CF usage API ${resp.status}: ${(await resp.text()).slice(0, 300)}`,
      )
    }
    const json = (await resp.json()) as CfUsageResponse
    if (!json.success) {
      throw new Error(
        `CF usage API returned success=false: ${(json.errors ?? [])
          .map((e) => e.message)
          .join(', ')}`,
      )
    }
    return json
  } finally {
    clearTimeout(timer)
  }
}

function toInt(v: string | number | undefined): number {
  if (v === undefined || v === null) return 0
  if (typeof v === 'number') return Math.trunc(v)
  const parsed = Number.parseInt(v, 10)
  return Number.isFinite(parsed) ? parsed : 0
}

function toIntOrNull(v: string | number | null | undefined): number | null {
  if (v === null || v === undefined) return null
  return toInt(v)
}
