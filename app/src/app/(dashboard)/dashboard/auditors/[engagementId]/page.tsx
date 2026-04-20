import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { createServerClient } from '@/lib/supabase/server'
import { EngagementActions } from './actions-panel'

export const dynamic = 'force-dynamic'

interface Engagement {
  id: string
  org_id: string
  auditor_name: string
  registration_category: string
  registration_ref: string | null
  scope: string
  engagement_start: string
  engagement_end: string | null
  attestation_ref: string | null
  status: string
  notes: string | null
  terminated_reason: string | null
  created_at: string
  updated_at: string
}

function statusPill(status: string): string {
  return status === 'active'
    ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
    : status === 'completed'
      ? 'bg-gray-100 text-gray-700 border-gray-300'
      : 'bg-red-50 text-red-700 border-red-200'
}

export default async function EngagementDetailPage({
  params,
}: {
  params: Promise<{ engagementId: string }>
}) {
  const { engagementId } = await params
  const supabase = await createServerClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: row } = await supabase
    .from('data_auditor_engagements')
    .select('*')
    .eq('id', engagementId)
    .maybeSingle()

  if (!row) notFound()
  const eng = row as Engagement

  const { data: effRoleRes } = await supabase.rpc('effective_org_role', {
    p_org_id: eng.org_id,
  })
  const effRole = effRoleRes as string | null
  const canAct = effRole === 'org_admin' || effRole === 'admin'

  return (
    <main className="p-8 max-w-4xl">
      <div className="mb-6">
        <Link href="/dashboard/auditors" className="text-xs text-gray-500 hover:underline">
          ← Back to engagements
        </Link>
        <div className="mt-2 flex items-start justify-between">
          <div>
            <h1 className="text-2xl font-bold">{eng.auditor_name}</h1>
            <div className="mt-2 flex items-center gap-2 text-sm">
              <span
                className={`inline-flex rounded-full border px-2 py-0.5 text-xs font-medium capitalize ${statusPill(eng.status)}`}
              >
                {eng.status}
              </span>
              <span className="rounded bg-gray-100 px-2 py-0.5 font-mono text-xs text-gray-700">
                {eng.registration_category}
              </span>
            </div>
          </div>
        </div>
      </div>

      <EngagementActions engagement={eng} canAct={canAct} />

      <section className="mt-6 rounded-lg border border-gray-200 bg-white p-5">
        <h2 className="mb-3 text-sm font-semibold text-gray-700">Scope</h2>
        <p className="whitespace-pre-line text-sm text-gray-700">{eng.scope}</p>
      </section>

      <section className="mt-4 rounded-lg border border-gray-200 bg-white p-5">
        <h2 className="mb-3 text-sm font-semibold text-gray-700">Details</h2>
        <dl className="grid grid-cols-2 gap-x-6 gap-y-4 text-sm">
          <div>
            <dt className="text-xs uppercase tracking-wide text-gray-500">Registration ref</dt>
            <dd className="mt-0.5 break-all text-xs">
              {eng.registration_ref ? (
                <a href={eng.registration_ref} className="text-emerald-700 hover:underline" target="_blank" rel="noopener noreferrer">
                  {eng.registration_ref}
                </a>
              ) : (
                <span className="italic text-gray-400">not recorded</span>
              )}
            </dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-wide text-gray-500">Attestation ref</dt>
            <dd className="mt-0.5 break-all text-xs">
              {eng.attestation_ref ? (
                <a href={eng.attestation_ref} className="text-emerald-700 hover:underline" target="_blank" rel="noopener noreferrer">
                  {eng.attestation_ref}
                </a>
              ) : (
                <span className="italic text-gray-400">
                  {eng.status === 'active' ? 'pending completion' : 'not recorded'}
                </span>
              )}
            </dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-wide text-gray-500">Engagement start</dt>
            <dd className="mt-0.5">{new Date(eng.engagement_start).toLocaleDateString('en-IN')}</dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-wide text-gray-500">Engagement end</dt>
            <dd className="mt-0.5">
              {eng.engagement_end ? new Date(eng.engagement_end).toLocaleDateString('en-IN') : '—'}
            </dd>
          </div>
          {eng.terminated_reason && (
            <div className="col-span-2">
              <dt className="text-xs uppercase tracking-wide text-gray-500">Termination reason</dt>
              <dd className="mt-0.5 text-red-700">{eng.terminated_reason}</dd>
            </div>
          )}
          {eng.notes && (
            <div className="col-span-2">
              <dt className="text-xs uppercase tracking-wide text-gray-500">Notes</dt>
              <dd className="mt-0.5 whitespace-pre-line">{eng.notes}</dd>
            </div>
          )}
          <div className="col-span-2 text-xs text-gray-400">
            Created {new Date(eng.created_at).toLocaleString('en-IN')}
            {eng.updated_at !== eng.created_at && ` · updated ${new Date(eng.updated_at).toLocaleString('en-IN')}`}
          </div>
        </dl>
      </section>
    </main>
  )
}
