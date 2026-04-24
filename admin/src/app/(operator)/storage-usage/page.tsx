import { createServerClient } from '@/lib/supabase/server'

// ADR-1025 Phase 4 Sprint 4.2 — storage usage + chargeback panel.
//
// Pulls the last 90 days of per-org snapshots from
// admin.storage_usage_snapshots_query (support-gated SECURITY DEFINER
// RPC). Renders one row per most-recent snapshot per org + a
// "historical" drill-down link. Cost estimate uses CF R2 standard
// pricing ($0.015/GB-month storage); class A/B ops not captured yet.

export const dynamic = 'force-dynamic'

const BYTES_PER_GB = 1024 * 1024 * 1024
const USD_PER_GB_MONTH = 0.015

interface SnapshotRow {
  id: string
  org_id: string
  org_name: string
  plan_code: string | null
  snapshot_date: string
  storage_provider: string
  bucket_name: string
  payload_bytes: number
  metadata_bytes: number
  object_count: number
  plan_ceiling_bytes: number | null
  over_ceiling: boolean
  captured_at: string
  error_text: string | null
}

export default async function StorageUsagePage() {
  const supabase = await createServerClient()
  const end = new Date()
  const start = new Date(end.getTime() - 90 * 24 * 3600 * 1000)

  const { data, error } = await supabase.rpc(
    'storage_usage_snapshots_query',
    {
      p_start_date: toISODate(start),
      p_end_date: toISODate(end),
      p_org_id: null,
    },
  )

  if (error) {
    return (
      <main className="p-6">
        <h1 className="text-xl font-semibold">Storage usage</h1>
        <p className="mt-3 text-sm text-red-700">Failed to load: {error.message}</p>
      </main>
    )
  }

  const rows = (data ?? []) as SnapshotRow[]
  // Group by org and keep only the most recent snapshot per org for the
  // primary table. Older snapshots accessible via drill-down (future).
  const byOrg = new Map<string, SnapshotRow>()
  for (const r of rows) {
    const existing = byOrg.get(r.org_id)
    if (!existing || r.snapshot_date > existing.snapshot_date) {
      byOrg.set(r.org_id, r)
    }
  }
  const latest = Array.from(byOrg.values()).sort((a, b) => {
    if (a.over_ceiling !== b.over_ceiling) return a.over_ceiling ? -1 : 1
    return (b.payload_bytes + b.metadata_bytes) - (a.payload_bytes + a.metadata_bytes)
  })

  const totalBytes = latest.reduce(
    (acc, r) => acc + r.payload_bytes + r.metadata_bytes,
    0,
  )
  const estimatedMonthlyUsd = (totalBytes / BYTES_PER_GB) * USD_PER_GB_MONTH

  return (
    <main className="flex-1 p-6 space-y-6">
      <header>
        <h1 className="text-xl font-semibold text-gray-900">Storage usage</h1>
        <p className="mt-1 text-sm text-gray-600">
          Per-org R2 bucket usage captured monthly by the
          <code className="mx-1">storage-usage-snapshot-monthly</code>
          cron. CS-managed buckets only — BYOK usage lives in the customer&apos;s own cloud console.
        </p>
      </header>

      <section className="grid grid-cols-3 gap-4">
        <Stat label="Orgs tracked" value={latest.length.toString()} />
        <Stat label="Total bytes stored" value={formatBytes(totalBytes)} />
        <Stat
          label="Monthly storage cost (est)"
          value={`$${estimatedMonthlyUsd.toFixed(2)}`}
          sub="@ $0.015/GB-month · excludes Class A/B ops"
        />
      </section>

      <section className="rounded-lg border border-gray-200 bg-white shadow-sm">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-xs text-gray-600">
            <tr>
              <Th>Org</Th>
              <Th>Plan</Th>
              <Th>Bucket</Th>
              <Th align="right">Usage</Th>
              <Th align="right">Objects</Th>
              <Th align="right">Ceiling</Th>
              <Th>Status</Th>
              <Th>Snapshot</Th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {latest.length === 0 ? (
              <tr>
                <td colSpan={8} className="px-3 py-8 text-center text-xs text-gray-500">
                  No snapshots in the last 90 days. The monthly cron runs
                  on the 1st — there may not be data yet if this deploy is
                  less than a month old.
                </td>
              </tr>
            ) : (
              latest.map((r) => (
                <tr key={r.id} className={r.over_ceiling ? 'bg-red-50' : ''}>
                  <Td>{r.org_name}</Td>
                  <Td>
                    <code className="text-xs text-gray-700">
                      {r.plan_code ?? '—'}
                    </code>
                  </Td>
                  <Td>
                    <code className="text-xs text-gray-700">{r.bucket_name}</code>
                  </Td>
                  <Td align="right">
                    {formatBytes(r.payload_bytes + r.metadata_bytes)}
                  </Td>
                  <Td align="right">{r.object_count.toLocaleString()}</Td>
                  <Td align="right">
                    {r.plan_ceiling_bytes
                      ? formatBytes(r.plan_ceiling_bytes)
                      : 'no ceiling'}
                  </Td>
                  <Td>
                    {r.error_text ? (
                      <span className="text-amber-800">error</span>
                    ) : r.over_ceiling ? (
                      <span className="font-medium text-red-800">OVER</span>
                    ) : (
                      <span className="text-green-800">ok</span>
                    )}
                  </Td>
                  <Td>
                    <span className="text-xs text-gray-500">{r.snapshot_date}</span>
                  </Td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </section>
    </main>
  )
}

function Stat({
  label,
  value,
  sub,
}: {
  label: string
  value: string
  sub?: string
}) {
  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
      <p className="text-xs text-gray-600">{label}</p>
      <p className="mt-1 text-2xl font-semibold text-gray-900">{value}</p>
      {sub ? <p className="mt-1 text-xs text-gray-500">{sub}</p> : null}
    </div>
  )
}

function Th({
  children,
  align = 'left',
}: {
  children: React.ReactNode
  align?: 'left' | 'right'
}) {
  return (
    <th
      className={`px-3 py-2 font-medium ${align === 'right' ? 'text-right' : 'text-left'}`}
    >
      {children}
    </th>
  )
}

function Td({
  children,
  align = 'left',
}: {
  children: React.ReactNode
  align?: 'left' | 'right'
}) {
  return (
    <td
      className={`px-3 py-2 ${align === 'right' ? 'text-right' : 'text-left'}`}
    >
      {children}
    </td>
  )
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KiB`
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MiB`
  if (n < BYTES_PER_GB * 1024) return `${(n / BYTES_PER_GB).toFixed(2)} GiB`
  return `${(n / (BYTES_PER_GB * 1024)).toFixed(2)} TiB`
}

function toISODate(d: Date): string {
  return d.toISOString().slice(0, 10)
}
