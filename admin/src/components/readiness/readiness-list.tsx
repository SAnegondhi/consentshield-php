'use client'

import { useState, useTransition } from 'react'
import { setFlagStatusAction } from '@/app/(operator)/readiness/actions'

// ADR-1017 Sprint 1.2 — readiness list component.
// Uses admin-app light-theme tokens from src/app/globals.css:
//   text-text / text-text-2 / text-text-3, border-border-wf / border-border-mid,
//   bg-bg (page bg), bg-white (cards), bg-teal / bg-teal-mid (primary button).

export type ReadinessStatus = 'pending' | 'in_progress' | 'resolved' | 'deferred'
export type ReadinessSeverity = 'critical' | 'high' | 'medium' | 'low'
export type ReadinessBlockerType = 'legal' | 'partner' | 'infra' | 'contract' | 'hiring' | 'other'

export interface ReadinessFlag {
  id:                string
  title:             string
  description:       string
  source_adr:        string
  blocker_type:      ReadinessBlockerType
  severity:          ReadinessSeverity
  status:            ReadinessStatus
  owner:             string | null
  resolution_notes:  string | null
  resolved_by:       string | null
  resolved_by_email: string | null
  resolved_at:       string | null
  created_at:        string
  updated_at:        string
}

type AdminRole = 'platform_owner' | 'platform_operator' | 'support' | 'read_only'

const SEVERITY_CLASS: Record<ReadinessSeverity, string> = {
  critical: 'border-red-300 bg-red-50 text-red-700',
  high:     'border-orange-300 bg-orange-50 text-orange-700',
  medium:   'border-amber-300 bg-amber-50 text-amber-700',
  low:      'border-slate-300 bg-slate-50 text-slate-700',
}

const STATUS_CLASS: Record<ReadinessStatus, string> = {
  pending:     'border-red-300 bg-red-50 text-red-700',
  in_progress: 'border-amber-300 bg-amber-50 text-amber-700',
  resolved:    'border-emerald-300 bg-emerald-50 text-emerald-700',
  deferred:    'border-slate-300 bg-slate-50 text-slate-600',
}

export function ReadinessList({
  flags,
  adminRole,
}: {
  flags: ReadinessFlag[]
  adminRole: AdminRole
}) {
  if (flags.length === 0) {
    return (
      <div className="rounded-md border border-border-wf bg-white p-6 text-center text-sm text-text-2">
        No readiness flags recorded.
      </div>
    )
  }
  return (
    <ul className="space-y-3">
      {flags.map((f) => (
        <li key={f.id}>
          <FlagCard flag={f} adminRole={adminRole} />
        </li>
      ))}
    </ul>
  )
}

function FlagCard({ flag, adminRole }: { flag: ReadinessFlag; adminRole: AdminRole }) {
  const [notes, setNotes] = useState<string>('')
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  const canOperate = adminRole === 'platform_operator' || adminRole === 'platform_owner'

  function act(status: ReadinessStatus) {
    setError(null)
    startTransition(async () => {
      const res = await setFlagStatusAction({
        flagId: flag.id,
        status,
        resolutionNotes: notes.trim() || undefined,
      })
      if (!res.ok) setError(res.error)
      else setNotes('')
    })
  }

  return (
    <article className="rounded-md border border-border-wf bg-white p-4 shadow-sm">
      <header className="mb-2 flex flex-wrap items-center gap-2">
        <h3 className="mr-auto text-sm font-semibold text-text">{flag.title}</h3>
        <span className={chip(SEVERITY_CLASS[flag.severity])}>{flag.severity}</span>
        <span className={chip(STATUS_CLASS[flag.status])}>{flag.status.replace('_', ' ')}</span>
      </header>

      <div className="mb-3 grid gap-1 text-xs text-text-2">
        <div>
          <span className="text-text-3">Source:</span>{' '}
          <span className="font-mono">{flag.source_adr}</span>
          <span className="px-2 text-text-3">·</span>
          <span className="text-text-3">Blocker:</span> {flag.blocker_type}
          {flag.owner ? (
            <>
              <span className="px-2 text-text-3">·</span>
              <span className="text-text-3">Owner:</span> {flag.owner}
            </>
          ) : null}
        </div>
        <div>
          <span className="text-text-3">Created:</span>{' '}
          {new Date(flag.created_at).toLocaleString()}
          {flag.resolved_at ? (
            <>
              <span className="px-2 text-text-3">·</span>
              <span className="text-text-3">Resolved:</span>{' '}
              {new Date(flag.resolved_at).toLocaleString()}
              {flag.resolved_by_email ? ` by ${flag.resolved_by_email}` : ''}
            </>
          ) : null}
        </div>
      </div>

      <p className="mb-3 whitespace-pre-wrap text-sm text-text">{flag.description}</p>

      {flag.resolution_notes ? (
        <p className="mb-3 rounded border border-border-wf bg-bg p-2 text-xs text-text-2">
          <span className="text-text-3">Notes: </span>
          {flag.resolution_notes}
        </p>
      ) : null}

      {canOperate ? (
        <div className="border-t border-border-wf pt-3">
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Optional resolution notes (recorded in admin_audit_log)"
            className="mb-2 w-full rounded border border-border-mid bg-white p-2 text-xs text-text placeholder:text-text-3 focus:border-teal focus:outline-none"
            rows={2}
          />
          <div className="flex flex-wrap gap-2">
            {flag.status !== 'in_progress' ? (
              <ActionButton disabled={isPending} variant="secondary" onClick={() => act('in_progress')}>
                Mark in progress
              </ActionButton>
            ) : null}
            {flag.status !== 'resolved' ? (
              <ActionButton disabled={isPending} variant="primary" onClick={() => act('resolved')}>
                Resolve
              </ActionButton>
            ) : null}
            {flag.status !== 'deferred' ? (
              <ActionButton disabled={isPending} variant="secondary" onClick={() => act('deferred')}>
                Defer
              </ActionButton>
            ) : null}
            {flag.status !== 'pending' ? (
              <ActionButton disabled={isPending} variant="secondary" onClick={() => act('pending')}>
                Reopen
              </ActionButton>
            ) : null}
          </div>
          {error ? <p className="mt-2 text-xs text-red-600">{error}</p> : null}
        </div>
      ) : (
        <p className="border-t border-border-wf pt-2 text-xs text-text-3">
          Read-only — platform_operator or platform_owner required to change status.
        </p>
      )}
    </article>
  )
}

function chip(cls: string) {
  return `rounded-[10px] border px-2 py-[1px] text-[10px] font-semibold uppercase tracking-wide ${cls}`
}

function ActionButton({
  onClick,
  disabled,
  variant = 'secondary',
  children,
}: {
  onClick: () => void
  disabled?: boolean
  variant?: 'primary' | 'secondary'
  children: React.ReactNode
}) {
  const styles =
    variant === 'primary'
      ? 'bg-teal text-white hover:bg-teal-mid'
      : 'border border-border-mid bg-white text-text hover:bg-bg'
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      type="button"
      className={`rounded px-3 py-1.5 text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${styles}`}
    >
      {children}
    </button>
  )
}
