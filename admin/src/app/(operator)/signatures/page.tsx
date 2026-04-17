import Link from 'next/link'
import { createServerClient } from '@/lib/supabase/server'
import { SignaturesFilterBar } from '@/components/signatures/filter-bar'

// ADR-0031 Sprint 2.1 — Tracker Signatures list.

export const dynamic = 'force-dynamic'

interface Signature {
  id: string
  signature_code: string
  display_name: string
  vendor: string
  signature_type: string
  pattern: string
  category: string
  severity: 'info' | 'warn' | 'critical'
  status: 'active' | 'deprecated'
  created_at: string
}

interface PageProps {
  searchParams: Promise<{
    category?: string
    severity?: 'info' | 'warn' | 'critical'
    status?: 'active' | 'deprecated'
  }>
}

export default async function SignaturesPage({ searchParams }: PageProps) {
  const params = await searchParams
  const supabase = await createServerClient()

  let query = supabase
    .schema('admin')
    .from('tracker_signature_catalogue')
    .select(
      'id, signature_code, display_name, vendor, signature_type, pattern, category, severity, status, created_at',
    )
    .order('category')
    .order('signature_code')

  if (params.category) query = query.eq('category', params.category)
  if (params.severity) query = query.eq('severity', params.severity)
  if (params.status) query = query.eq('status', params.status)

  const { data, error } = await query

  if (error) {
    return (
      <div className="mx-auto max-w-6xl">
        <h1 className="text-xl font-semibold">Tracker Signatures</h1>
        <p className="mt-4 rounded border border-red-200 bg-red-50 p-4 text-sm text-red-800">
          {error.message}
        </p>
      </div>
    )
  }

  const rows = (data ?? []) as Signature[]
  const counts = {
    active: rows.filter((r) => r.status === 'active').length,
    deprecated: rows.filter((r) => r.status === 'deprecated').length,
  }

  return (
    <div className="mx-auto max-w-6xl space-y-4">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">Tracker Signatures</h1>
          <p className="text-sm text-text-2">
            Regex patterns the Worker uses to classify third-party scripts.
            Active signatures sync to Cloudflare KV every 2 minutes.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className="rounded-full bg-green-100 px-3 py-1 text-xs font-medium text-green-700">
            {counts.active} active
          </span>
          <span className="rounded-full bg-[color:var(--border)] px-3 py-1 text-xs font-medium text-text-2">
            {counts.deprecated} deprecated
          </span>
          <Link
            href="/signatures/import"
            className="ml-2 rounded border border-[color:var(--border-mid)] bg-white px-3 py-1.5 text-xs text-text hover:bg-bg"
          >
            Import pack
          </Link>
          <Link
            href="/signatures/new"
            className="rounded bg-teal px-3 py-1.5 text-xs font-medium text-white hover:bg-teal-mid"
          >
            + New signature
          </Link>
        </div>
      </header>

      <SignaturesFilterBar />

      <div className="rounded-md border border-[color:var(--border)] bg-white shadow-sm">
        {rows.length === 0 ? (
          <p className="p-8 text-center text-sm text-text-3">
            No signatures match the current filters.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-bg text-left text-xs uppercase tracking-wider text-text-3">
                <tr>
                  <th className="px-4 py-2">Signature</th>
                  <th className="px-4 py-2">Vendor</th>
                  <th className="px-4 py-2">Type</th>
                  <th className="px-4 py-2">Pattern</th>
                  <th className="px-4 py-2">Category</th>
                  <th className="px-4 py-2">Severity</th>
                  <th className="px-4 py-2">Status</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((s) => (
                  <tr
                    key={s.id}
                    className="border-t border-[color:var(--border)] hover:bg-bg"
                  >
                    <td className="px-4 py-2">
                      <Link
                        href={`/signatures/${s.id}`}
                        className="font-medium text-red-700 hover:underline"
                      >
                        {s.display_name}
                      </Link>
                      <span className="ml-2 font-mono text-[11px] text-text-3">
                        {s.signature_code}
                      </span>
                    </td>
                    <td className="px-4 py-2 text-xs">{s.vendor}</td>
                    <td className="px-4 py-2 font-mono text-xs">
                      {s.signature_type}
                    </td>
                    <td className="px-4 py-2 font-mono text-[11px]">
                      {s.pattern}
                    </td>
                    <td className="px-4 py-2 text-xs capitalize">
                      {s.category}
                    </td>
                    <td className="px-4 py-2">
                      <SeverityPill severity={s.severity} />
                    </td>
                    <td className="px-4 py-2">
                      <StatusPill status={s.status} />
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

function StatusPill({ status }: { status: 'active' | 'deprecated' }) {
  return status === 'active' ? (
    <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700">
      active
    </span>
  ) : (
    <span className="rounded-full bg-[color:var(--border)] px-2 py-0.5 text-xs font-medium text-text-2">
      deprecated
    </span>
  )
}

function SeverityPill({ severity }: { severity: 'info' | 'warn' | 'critical' }) {
  const classes =
    severity === 'critical'
      ? 'rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700'
      : severity === 'warn'
        ? 'rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800'
        : 'rounded-full bg-[color:var(--border)] px-2 py-0.5 text-xs font-medium text-text-2'
  return <span className={classes}>{severity}</span>
}
