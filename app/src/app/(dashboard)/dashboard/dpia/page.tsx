import Link from 'next/link'
import { redirect } from 'next/navigation'
import { createServerClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

interface DpiaRow {
  id: string
  title: string
  risk_level: string
  status: string
  conducted_at: string
  next_review_at: string | null
  auditor_name: string | null
  data_categories: string[] | Record<string, unknown>
  superseded_by: string | null
}

interface SearchParams {
  status?: string
  risk?: string
}

function riskPill(risk: string): string {
  return risk === 'high'
    ? 'bg-red-50 text-red-700 border-red-200'
    : risk === 'medium'
      ? 'bg-amber-50 text-amber-700 border-amber-200'
      : 'bg-gray-100 text-gray-600 border-gray-200'
}

function statusPill(status: string): string {
  return status === 'published'
    ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
    : status === 'draft'
      ? 'bg-gray-100 text-gray-700 border-gray-300'
      : 'bg-gray-100 text-gray-500 border-gray-200'
}

function daysUntil(dateStr: string | null): { text: string; urgent: boolean } {
  if (!dateStr) return { text: '—', urgent: false }
  const diff = Math.ceil((new Date(dateStr).getTime() - Date.now()) / 86_400_000)
  if (diff < 0) return { text: `${Math.abs(diff)}d overdue`, urgent: true }
  if (diff < 30) return { text: `in ${diff}d ⚠`, urgent: true }
  return { text: `in ${diff}d`, urgent: false }
}

export default async function DpiaListPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>
}) {
  const filters = await searchParams
  const supabase = await createServerClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: membership } = await supabase
    .from('org_memberships')
    .select('org_id')
    .eq('user_id', user.id)
    .limit(1)
    .maybeSingle()

  if (!membership) {
    return (
      <main className="p-8 max-w-5xl">
        <h1 className="text-2xl font-bold">DPIA Records</h1>
        <p className="mt-4 text-sm text-gray-600">No organisation found. Complete signup first.</p>
      </main>
    )
  }

  const { data: org } = await supabase
    .from('organisations')
    .select('id, name, sdf_status')
    .eq('id', membership.org_id)
    .single()

  let query = supabase
    .from('dpia_records')
    .select('id, title, risk_level, status, conducted_at, next_review_at, auditor_name, data_categories, superseded_by')
    .eq('org_id', membership.org_id)
    .order('conducted_at', { ascending: false })

  if (filters.status && ['draft', 'published', 'superseded'].includes(filters.status)) {
    query = query.eq('status', filters.status)
  }
  if (filters.risk && ['low', 'medium', 'high'].includes(filters.risk)) {
    query = query.eq('risk_level', filters.risk)
  }

  const { data: dpiasRaw, error: dpiasError } = await query

  if (dpiasError) {
    return (
      <main className="p-8 max-w-5xl">
        <h1 className="text-2xl font-bold">DPIA Records</h1>
        <p className="mt-4 text-sm text-red-600">Failed to load: {dpiasError.message}</p>
      </main>
    )
  }

  const dpias = (dpiasRaw ?? []) as DpiaRow[]
  const published = dpias.filter(d => d.status === 'published').length
  const drafts = dpias.filter(d => d.status === 'draft').length
  const reviewDueSoon = dpias.filter(
    d => d.status === 'published' && d.next_review_at && daysUntil(d.next_review_at).urgent,
  ).length
  const superseded = dpias.filter(d => d.status === 'superseded').length

  const isSdf = org?.sdf_status && org.sdf_status !== 'not_designated'

  return (
    <main className="p-8 max-w-6xl">
      <header className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">
            DPIA Records <span className="ml-2 inline-flex items-center rounded bg-slate-900 px-1.5 py-0.5 text-[10px] font-medium text-white">SDF</span>
          </h1>
          <p className="mt-1 text-sm text-gray-500">
            Data Protection Impact Assessment records for <strong>{org?.name}</strong>
          </p>
        </div>
        <Link
          href="/dashboard/dpia/new"
          className="rounded bg-emerald-700 px-3 py-1.5 text-sm text-white hover:bg-emerald-800"
        >
          + New DPIA
        </Link>
      </header>

      {isSdf && (
        <div className="mb-6 flex gap-3 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm">
          <svg
            className="mt-0.5 flex-shrink-0"
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="8" x2="12" y2="12" />
            <line x1="12" y1="16" x2="12.01" y2="16" />
          </svg>
          <div>
            <p className="font-medium text-amber-900">
              {org?.name} is a Significant Data Fiduciary ({org.sdf_status?.replace(/_/g, ' ')})
            </p>
            <p className="mt-1 text-xs text-amber-800">
              Under DPDP §10 you must maintain DPIAs for high-impact processing operations, appoint an
              independent Data Auditor, and publish transparency summaries. This panel records DPIA
              cycles; the DPIA document itself stays in your own storage — ConsentShield keeps the
              reference, never the PDF bytes.
            </p>
          </div>
        </div>
      )}

      {/* KPI row */}
      <div className="mb-6 grid grid-cols-4 gap-4">
        <div className="rounded border border-gray-200 bg-white p-4">
          <div className="text-xs uppercase tracking-wide text-gray-500">Published</div>
          <div className="mt-1 text-2xl font-semibold text-emerald-700">{published}</div>
          <div className="text-xs text-gray-400">Active DPIA cycles</div>
        </div>
        <div className="rounded border border-gray-200 bg-white p-4">
          <div className="text-xs uppercase tracking-wide text-gray-500">Drafts</div>
          <div className="mt-1 text-2xl font-semibold">{drafts}</div>
          <div className="text-xs text-gray-400">Awaiting publish</div>
        </div>
        <div className="rounded border border-gray-200 bg-white p-4">
          <div className="text-xs uppercase tracking-wide text-gray-500">Review due &lt; 30d</div>
          <div className="mt-1 text-2xl font-semibold text-amber-700">{reviewDueSoon}</div>
          <div className="text-xs text-gray-400">Schedule next cycle</div>
        </div>
        <div className="rounded border border-gray-200 bg-white p-4">
          <div className="text-xs uppercase tracking-wide text-gray-500">Superseded</div>
          <div className="mt-1 text-2xl font-semibold text-gray-500">{superseded}</div>
          <div className="text-xs text-gray-400">Historical record</div>
        </div>
      </div>

      {/* Filter chips */}
      <div className="mb-3 flex flex-wrap gap-2 text-xs">
        <Link
          href="/dashboard/dpia"
          className={`rounded-full border px-3 py-1 ${!filters.status && !filters.risk ? 'border-emerald-600 bg-emerald-50 text-emerald-800' : 'border-gray-200 bg-white text-gray-600 hover:bg-gray-50'}`}
        >
          All
        </Link>
        {['published', 'draft', 'superseded'].map(s => (
          <Link
            key={s}
            href={`/dashboard/dpia?status=${s}`}
            className={`rounded-full border px-3 py-1 capitalize ${filters.status === s ? 'border-emerald-600 bg-emerald-50 text-emerald-800' : 'border-gray-200 bg-white text-gray-600 hover:bg-gray-50'}`}
          >
            {s}
          </Link>
        ))}
        {['high', 'medium', 'low'].map(r => (
          <Link
            key={r}
            href={`/dashboard/dpia?risk=${r}`}
            className={`rounded-full border px-3 py-1 capitalize ${filters.risk === r ? 'border-emerald-600 bg-emerald-50 text-emerald-800' : 'border-gray-200 bg-white text-gray-600 hover:bg-gray-50'}`}
          >
            Risk: {r}
          </Link>
        ))}
      </div>

      {/* List table */}
      <section className="rounded-lg border border-gray-200 bg-white">
        {dpias.length === 0 ? (
          <div className="p-10 text-center">
            <p className="text-sm text-gray-500">
              No DPIA records {filters.status || filters.risk ? 'match the current filter' : 'yet'}.{' '}
              {!filters.status && !filters.risk && (
                <>
                  Start by{' '}
                  <Link href="/dashboard/dpia/new" className="text-emerald-700 underline">
                    creating a DPIA
                  </Link>
                  .
                </>
              )}
            </p>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="border-b bg-gray-50 text-left">
              <tr>
                <th className="px-4 py-2 font-medium text-gray-600">Title</th>
                <th className="px-4 py-2 font-medium text-gray-600">Risk</th>
                <th className="px-4 py-2 font-medium text-gray-600">Status</th>
                <th className="px-4 py-2 font-medium text-gray-600">Conducted</th>
                <th className="px-4 py-2 font-medium text-gray-600">Next review</th>
                <th className="px-4 py-2 font-medium text-gray-600">Auditor</th>
                <th className="px-4 py-2" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {dpias.map(d => {
                const review = daysUntil(d.next_review_at)
                const categories = Array.isArray(d.data_categories) ? d.data_categories : []
                return (
                  <tr key={d.id} className={`hover:bg-gray-50 ${d.status === 'superseded' ? 'opacity-60' : ''}`}>
                    <td className="px-4 py-3">
                      <div className="font-medium">{d.title}</div>
                      {categories.length > 0 && (
                        <div className="mt-0.5 text-xs text-gray-500">
                          {categories.slice(0, 3).join(' · ')}
                          {categories.length > 3 && ` · +${categories.length - 3}`}
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex rounded-full border px-2 py-0.5 text-xs font-medium capitalize ${riskPill(d.risk_level)}`}>
                        {d.risk_level}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex rounded-full border px-2 py-0.5 text-xs font-medium capitalize ${statusPill(d.status)}`}>
                        {d.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-xs text-gray-600">
                      {new Date(d.conducted_at).toLocaleDateString('en-IN')}
                    </td>
                    <td className={`px-4 py-3 text-xs ${review.urgent ? 'font-medium text-amber-700' : 'text-gray-600'}`}>
                      {review.text}
                    </td>
                    <td className="px-4 py-3 text-xs text-gray-600">{d.auditor_name ?? '—'}</td>
                    <td className="px-4 py-3 text-right">
                      <Link href={`/dashboard/dpia/${d.id}`} className="text-xs text-emerald-700 hover:underline">
                        View
                      </Link>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </section>
    </main>
  )
}
