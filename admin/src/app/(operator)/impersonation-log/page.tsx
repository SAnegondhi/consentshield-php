import Link from 'next/link'
import { createServerClient } from '@/lib/supabase/server'
import { ImpersonationLogTabs } from './log-tabs'

// ADR-1027 Sprint 3.1 — Impersonation log with per-session / per-account
// toggle.
//
// Server Component. Fetches in parallel:
//   * the full impersonation_sessions list (last 30 days) for the
//     per-session render
//   * admin.impersonation_sessions_by_account() for the per-account
//     rollup render
//   * admin.admin_users + organisations for display-name resolution

export const dynamic = 'force-dynamic'

interface SessionRow {
  id: string
  admin_user_id: string
  target_org_id: string
  target_account_id: string | null
  reason: string
  reason_detail: string
  started_at: string
  ended_at: string | null
  expires_at: string
  status: string
}

interface AccountRollupRow {
  account_id: string
  account_name: string
  admin_user_id: string
  admin_name: string
  orgs_touched: number
  session_count: number
  total_seconds: number
  first_started: string
  last_started: string
  active_count: number
}

const WINDOW_DAYS = 30

export default async function ImpersonationLogPage() {
  const supabase = await createServerClient()

  // Server-rendered `force-dynamic` page — this component is re-invoked per
  // request, not memoised, so the "purity" lint rule doesn't apply in
  // practice. Date.now() here gives the request-start timestamp.
  const sinceIso = new Date(
    // eslint-disable-next-line react-hooks/purity
    Date.now() - WINDOW_DAYS * 24 * 60 * 60 * 1000,
  ).toISOString()

  const [sessionsRes, rollupRes, adminsRes, orgsRes] = await Promise.all([
    supabase
      .schema('admin')
      .from('impersonation_sessions')
      .select(
        'id, admin_user_id, target_org_id, target_account_id, reason, reason_detail, started_at, ended_at, expires_at, status',
      )
      .gte('started_at', sinceIso)
      .order('started_at', { ascending: false })
      .limit(500),
    supabase
      .schema('admin')
      .rpc('impersonation_sessions_by_account', { p_window_days: WINDOW_DAYS }),
    supabase.schema('admin').from('admin_users').select('id, display_name'),
    supabase
      .from('organisations')
      .select('id, name, account_id, accounts(name, plan_code)'),
  ])

  const adminById = new Map<string, string>()
  for (const a of adminsRes.data ?? []) adminById.set(a.id, a.display_name)

  type OrgRow = {
    id: string
    name: string
    account_id: string | null
    accounts:
      | Array<{ name: string; plan_code: string }>
      | { name: string; plan_code: string }
      | null
  }
  const orgLookup = new Map<
    string,
    { name: string; account_id: string | null; account_name: string | null }
  >()
  for (const o of (orgsRes.data ?? []) as OrgRow[]) {
    const acct = Array.isArray(o.accounts) ? o.accounts[0] : o.accounts
    orgLookup.set(o.id, {
      name: o.name,
      account_id: o.account_id ?? null,
      account_name: acct?.name ?? null,
    })
  }

  const sessions = ((sessionsRes.data ?? []) as SessionRow[]).map((s) => ({
    ...s,
    admin_name: adminById.get(s.admin_user_id) ?? null,
    org_name: orgLookup.get(s.target_org_id)?.name ?? null,
    derived_account_id:
      s.target_account_id ??
      orgLookup.get(s.target_org_id)?.account_id ??
      null,
    derived_account_name:
      (s.target_account_id
        ? null // the RPC already resolves names for target_account_id; here we just need a label.
        : orgLookup.get(s.target_org_id)?.account_name) ?? null,
  }))

  const rollup = ((rollupRes.data ?? []) as AccountRollupRow[]).map((r) => ({
    ...r,
    total_seconds: Number(r.total_seconds ?? 0),
    orgs_touched: Number(r.orgs_touched ?? 0),
    session_count: Number(r.session_count ?? 0),
    active_count: Number(r.active_count ?? 0),
  }))

  const activeNow = sessions.filter((s) => s.status === 'active').length

  return (
    <div className="mx-auto max-w-6xl space-y-4">
      <header>
        <p className="text-xs text-text-3">
          <Link href="/audit-log" className="hover:underline">
            ← Audit Log
          </Link>
        </p>
        <h1 className="mt-1 text-xl font-semibold">Impersonation Log</h1>
        <p className="text-sm text-text-2">
          Rule 23: time-boxed, reason-required, customer-notified. Last{' '}
          {WINDOW_DAYS} days · {sessions.length}{' '}
          {sessions.length === 1 ? 'session' : 'sessions'} ·{' '}
          <span className={activeNow > 0 ? 'font-medium text-amber-700' : ''}>
            {activeNow} active now
          </span>
          .
        </p>
      </header>

      {sessionsRes.error ? (
        <div className="rounded border border-red-200 bg-red-50 p-3 text-xs text-red-800">
          sessions query: {sessionsRes.error.message}
        </div>
      ) : null}
      {rollupRes.error ? (
        <div className="rounded border border-red-200 bg-red-50 p-3 text-xs text-red-800">
          rollup rpc: {rollupRes.error.message}
        </div>
      ) : null}

      <ImpersonationLogTabs sessions={sessions} rollup={rollup} />
    </div>
  )
}
