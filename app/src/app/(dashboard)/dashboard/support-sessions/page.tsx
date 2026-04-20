import Link from 'next/link'
import { createServerClient } from '@/lib/supabase/server'

// ADR-0029 Sprint 4.1 + 2026-04-20 follow-up — customer-side Support sessions tab.
//
// Every time a ConsentShield operator starts an impersonation session
// against the current user's org, a row appears in admin.impersonation_sessions.
// public.list_org_support_sessions() is a SECURITY DEFINER RPC that joins
// admin display names into the rows (customers do NOT get direct grants on
// admin.*) and returns duration_seconds computed server-side.

export const dynamic = 'force-dynamic'

interface SessionRow {
  id: string
  admin_display_name: string | null
  reason: string
  reason_detail: string
  started_at: string
  ended_at: string | null
  duration_seconds: number
  status: string
  actions_summary: Record<string, unknown> | null
  // ADR-0055 Sprint 1.1 — 'org' or 'account' scope
  target_scope: 'org' | 'account'
}

interface SearchParams {
  status?: string
}

function statusPill(status: string): string {
  return status === 'active'
    ? 'bg-red-50 text-red-700 border-red-200'
    : status === 'completed'
      ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
      : 'bg-amber-50 text-amber-700 border-amber-200'
}

function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds}s`
  const mins = Math.floor(seconds / 60)
  if (mins < 60) return `${mins} min`
  const hrs = Math.floor(mins / 60)
  return `${hrs}h ${mins % 60}m`
}

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })
}

export default async function SupportSessionsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>
}) {
  const filters = await searchParams
  const supabase = await createServerClient()

  const statusFilter =
    filters.status && ['active', 'completed', 'expired', 'force_ended'].includes(filters.status)
      ? filters.status
      : null

  const { data, error } = await supabase.rpc('list_org_support_sessions', {
    p_status: statusFilter,
    p_limit: 100,
  })

  if (error) {
    const msg = error.message ?? ''
    if (msg.includes('no_org_context') || msg.includes('access_denied')) {
      return (
        <main className="p-8 max-w-3xl">
          <h1 className="text-2xl font-bold">Support sessions</h1>
          <p className="mt-4 text-sm text-gray-600">
            No organisation context. Complete signup first.
          </p>
        </main>
      )
    }
    return (
      <main className="p-8">
        <h1 className="text-2xl font-bold">Support sessions</h1>
        <p className="mt-4 text-sm text-red-600">Failed to load: {msg}</p>
      </main>
    )
  }

  const sessions = (data ?? []) as SessionRow[]
  const activeCount = sessions.filter(s => s.status === 'active').length

  return (
    <main className="p-8 max-w-6xl">
      <header className="mb-6">
        <h1 className="text-2xl font-bold">Support sessions</h1>
        <p className="mt-1 max-w-3xl text-sm text-gray-500">
          Every ConsentShield operator session that accessed your organisation&rsquo;s data.
          Sessions are time-boxed (≤120 minutes) and every action an operator takes is audit-logged.
          You receive an email notification within 5 minutes of each session start.
        </p>
      </header>

      <div className="mb-6 grid grid-cols-3 gap-4">
        <div className="rounded border border-gray-200 bg-white p-4">
          <div className="text-xs uppercase tracking-wide text-gray-500">Total on record</div>
          <div className="mt-1 text-2xl font-semibold">{sessions.length}</div>
          <div className="text-xs text-gray-400">Last 100 sessions</div>
        </div>
        <div className="rounded border border-gray-200 bg-white p-4">
          <div className="text-xs uppercase tracking-wide text-gray-500">Active now</div>
          <div className={`mt-1 text-2xl font-semibold ${activeCount > 0 ? 'text-red-700' : ''}`}>
            {activeCount}
          </div>
          <div className="text-xs text-gray-400">
            {activeCount > 0 ? 'Operator is in your org' : 'No active sessions'}
          </div>
        </div>
        <div className="rounded border border-gray-200 bg-white p-4">
          <div className="text-xs uppercase tracking-wide text-gray-500">Completed</div>
          <div className="mt-1 text-2xl font-semibold">
            {sessions.filter(s => s.status === 'completed').length}
          </div>
          <div className="text-xs text-gray-400">Normal closures</div>
        </div>
      </div>

      <div className="mb-3 flex flex-wrap gap-2 text-xs">
        <Link
          href="/dashboard/support-sessions"
          className={`rounded-full border px-3 py-1 ${!statusFilter ? 'border-emerald-600 bg-emerald-50 text-emerald-800' : 'border-gray-200 bg-white text-gray-600 hover:bg-gray-50'}`}
        >
          All
        </Link>
        {['active', 'completed', 'expired', 'force_ended'].map(s => (
          <Link
            key={s}
            href={`/dashboard/support-sessions?status=${s}`}
            className={`rounded-full border px-3 py-1 capitalize ${statusFilter === s ? 'border-emerald-600 bg-emerald-50 text-emerald-800' : 'border-gray-200 bg-white text-gray-600 hover:bg-gray-50'}`}
          >
            {s.replace(/_/g, ' ')}
          </Link>
        ))}
      </div>

      <section className="rounded-lg border border-gray-200 bg-white">
        {sessions.length === 0 ? (
          <div className="p-10 text-center">
            <p className="text-sm text-gray-500">
              No support sessions on record. You&rsquo;ll see an entry here the first time ConsentShield
              support assists with your account.
            </p>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="border-b bg-gray-50 text-left">
              <tr>
                <th className="px-4 py-2 font-medium text-gray-600">Started</th>
                <th className="px-4 py-2 font-medium text-gray-600">Operator</th>
                <th className="px-4 py-2 font-medium text-gray-600">Reason</th>
                <th className="px-4 py-2 font-medium text-gray-600">Detail</th>
                <th className="px-4 py-2 font-medium text-gray-600">Duration</th>
                <th className="px-4 py-2 font-medium text-gray-600">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {sessions.map(s => {
                const actions = s.actions_summary
                  ? Object.keys(s.actions_summary).length
                  : 0
                return (
                  <tr key={s.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3 text-xs text-gray-700">{formatDateTime(s.started_at)}</td>
                    <td className="px-4 py-3 text-xs">
                      <span className="font-medium text-gray-800">
                        {s.admin_display_name ?? <span className="font-sans text-gray-400 italic">unknown</span>}
                      </span>
                      {s.target_scope === 'account' && (
                        <span className="ml-2 rounded bg-purple-50 px-1.5 py-0.5 text-[10px] font-medium text-purple-700 border border-purple-200">
                          account
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-xs">
                      <code className="rounded bg-gray-100 px-1.5 py-0.5 text-[11px] text-gray-700">
                        {s.reason}
                      </code>
                    </td>
                    <td className="max-w-md px-4 py-3 text-xs text-gray-600">
                      {s.reason_detail}
                      {actions > 0 && (
                        <span className="ml-2 text-[11px] text-gray-400">
                          · {actions} action{actions === 1 ? '' : 's'} recorded
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-xs text-gray-600">
                      {formatDuration(s.duration_seconds)}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`inline-flex rounded-full border px-2 py-0.5 text-xs font-medium capitalize ${statusPill(s.status)}`}
                      >
                        {s.status.replace(/_/g, ' ')}
                      </span>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
        <div className="border-t border-gray-100 bg-gray-50 p-3 text-xs text-gray-500">
          Operator identity is resolved server-side. Every action during a session is written to the
          immutable admin audit log — your compliance contact can request the full action log by
          contacting support with the session ID.
        </div>
      </section>
    </main>
  )
}
