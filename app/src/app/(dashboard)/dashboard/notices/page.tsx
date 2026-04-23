// ADR-1004 Phase 2 Sprint 2.2 — /dashboard/notices.
//
// Lists every published version of the org's privacy notice + a publish-
// new-version form. Material-change rows link to the campaign view.

import Link from 'next/link'
import { redirect } from 'next/navigation'
import { createServerClient } from '@/lib/supabase/server'
import { PublishNoticeForm } from './publish-form'

interface NoticeRow {
  id: string
  version: number
  title: string
  material_change_flag: boolean
  affected_artefact_count: number
  published_at: string
  published_by: string | null
}

export const dynamic = 'force-dynamic'

export default async function NoticesPage() {
  const supabase = await createServerClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: membership } = await supabase
    .from('org_memberships')
    .select('org_id')
    .eq('user_id', user.id)
    .single()
  if (!membership) {
    return (
      <main className="p-8">
        <p className="text-sm text-gray-600">No organisation found. Complete signup.</p>
      </main>
    )
  }
  const orgId = (membership as { org_id: string }).org_id

  const { data: noticesRaw } = await supabase
    .from('notices')
    .select('id, version, title, material_change_flag, affected_artefact_count, published_at, published_by')
    .eq('org_id', orgId)
    .order('version', { ascending: false })

  const notices = (noticesRaw ?? []) as NoticeRow[]
  const current = notices[0]
  const nextVersion = (current?.version ?? 0) + 1

  // For the form's affected-on-prior badge.
  let affectedOnPriorVersion = 0
  if (current) {
    const { count } = await supabase
      .from('consent_events')
      .select('id', { count: 'exact', head: true })
      .eq('org_id', orgId)
      .eq('notice_version', current.version)
    affectedOnPriorVersion = count ?? 0
  }

  return (
    <main className="p-8 space-y-6 max-w-5xl">
      <header>
        <h1 className="text-2xl font-bold">Privacy notices</h1>
        <p className="text-sm text-gray-600 mt-1">
          Every published version of your privacy notice. Append-only — to retract a
          notice, publish a new version with the change. Material changes trigger a
          re-consent campaign.
        </p>
      </header>

      {current ? (
        <div className="rounded-md border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-900">
          <strong>v{current.version}</strong> is currently in effect. Consent events
          captured today reference notice_version={current.version} and accumulate
          against the current cohort.
        </div>
      ) : (
        <div className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          No notice published yet. Until you publish v1, consent events captured for
          this org will have <code>notice_version=null</code>.
        </div>
      )}

      <section className="rounded-lg border border-gray-200 bg-white">
        <header className="px-5 py-3 border-b border-gray-200">
          <h2 className="font-medium text-sm">Versions</h2>
        </header>
        {notices.length === 0 ? (
          <div className="p-8 text-center text-sm text-gray-500">
            No notices yet. Publish v1 below.
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-[11px] uppercase tracking-wide text-gray-500 bg-gray-50 border-b border-gray-200">
                <th className="px-4 py-2 w-16">Ver</th>
                <th className="px-4 py-2">Title</th>
                <th className="px-4 py-2 w-44">Published</th>
                <th className="px-4 py-2 w-24">Material</th>
                <th className="px-4 py-2 w-44">Affected</th>
              </tr>
            </thead>
            <tbody>
              {notices.map((n) => {
                const isCurrent = n.id === current?.id
                return (
                  <tr
                    key={n.id}
                    className={`border-b border-gray-100 last:border-b-0 ${isCurrent ? 'bg-emerald-50' : ''}`}
                  >
                    <td className="px-4 py-3 align-top">
                      <strong>v{n.version}</strong>
                      {isCurrent && (
                        <span className="ml-2 inline-block rounded-full bg-emerald-100 text-emerald-700 text-[10px] px-2 py-0.5">
                          current
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 align-top">{n.title}</td>
                    <td className="px-4 py-3 align-top text-gray-600 text-xs">
                      {new Date(n.published_at).toLocaleDateString()}
                    </td>
                    <td className="px-4 py-3 align-top">
                      {n.material_change_flag ? (
                        <span className="inline-block rounded-full bg-amber-100 text-amber-800 text-[11px] px-2 py-0.5">
                          material
                        </span>
                      ) : (
                        <span className="inline-block rounded-full bg-gray-100 text-gray-600 text-[11px] px-2 py-0.5">
                          routine
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 align-top text-xs">
                      {n.material_change_flag ? (
                        <>
                          <strong>{n.affected_artefact_count}</strong> on prior
                          <br />
                          <Link
                            className="text-emerald-700 hover:underline"
                            href={`/dashboard/notices/${n.id}/campaign`}
                          >
                            view campaign →
                          </Link>
                          <br />
                          <a
                            className="text-gray-600 hover:underline"
                            href={`/dashboard/notices/${n.id}/affected.csv`}
                          >
                            export CSV
                          </a>
                        </>
                      ) : (
                        <span className="text-gray-400">—</span>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </section>

      <PublishNoticeForm
        orgId={orgId}
        nextVersion={nextVersion}
        affectedOnPriorVersion={affectedOnPriorVersion}
      />
    </main>
  )
}
