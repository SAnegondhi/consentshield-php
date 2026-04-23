// ADR-1004 Phase 2 Sprint 2.3 — /dashboard/notices/[id]/campaign.
//
// Per-notice campaign view. Shows pre-aggregated counts from
// public.reconsent_campaigns + replaced-by chain sample + outreach
// CSV exports.
//
// Counts refresh nightly via the reconsent-campaign-refresh-nightly
// pg_cron. Operators can force-refresh by hitting the /refresh route
// (deferred to a follow-up) or just re-running the RPC manually.

import Link from 'next/link'
import { redirect, notFound } from 'next/navigation'
import { createServerClient } from '@/lib/supabase/server'

interface NoticeRow {
  id: string
  org_id: string
  version: number
  title: string
  material_change_flag: boolean
  affected_artefact_count: number
  published_at: string
}

interface CampaignRow {
  affected_count: number
  responded_count: number
  revoked_count: number
  no_response_count: number
  computed_at: string | null
}

interface AffectedSample {
  artefact_id: string
  status: string
  replaced_by: string | null
  last_consent_at: string | null
}

export const dynamic = 'force-dynamic'

export default async function CampaignPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id: noticeId } = await params
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
  if (!membership) redirect('/dashboard')
  const orgId = (membership as { org_id: string }).org_id

  const { data: noticeRaw } = await supabase
    .from('notices')
    .select('id, org_id, version, title, material_change_flag, affected_artefact_count, published_at')
    .eq('id', noticeId)
    .eq('org_id', orgId)
    .maybeSingle()
  if (!noticeRaw) notFound()
  const notice = noticeRaw as NoticeRow

  if (!notice.material_change_flag) {
    return (
      <main className="p-8 max-w-3xl">
        <Link href="/dashboard/notices" className="text-xs text-gray-500 hover:underline">
          ← back to notices
        </Link>
        <h1 className="text-2xl font-bold mt-2">v{notice.version} — {notice.title}</h1>
        <p className="mt-2 text-sm text-gray-600">
          This is a routine (non-material) notice — it does not trigger a re-consent
          campaign. Existing artefacts continue to apply.
        </p>
      </main>
    )
  }

  // Trigger an opportunistic refresh on each load so the page never
  // shows pre-publish stale data. Cheap (one query each).
  await supabase.rpc('refresh_reconsent_campaign', { p_notice_id: noticeId })

  const { data: campaignRaw } = await supabase
    .from('reconsent_campaigns')
    .select('affected_count, responded_count, revoked_count, no_response_count, computed_at')
    .eq('notice_id', noticeId)
    .maybeSingle()
  const campaign: CampaignRow = (campaignRaw as CampaignRow | null) ?? {
    affected_count: notice.affected_artefact_count,
    responded_count: 0,
    revoked_count: 0,
    no_response_count: notice.affected_artefact_count,
    computed_at: null,
  }

  const { data: sampleRaw } = await supabase.rpc('rpc_notice_affected_artefacts', {
    p_org_id: orgId,
    p_notice_id: noticeId,
    p_limit: 10,
  })
  const sample = (sampleRaw ?? []) as AffectedSample[]

  const denom = Math.max(campaign.affected_count, 1)
  const respPct = Math.round((campaign.responded_count / denom) * 100)
  const revPct = Math.round((campaign.revoked_count / denom) * 100)
  const noRespPct = Math.max(100 - respPct - revPct, 0)

  return (
    <main className="p-8 space-y-6 max-w-5xl">
      <Link href="/dashboard/notices" className="text-xs text-gray-500 hover:underline">
        ← back to notices
      </Link>
      <header>
        <h1 className="text-2xl font-bold">Re-consent campaign — v{notice.version}</h1>
        <p className="mt-1 text-sm text-gray-600">
          {notice.title} · published {new Date(notice.published_at).toLocaleDateString()}
          {' · '}
          <span className="inline-block rounded-full bg-amber-100 text-amber-800 text-[11px] px-2 py-0.5">
            material change
          </span>
        </p>
      </header>

      <section className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Stat label="Affected at publish" value={campaign.affected_count} sub="artefacts on prior version" />
        <Stat label="Re-consented" value={campaign.responded_count} sub={`${respPct}%`} tone="green" />
        <Stat label="Withdrew" value={campaign.revoked_count} sub={`${revPct}%`} tone="red" />
        <Stat label="No response" value={campaign.no_response_count} sub={`${noRespPct}% — still on v${notice.version - 1}`} tone="gray" />
      </section>

      <section className="rounded-lg border border-gray-200 bg-white">
        <header className="px-5 py-3 border-b border-gray-200 flex items-center justify-between">
          <h2 className="text-sm font-medium">Progress</h2>
          <span className="text-[11px] text-gray-500">
            {campaign.computed_at
              ? `last refresh ${new Date(campaign.computed_at).toLocaleString()}`
              : 'no refresh yet'}
          </span>
        </header>
        <div className="p-5 space-y-2">
          <div className="h-3.5 rounded-full bg-gray-100 overflow-hidden flex">
            <div className="bg-emerald-600 h-full" style={{ width: `${respPct}%` }} />
            <div className="bg-red-600 h-full" style={{ width: `${revPct}%` }} />
            <div className="bg-gray-300 h-full" style={{ width: `${noRespPct}%` }} />
          </div>
          <div className="flex gap-4 text-[11px] text-gray-600">
            <span><span className="inline-block h-2 w-2 rounded-sm bg-emerald-600 mr-1.5" />Re-consented</span>
            <span><span className="inline-block h-2 w-2 rounded-sm bg-red-600 mr-1.5" />Withdrew</span>
            <span><span className="inline-block h-2 w-2 rounded-sm bg-gray-300 mr-1.5" />No response</span>
          </div>
        </div>
      </section>

      <section className="rounded-lg border border-gray-200 bg-white">
        <header className="px-5 py-3 border-b border-gray-200 flex items-center justify-between">
          <h2 className="text-sm font-medium">Replaced-by chain (sample)</h2>
          <span className="text-[11px] text-gray-500">
            first {sample.length} of {campaign.affected_count} affected artefacts
          </span>
        </header>
        {sample.length === 0 ? (
          <div className="p-6 text-center text-sm text-gray-500">No affected artefacts yet.</div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-[11px] uppercase tracking-wide text-gray-500 bg-gray-50 border-b border-gray-200">
                <th className="px-4 py-2">Artefact</th>
                <th className="px-4 py-2 w-32">Status</th>
                <th className="px-4 py-2">Replaced by</th>
                <th className="px-4 py-2 w-44">Last consent</th>
              </tr>
            </thead>
            <tbody>
              {sample.map((row) => (
                <tr key={row.artefact_id} className="border-b border-gray-100 last:border-b-0">
                  <td className="px-4 py-2 font-mono text-xs">{row.artefact_id}</td>
                  <td className="px-4 py-2">
                    <StatusPill status={row.status} />
                  </td>
                  <td className="px-4 py-2 font-mono text-xs">
                    {row.replaced_by ?? <span className="text-gray-400">—</span>}
                  </td>
                  <td className="px-4 py-2 text-gray-600 text-xs">
                    {row.last_consent_at
                      ? new Date(row.last_consent_at).toLocaleString()
                      : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="rounded-lg border border-gray-200 bg-white">
        <header className="px-5 py-3 border-b border-gray-200">
          <h2 className="text-sm font-medium">Outreach</h2>
        </header>
        <div className="p-5 text-sm text-gray-700 space-y-3">
          <p>
            The campaign tracks but does not send messages. Export the affected list as
            CSV and load it into your messaging system (Resend, Mailchimp, your
            outreach team&apos;s tooling). Once recipients submit a new consent event
            referencing v{notice.version}, the chain auto-marks them resolved.
          </p>
          <a
            href={`/dashboard/notices/${notice.id}/affected.csv`}
            className="inline-block rounded-md border border-gray-300 px-3 py-1.5 text-xs hover:bg-gray-50"
          >
            Export affected (CSV)
          </a>
        </div>
      </section>

      <div className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-900">
        <strong>v1 deferral:</strong> bulk re-consent reminder send + per-channel A/B
        is not in scope. Use the CSV export with your existing messaging stack.
      </div>
    </main>
  )
}

function Stat({
  label,
  value,
  sub,
  tone,
}: {
  label: string
  value: number
  sub: string
  tone?: 'green' | 'red' | 'gray'
}) {
  const color =
    tone === 'green'
      ? 'text-emerald-700'
      : tone === 'red'
        ? 'text-red-600'
        : tone === 'gray'
          ? 'text-gray-700'
          : 'text-black'
  return (
    <div className="rounded-md border border-gray-200 bg-white p-4">
      <p className="text-[10px] uppercase tracking-wide text-gray-500">{label}</p>
      <p className={`mt-1 text-2xl font-bold tabular-nums ${color}`}>{value}</p>
      <p className="text-[11px] text-gray-600 mt-1">{sub}</p>
    </div>
  )
}

function StatusPill({ status }: { status: string }) {
  const map: Record<string, string> = {
    active: 'bg-emerald-100 text-emerald-700',
    replaced: 'bg-gray-100 text-gray-700',
    revoked: 'bg-red-100 text-red-700',
    expired: 'bg-amber-100 text-amber-800',
  }
  const cls = map[status] ?? 'bg-gray-100 text-gray-700'
  return (
    <span className={`inline-block rounded-full px-2 py-0.5 text-[11px] ${cls}`}>
      {status}
    </span>
  )
}
