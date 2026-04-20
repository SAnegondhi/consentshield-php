import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { createServerClient } from '@/lib/supabase/server'
import { DpiaDetailActions } from './detail-actions'

export const dynamic = 'force-dynamic'

interface DpiaFull {
  id: string
  org_id: string
  title: string
  processing_description: string
  data_categories: string[] | unknown
  risk_level: string
  mitigations: Record<string, unknown> | unknown
  auditor_attestation_ref: string | null
  auditor_name: string | null
  conducted_at: string
  next_review_at: string | null
  status: string
  superseded_by: string | null
  created_by: string
  created_at: string
  published_at: string | null
  superseded_at: string | null
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

export default async function DpiaDetailPage({
  params,
}: {
  params: Promise<{ dpiaId: string }>
}) {
  const { dpiaId } = await params
  const supabase = await createServerClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: dpia } = await supabase
    .from('dpia_records')
    .select('*')
    .eq('id', dpiaId)
    .maybeSingle()

  if (!dpia) notFound()
  const d = dpia as DpiaFull

  // Check effective role so we can show/hide the action buttons
  const { data: effRoleRes } = await supabase.rpc('effective_org_role', {
    p_org_id: d.org_id,
  })
  const effRole = effRoleRes as string | null
  const canAct = effRole === 'org_admin' || effRole === 'admin'

  // Candidate drafts for supersession (same org, status=draft, not self)
  const { data: draftsRaw } =
    canAct && d.status === 'published'
      ? await supabase
          .from('dpia_records')
          .select('id, title, conducted_at')
          .eq('org_id', d.org_id)
          .eq('status', 'draft')
          .neq('id', d.id)
          .order('conducted_at', { ascending: false })
      : { data: null }
  const replacementCandidates = (draftsRaw ?? []) as Array<{ id: string; title: string; conducted_at: string }>

  const categories = Array.isArray(d.data_categories) ? (d.data_categories as string[]) : []
  const mitigations =
    typeof d.mitigations === 'object' && d.mitigations !== null
      ? (d.mitigations as Record<string, unknown>)
      : {}
  const mitigationNotes = (mitigations.notes as string | undefined) ?? null

  return (
    <main className="p-8 max-w-4xl">
      <div className="mb-6">
        <Link href="/dashboard/dpia" className="text-xs text-gray-500 hover:underline">
          ← Back to DPIA records
        </Link>
        <div className="mt-2 flex items-start justify-between">
          <div>
            <h1 className="text-2xl font-bold">{d.title}</h1>
            <div className="mt-2 flex items-center gap-2 text-sm">
              <span className={`inline-flex rounded-full border px-2 py-0.5 text-xs font-medium capitalize ${statusPill(d.status)}`}>
                {d.status}
              </span>
              <span className={`inline-flex rounded-full border px-2 py-0.5 text-xs font-medium capitalize ${riskPill(d.risk_level)}`}>
                Risk: {d.risk_level}
              </span>
            </div>
          </div>
        </div>
      </div>

      <DpiaDetailActions
        dpia={{ id: d.id, status: d.status }}
        canAct={canAct}
        replacementCandidates={replacementCandidates}
      />

      <section className="mt-6 rounded-lg border border-gray-200 bg-white p-5">
        <h2 className="mb-3 text-sm font-semibold text-gray-700">Processing description</h2>
        <p className="whitespace-pre-line text-sm text-gray-700">{d.processing_description}</p>
      </section>

      <section className="mt-4 rounded-lg border border-gray-200 bg-white p-5">
        <h2 className="mb-3 text-sm font-semibold text-gray-700">Data categories</h2>
        {categories.length === 0 ? (
          <p className="text-sm text-gray-400 italic">No categories recorded</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {categories.map((c) => (
              <span key={c} className="rounded bg-gray-100 px-2 py-1 font-mono text-xs text-gray-700">
                {c}
              </span>
            ))}
          </div>
        )}
        <p className="mt-3 text-xs text-gray-400">Category strings only (Rule 3) — no raw values.</p>
      </section>

      {mitigationNotes && (
        <section className="mt-4 rounded-lg border border-gray-200 bg-white p-5">
          <h2 className="mb-3 text-sm font-semibold text-gray-700">Mitigations</h2>
          <p className="whitespace-pre-line text-sm text-gray-700">{mitigationNotes}</p>
        </section>
      )}

      <section className="mt-4 rounded-lg border border-gray-200 bg-white p-5">
        <h2 className="mb-3 text-sm font-semibold text-gray-700">Audit + lifecycle</h2>
        <dl className="grid grid-cols-2 gap-x-6 gap-y-4 text-sm">
          <div>
            <dt className="text-xs uppercase tracking-wide text-gray-500">Auditor</dt>
            <dd className="mt-0.5">{d.auditor_name ?? <span className="italic text-gray-400">not recorded</span>}</dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-wide text-gray-500">Attestation reference</dt>
            <dd className="mt-0.5 break-all font-mono text-xs">
              {d.auditor_attestation_ref ?? <span className="font-sans italic text-gray-400">not recorded</span>}
            </dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-wide text-gray-500">Conducted</dt>
            <dd className="mt-0.5">{new Date(d.conducted_at).toLocaleDateString('en-IN')}</dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-wide text-gray-500">Next review</dt>
            <dd className="mt-0.5">
              {d.next_review_at ? new Date(d.next_review_at).toLocaleDateString('en-IN') : '—'}
            </dd>
          </div>
          {d.published_at && (
            <div>
              <dt className="text-xs uppercase tracking-wide text-gray-500">Published</dt>
              <dd className="mt-0.5">{new Date(d.published_at).toLocaleString('en-IN')}</dd>
            </div>
          )}
          {d.superseded_at && (
            <div>
              <dt className="text-xs uppercase tracking-wide text-gray-500">Superseded</dt>
              <dd className="mt-0.5">{new Date(d.superseded_at).toLocaleString('en-IN')}</dd>
            </div>
          )}
          {d.superseded_by && (
            <div className="col-span-2">
              <dt className="text-xs uppercase tracking-wide text-gray-500">Superseded by</dt>
              <dd className="mt-0.5">
                <Link href={`/dashboard/dpia/${d.superseded_by}`} className="text-emerald-700 underline">
                  View replacement DPIA
                </Link>
              </dd>
            </div>
          )}
        </dl>
      </section>
    </main>
  )
}
