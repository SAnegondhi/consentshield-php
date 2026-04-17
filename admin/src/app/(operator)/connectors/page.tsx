import Link from 'next/link'
import { createServerClient } from '@/lib/supabase/server'
import { ConnectorsFilterBar } from '@/components/connectors/filter-bar'

// ADR-0031 Sprint 1.1 — Connector Catalogue list.
//
// Read-only in this sprint. Create / Edit / Deprecate land in Sprint 1.2.
// All admin roles can read; writes are platform_operator only (RPC-gated).

export const dynamic = 'force-dynamic'

interface Connector {
  id: string
  connector_code: string
  display_name: string
  vendor: string
  version: string
  status: 'active' | 'deprecated' | 'retired'
  supported_purpose_codes: string[]
  retention_lock_supported: boolean
  created_at: string
  deprecated_at: string | null
  cutover_deadline: string | null
}

interface PageProps {
  searchParams: Promise<{
    status?: 'active' | 'deprecated' | 'retired'
    vendor?: string
  }>
}

export default async function ConnectorsPage({ searchParams }: PageProps) {
  const params = await searchParams
  const supabase = await createServerClient()

  let query = supabase
    .schema('admin')
    .from('connector_catalogue')
    .select(
      'id, connector_code, display_name, vendor, version, status, supported_purpose_codes, retention_lock_supported, created_at, deprecated_at, cutover_deadline',
    )
    .order('connector_code')
    .order('version', { ascending: false })

  if (params.status) query = query.eq('status', params.status)
  if (params.vendor) query = query.eq('vendor', params.vendor)

  const { data, error } = await query

  if (error) {
    return (
      <div className="mx-auto max-w-6xl">
        <h1 className="text-xl font-semibold">Connector Catalogue</h1>
        <p className="mt-4 rounded border border-red-200 bg-red-50 p-4 text-sm text-red-800">
          {error.message}
        </p>
      </div>
    )
  }

  const connectors = (data ?? []) as Connector[]

  const counts = {
    active: connectors.filter((c) => c.status === 'active').length,
    deprecated: connectors.filter((c) => c.status === 'deprecated').length,
    retired: connectors.filter((c) => c.status === 'retired').length,
  }

  const vendors = Array.from(new Set(connectors.map((c) => c.vendor))).sort()

  return (
    <div className="mx-auto max-w-6xl space-y-4">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">Connector Catalogue</h1>
          <p className="text-sm text-text-2">
            Global registry of pre-built deletion connectors. Customers pick
            from this list when wiring their deletion pipeline.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className="rounded-full bg-green-100 px-3 py-1 text-xs font-medium text-green-700">
            {counts.active} active
          </span>
          <span className="rounded-full bg-amber-100 px-3 py-1 text-xs font-medium text-amber-800">
            {counts.deprecated} deprecated
          </span>
          <span className="rounded-full bg-[color:var(--border)] px-3 py-1 text-xs font-medium text-text-2">
            {counts.retired} retired
          </span>
          <Link
            href="/connectors/new"
            className="ml-2 rounded bg-teal px-3 py-1.5 text-xs font-medium text-white hover:bg-teal-mid"
          >
            + New connector
          </Link>
        </div>
      </header>

      <ConnectorsFilterBar vendors={vendors} />

      <div className="rounded-md border border-[color:var(--border)] bg-white shadow-sm">
        {connectors.length === 0 ? (
          <p className="p-8 text-center text-sm text-text-3">
            No connectors match the current filters.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-bg text-left text-xs uppercase tracking-wider text-text-3">
                <tr>
                  <th className="px-4 py-2">Connector</th>
                  <th className="px-4 py-2">Vendor</th>
                  <th className="px-4 py-2">Version</th>
                  <th className="px-4 py-2">Purposes</th>
                  <th className="px-4 py-2">Retention lock</th>
                  <th className="px-4 py-2">Status</th>
                  <th className="px-4 py-2">Cutover</th>
                </tr>
              </thead>
              <tbody>
                {connectors.map((c) => (
                  <tr
                    key={c.id}
                    className="border-t border-[color:var(--border)] hover:bg-bg"
                  >
                    <td className="px-4 py-2">
                      <Link
                        href={`/connectors/${c.id}`}
                        className="font-medium text-red-700 hover:underline"
                      >
                        {c.display_name}
                      </Link>
                      <span className="ml-2 font-mono text-[11px] text-text-3">
                        {c.connector_code}
                      </span>
                    </td>
                    <td className="px-4 py-2 text-xs">{c.vendor}</td>
                    <td className="px-4 py-2 font-mono text-xs">
                      {c.version}
                    </td>
                    <td className="px-4 py-2 text-xs text-text-2">
                      {(c.supported_purpose_codes ?? []).join(', ') || '—'}
                    </td>
                    <td className="px-4 py-2 text-xs">
                      {c.retention_lock_supported ? 'Yes' : 'No'}
                    </td>
                    <td className="px-4 py-2">
                      <StatusPill status={c.status} />
                    </td>
                    <td className="px-4 py-2 text-xs text-text-2">
                      {c.cutover_deadline
                        ? new Date(c.cutover_deadline).toLocaleDateString()
                        : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}

function StatusPill({
  status,
}: {
  status: 'active' | 'deprecated' | 'retired'
}) {
  const classes =
    status === 'active'
      ? 'rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700'
      : status === 'deprecated'
        ? 'rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800'
        : 'rounded-full bg-[color:var(--border)] px-2 py-0.5 text-xs font-medium text-text-2'
  return <span className={classes}>{status}</span>
}
