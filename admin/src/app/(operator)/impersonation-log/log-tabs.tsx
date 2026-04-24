'use client'

import { useState } from 'react'

// ADR-1027 Sprint 3.1 — client-side toggle between per-session + per-account.

interface Session {
  id: string
  admin_user_id: string
  admin_name: string | null
  target_org_id: string
  org_name: string | null
  derived_account_id: string | null
  derived_account_name: string | null
  reason: string
  reason_detail: string
  started_at: string
  ended_at: string | null
  expires_at: string
  status: string
}

interface Rollup {
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

type View = 'session' | 'account'

export function ImpersonationLogTabs({
  sessions,
  rollup,
}: {
  sessions: Session[]
  rollup: Rollup[]
}) {
  const [view, setView] = useState<View>('session')

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-end gap-2 text-xs text-text-3">
        <span>Group by:</span>
        <div className="flex rounded-md border border-[color:var(--border)] bg-white p-0.5 shadow-sm">
          <button
            type="button"
            onClick={() => setView('session')}
            className={
              view === 'session'
                ? 'rounded bg-teal px-2.5 py-1 text-[11px] font-medium text-white'
                : 'rounded px-2.5 py-1 text-[11px] text-text-2 hover:bg-bg'
            }
          >
            Sessions
          </button>
          <button
            type="button"
            onClick={() => setView('account')}
            className={
              view === 'account'
                ? 'rounded bg-teal px-2.5 py-1 text-[11px] font-medium text-white'
                : 'rounded px-2.5 py-1 text-[11px] text-text-2 hover:bg-bg'
            }
          >
            Accounts
          </button>
        </div>
      </div>

      {view === 'session' ? (
        <SessionTable sessions={sessions} />
      ) : (
        <AccountTable rollup={rollup} />
      )}
    </div>
  )
}

function SessionTable({ sessions }: { sessions: Session[] }) {
  if (sessions.length === 0) {
    return (
      <div className="rounded-md border border-[color:var(--border)] bg-white p-8 text-center text-sm text-text-3 shadow-sm">
        No impersonation sessions in the last 30 days.
      </div>
    )
  }

  return (
    <div className="overflow-hidden rounded-md border border-[color:var(--border)] bg-white shadow-sm">
      <table className="w-full text-sm">
        <thead className="bg-bg text-left text-xs uppercase tracking-wider text-text-3">
          <tr>
            <th className="px-4 py-2">Started</th>
            <th className="px-4 py-2">Operator</th>
            <th className="px-4 py-2">Target · Org</th>
            <th className="px-4 py-2">Reason</th>
            <th className="px-4 py-2">Duration</th>
            <th className="px-4 py-2">Status</th>
          </tr>
        </thead>
        <tbody>
          {sessions.map((s) => (
            <tr key={s.id} className="border-t border-[color:var(--border)]">
              <td className="px-4 py-2 font-mono text-[11px] text-text-3">
                {new Date(s.started_at).toLocaleString('en-IN', {
                  dateStyle: 'short',
                  timeStyle: 'short',
                })}
              </td>
              <td className="px-4 py-2 text-xs">
                {s.admin_name ?? s.admin_user_id.slice(0, 8)}
              </td>
              <td className="px-4 py-2 text-xs">
                <div>{s.derived_account_name ?? '—'}</div>
                <div className="text-[11px] text-text-3">
                  {s.org_name ?? s.target_org_id.slice(0, 8)}
                </div>
              </td>
              <td className="px-4 py-2 text-[11px] text-text-2" title={s.reason_detail}>
                <span className="font-mono text-red-700">{s.reason}</span>
                <div className="truncate">
                  {s.reason_detail.length > 80
                    ? s.reason_detail.slice(0, 79) + '…'
                    : s.reason_detail}
                </div>
              </td>
              <td className="px-4 py-2 text-xs">{formatDuration(s)}</td>
              <td className="px-4 py-2">
                <StatusPill status={s.status} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function AccountTable({ rollup }: { rollup: Rollup[] }) {
  if (rollup.length === 0) {
    return (
      <div className="rounded-md border border-[color:var(--border)] bg-white p-8 text-center text-sm text-text-3 shadow-sm">
        No impersonation activity against any account in the last 30 days.
      </div>
    )
  }

  return (
    <div className="overflow-hidden rounded-md border border-[color:var(--border)] bg-white shadow-sm">
      <table className="w-full text-sm">
        <thead className="bg-bg text-left text-xs uppercase tracking-wider text-text-3">
          <tr>
            <th className="px-4 py-2">Account</th>
            <th className="px-4 py-2">Operator</th>
            <th className="px-4 py-2">Sessions</th>
            <th className="px-4 py-2">Orgs touched</th>
            <th className="px-4 py-2">Total duration</th>
            <th className="px-4 py-2">First</th>
            <th className="px-4 py-2">Last</th>
            <th className="px-4 py-2">Active</th>
          </tr>
        </thead>
        <tbody>
          {rollup.map((r) => (
            <tr
              key={`${r.account_id}-${r.admin_user_id}`}
              className="border-t border-[color:var(--border)]"
            >
              <td className="px-4 py-2 text-xs">
                <strong>{r.account_name ?? '—'}</strong>
              </td>
              <td className="px-4 py-2 text-xs">
                {r.admin_name ?? r.admin_user_id.slice(0, 8)}
              </td>
              <td className="px-4 py-2 text-xs">{r.session_count}</td>
              <td className="px-4 py-2 text-xs">{r.orgs_touched}</td>
              <td className="px-4 py-2 text-xs">{formatSeconds(r.total_seconds)}</td>
              <td className="px-4 py-2 font-mono text-[11px] text-text-3">
                {new Date(r.first_started).toLocaleDateString('en-IN')}
              </td>
              <td className="px-4 py-2 font-mono text-[11px] text-text-3">
                {new Date(r.last_started).toLocaleDateString('en-IN')}
              </td>
              <td className="px-4 py-2 text-xs">
                {r.active_count > 0 ? (
                  <span className="font-medium text-amber-700">
                    {r.active_count}
                  </span>
                ) : (
                  '—'
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function StatusPill({ status }: { status: string }) {
  const tone =
    status === 'active'
      ? 'bg-amber-100 text-amber-800'
      : status === 'completed'
        ? 'bg-green-100 text-green-700'
        : status === 'expired'
          ? 'bg-bg text-text-3'
          : 'bg-red-100 text-red-700'
  return (
    <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${tone}`}>
      {status}
    </span>
  )
}

function formatDuration(s: {
  started_at: string
  ended_at: string | null
}): string {
  const end = s.ended_at ? new Date(s.ended_at).getTime() : Date.now()
  const start = new Date(s.started_at).getTime()
  const seconds = Math.max(0, Math.floor((end - start) / 1000))
  return formatSeconds(seconds)
}

function formatSeconds(seconds: number): string {
  if (seconds < 60) return `${seconds}s`
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${seconds % 60}s`
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  return `${h}h ${m}m`
}
