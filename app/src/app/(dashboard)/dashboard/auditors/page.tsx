import Link from 'next/link'
import { redirect } from 'next/navigation'
import { createServerClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

interface EngagementRow {
  id: string
  auditor_name: string
  registration_category: string
  scope: string
  engagement_start: string
  engagement_end: string | null
  status: string
}

interface SearchParams {
  status?: string
}

function statusPill(status: string): string {
  return status === 'active'
    ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
    : status === 'completed'
      ? 'bg-gray-100 text-gray-700 border-gray-300'
      : 'bg-red-50 text-red-700 border-red-200'
}

export default async function AuditorEngagementsPage({
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
        <h1 className="text-2xl font-bold">Auditor Engagements</h1>
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
    .from('data_auditor_engagements')
    .select('id, auditor_name, registration_category, scope, engagement_start, engagement_end, status')
    .eq('org_id', membership.org_id)
    .order('engagement_start', { ascending: false })

  if (filters.status && ['active', 'completed', 'terminated'].includes(filters.status)) {
    query = query.eq('status', filters.status)
  }

  const { data: rowsRaw, error } = await query

  if (error) {
    return (
      <main className="p-8 max-w-5xl">
        <h1 className="text-2xl font-bold">Auditor Engagements</h1>
        <p className="mt-4 text-sm text-red-600">Failed to load: {error.message}</p>
      </main>
    )
  }

  const rows = (rowsRaw ?? []) as EngagementRow[]
  const active = rows.filter(r => r.status === 'active').length
  const completed = rows.filter(r => r.status === 'completed').length
  const terminated = rows.filter(r => r.status === 'terminated').length
  const isSdf = org?.sdf_status && org.sdf_status !== 'not_designated'

  return (
    <main className="p-8 max-w-6xl">
      <header className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">
            Auditor Engagements{' '}
            <span className="ml-2 inline-flex items-center rounded bg-slate-900 px-1.5 py-0.5 text-[10px] font-medium text-white">
              SDF
            </span>
          </h1>
          <p className="mt-1 text-sm text-gray-500">
            Independent data auditor engagements for <strong>{org?.name}</strong>
          </p>
        </div>
        <Link
          href="/dashboard/auditors/new"
          className="rounded bg-emerald-700 px-3 py-1.5 text-sm text-white hover:bg-emerald-800"
        >
          + New engagement
        </Link>
      </header>

      {isSdf && (
        <div className="mb-6 rounded-lg border border-amber-200 bg-amber-50 p-4 text-xs text-amber-800">
          DPDP §10 requires SDFs to appoint an independent Data Auditor and conduct periodic data audits.
          This panel records engagement metadata. The audit report itself stays in your own storage —
          ConsentShield keeps only the reference, never the report bytes. Registration category is a
          declaration (e.g. ca_firm); we do NOT store auditor PAN values.
        </div>
      )}

      <div className="mb-6 grid grid-cols-3 gap-4">
        <div className="rounded border border-gray-200 bg-white p-4">
          <div className="text-xs uppercase tracking-wide text-gray-500">Active</div>
          <div className="mt-1 text-2xl font-semibold text-emerald-700">{active}</div>
          <div className="text-xs text-gray-400">Ongoing audit cycles</div>
        </div>
        <div className="rounded border border-gray-200 bg-white p-4">
          <div className="text-xs uppercase tracking-wide text-gray-500">Completed</div>
          <div className="mt-1 text-2xl font-semibold">{completed}</div>
          <div className="text-xs text-gray-400">Finalised</div>
        </div>
        <div className="rounded border border-gray-200 bg-white p-4">
          <div className="text-xs uppercase tracking-wide text-gray-500">Terminated</div>
          <div className="mt-1 text-2xl font-semibold text-red-700">{terminated}</div>
          <div className="text-xs text-gray-400">Ended early</div>
        </div>
      </div>

      <div className="mb-3 flex flex-wrap gap-2 text-xs">
        <Link
          href="/dashboard/auditors"
          className={`rounded-full border px-3 py-1 ${!filters.status ? 'border-emerald-600 bg-emerald-50 text-emerald-800' : 'border-gray-200 bg-white text-gray-600 hover:bg-gray-50'}`}
        >
          All
        </Link>
        {['active', 'completed', 'terminated'].map(s => (
          <Link
            key={s}
            href={`/dashboard/auditors?status=${s}`}
            className={`rounded-full border px-3 py-1 capitalize ${filters.status === s ? 'border-emerald-600 bg-emerald-50 text-emerald-800' : 'border-gray-200 bg-white text-gray-600 hover:bg-gray-50'}`}
          >
            {s}
          </Link>
        ))}
      </div>

      <section className="rounded-lg border border-gray-200 bg-white">
        {rows.length === 0 ? (
          <div className="p-10 text-center">
            <p className="text-sm text-gray-500">
              No auditor engagements {filters.status ? 'match the filter' : 'yet'}.{' '}
              {!filters.status && (
                <>
                  <Link href="/dashboard/auditors/new" className="text-emerald-700 underline">
                    Record your first engagement
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
                <th className="px-4 py-2 font-medium text-gray-600">Auditor</th>
                <th className="px-4 py-2 font-medium text-gray-600">Category</th>
                <th className="px-4 py-2 font-medium text-gray-600">Scope</th>
                <th className="px-4 py-2 font-medium text-gray-600">Start</th>
                <th className="px-4 py-2 font-medium text-gray-600">End</th>
                <th className="px-4 py-2 font-medium text-gray-600">Status</th>
                <th className="px-4 py-2" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {rows.map(r => (
                <tr key={r.id} className={`hover:bg-gray-50 ${r.status === 'terminated' ? 'opacity-60' : ''}`}>
                  <td className="px-4 py-3 font-medium">{r.auditor_name}</td>
                  <td className="px-4 py-3 text-xs">
                    <span className="rounded bg-gray-100 px-2 py-0.5 font-mono text-gray-700">
                      {r.registration_category}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-xs text-gray-600">
                    {r.scope.length > 60 ? r.scope.slice(0, 60) + '…' : r.scope}
                  </td>
                  <td className="px-4 py-3 text-xs text-gray-600">
                    {new Date(r.engagement_start).toLocaleDateString('en-IN')}
                  </td>
                  <td className="px-4 py-3 text-xs text-gray-600">
                    {r.engagement_end ? new Date(r.engagement_end).toLocaleDateString('en-IN') : '—'}
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={`inline-flex rounded-full border px-2 py-0.5 text-xs font-medium capitalize ${statusPill(r.status)}`}
                    >
                      {r.status}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <Link
                      href={`/dashboard/auditors/${r.id}`}
                      className="text-xs text-emerald-700 hover:underline"
                    >
                      {r.status === 'active' ? 'Manage' : 'View'}
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </main>
  )
}
