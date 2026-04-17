import { createServerClient } from '@/lib/supabase/server'

// ADR-0029 Sprint 4.1 — customer-side Support sessions tab.
//
// Every time a ConsentShield operator starts an impersonation session
// against the current user's org, a row appears in
// admin.impersonation_sessions. The public.org_support_sessions view
// (security_invoker) exposes a filtered, org-scoped slice of those
// sessions to the customer — they can see who touched their data and
// when, directly.

export const dynamic = 'force-dynamic'

interface SessionRow {
  id: string
  admin_user_id: string
  org_id: string
  reason: string
  reason_detail: string
  started_at: string
  ended_at: string | null
  status: string
  actions_summary: Record<string, unknown> | null
}

export default async function SupportSessionsPage() {
  const supabase = await createServerClient()

  const { data, error } = await supabase
    .from('org_support_sessions')
    .select('*')
    .order('started_at', { ascending: false })
    .limit(100)

  if (error) {
    return (
      <div className="p-8 text-sm text-red-600">
        Failed to load support sessions: {error.message}
      </div>
    )
  }

  const sessions = (data ?? []) as SessionRow[]

  return (
    <div className="p-8">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold">Support sessions</h1>
        <p className="mt-1 max-w-2xl text-sm text-gray-600">
          Every ConsentShield operator session that accessed your
          organisation&rsquo;s data. Sessions are time-boxed (≤120
          minutes) and every action an operator takes during a session is
          audit-logged. You will receive an email notification within 5
          minutes of each session start.
        </p>
      </header>

      {sessions.length === 0 ? (
        <div className="rounded-md border border-gray-200 bg-white p-8 text-center text-sm text-gray-600 shadow-sm">
          No support sessions on record. You will see an entry here the
          first time ConsentShield support assists with your account.
        </div>
      ) : (
        <div className="overflow-hidden rounded-md border border-gray-200 bg-white shadow-sm">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 text-left text-xs uppercase tracking-wider text-gray-500">
                <th className="px-4 py-2">Started</th>
                <th className="px-4 py-2">Reason</th>
                <th className="px-4 py-2">Detail</th>
                <th className="px-4 py-2">Ended</th>
                <th className="px-4 py-2">Status</th>
              </tr>
            </thead>
            <tbody>
              {sessions.map((s) => (
                <tr key={s.id} className="border-t border-gray-200">
                  <td className="px-4 py-2 font-mono text-xs text-gray-700">
                    {formatDateTime(s.started_at)}
                  </td>
                  <td className="px-4 py-2 text-xs">
                    <code className="font-mono">{s.reason}</code>
                  </td>
                  <td className="max-w-md px-4 py-2 text-xs text-gray-700">
                    {s.reason_detail}
                  </td>
                  <td className="px-4 py-2 font-mono text-xs text-gray-700">
                    {s.ended_at ? formatDateTime(s.ended_at) : '—'}
                  </td>
                  <td className="px-4 py-2 text-xs">{statusPill(s.status)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

function formatDateTime(iso: string) {
  return new Date(iso).toLocaleString('en-IN', {
    dateStyle: 'medium',
    timeStyle: 'short',
  })
}

function statusPill(status: string) {
  const cls =
    status === 'active'
      ? 'bg-red-100 text-red-700'
      : status === 'completed'
        ? 'bg-green-100 text-green-700'
        : status === 'expired'
          ? 'bg-amber-100 text-amber-700'
          : status === 'force_ended'
            ? 'bg-amber-100 text-amber-700'
            : 'bg-gray-100 text-gray-700'
  return (
    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${cls}`}>
      {status}
    </span>
  )
}
