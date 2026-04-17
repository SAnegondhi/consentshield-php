'use client'

import { useState } from 'react'
import { startImpersonation } from '../../app/(operator)/orgs/[orgId]/impersonation-actions'

const REASONS = [
  { value: 'bug_investigation', label: 'Bug investigation' },
  { value: 'data_correction', label: 'Data correction' },
  { value: 'compliance_query', label: 'Compliance query' },
  { value: 'partner_demo', label: 'Partner demo' },
  { value: 'other', label: 'Other' },
] as const

const DURATIONS = [15, 30, 60, 120] as const

export function StartImpersonationDrawer({
  orgId,
  orgName,
}: {
  orgId: string
  orgName: string
}) {
  const [open, setOpen] = useState(false)
  const [reason, setReason] = useState<string>('bug_investigation')
  const [detail, setDetail] = useState('')
  const [duration, setDuration] = useState<number>(30)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const remaining = Math.max(0, 10 - detail.trim().length)
  const canSubmit = remaining === 0 && !pending

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setPending(true)
    setError(null)
    const r = await startImpersonation(orgId, orgName, reason, detail, duration)
    setPending(false)
    if (!r.ok) setError(r.error)
    else {
      setOpen(false)
      setDetail('')
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded bg-red-700 px-3 py-1.5 text-xs font-medium text-white hover:bg-red-800"
      >
        Start impersonation
      </button>

      {open ? (
        <div
          className="fixed inset-0 z-50 flex bg-black/30"
          onClick={(e) => {
            if (e.target === e.currentTarget) setOpen(false)
          }}
        >
          <div className="ml-auto flex h-full w-full max-w-md flex-col overflow-hidden bg-white shadow-xl">
            <header className="border-b border-zinc-200 bg-red-50 p-4">
              <p className="text-xs font-mono uppercase tracking-wider text-red-700">
                Privileged action
              </p>
              <h3 className="mt-1 text-base font-semibold">
                Start impersonation — {orgName}
              </h3>
              <p className="mt-1 text-xs text-zinc-700">
                The customer&rsquo;s compliance contact is notified within 5
                minutes. Rule 23: every page and every action during this
                session is audit-logged with the session ID.
              </p>
            </header>

            <form onSubmit={onSubmit} className="flex-1 space-y-4 overflow-y-auto p-4">
              <label className="flex flex-col gap-1">
                <span className="text-xs font-medium uppercase tracking-wider text-zinc-500">
                  Reason
                </span>
                <select
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  className="rounded border border-zinc-300 px-3 py-2 text-sm"
                >
                  {REASONS.map((r) => (
                    <option key={r.value} value={r.value}>
                      {r.label}
                    </option>
                  ))}
                </select>
              </label>

              <label className="flex flex-col gap-1">
                <span className="text-xs font-medium uppercase tracking-wider text-zinc-500">
                  Reason detail (≥ 10 chars — {remaining} more needed)
                </span>
                <textarea
                  value={detail}
                  onChange={(e) => setDetail(e.target.value)}
                  rows={4}
                  required
                  placeholder="Specific ticket / bug / invoice reference and what you'll do."
                  className="rounded border border-zinc-300 px-3 py-2 text-sm"
                />
              </label>

              <label className="flex flex-col gap-1">
                <span className="text-xs font-medium uppercase tracking-wider text-zinc-500">
                  Session duration
                </span>
                <select
                  value={duration}
                  onChange={(e) => setDuration(Number(e.target.value))}
                  className="rounded border border-zinc-300 px-3 py-2 text-sm"
                >
                  {DURATIONS.map((d) => (
                    <option key={d} value={d}>
                      {d} minutes {d === 30 ? '(default)' : d === 120 ? '(max)' : ''}
                    </option>
                  ))}
                </select>
              </label>

              {error ? (
                <p className="rounded border border-red-200 bg-red-50 p-2 text-sm text-red-900">
                  {error}
                </p>
              ) : null}

              <p className="text-xs text-zinc-500">
                By starting this session, you confirm you have a legitimate
                operational reason aligned with customer support and incident
                response policies.
              </p>
            </form>

            <footer className="flex items-center justify-end gap-2 border-t border-zinc-200 p-4">
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="rounded border border-zinc-300 bg-white px-3 py-1.5 text-xs text-zinc-700 hover:bg-zinc-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={onSubmit}
                disabled={!canSubmit}
                className="rounded bg-red-700 px-3 py-1.5 text-xs font-medium text-white hover:bg-red-800 disabled:opacity-50"
              >
                {pending ? 'Starting…' : 'Start session →'}
              </button>
            </footer>
          </div>
        </div>
      ) : null}
    </>
  )
}
