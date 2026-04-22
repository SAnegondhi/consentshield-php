'use client'

import { useState, useTransition } from 'react'
import { setFlagStatusAction } from '@/app/(operator)/readiness/actions'

// ADR-1017 Sprint 1.2 — readiness list component.

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
  critical: 'border-red-400/40 bg-red-500/15 text-red-200',
  high:     'border-orange-400/40 bg-orange-500/15 text-orange-200',
  medium:   'border-amber-400/40 bg-amber-500/15 text-amber-200',
  low:      'border-zinc-400/30 bg-zinc-500/10 text-zinc-300',
}

const STATUS_CLASS: Record<ReadinessStatus, string> = {
  pending:     'border-red-400/30 bg-red-500/10 text-red-200',
  in_progress: 'border-amber-400/30 bg-amber-500/10 text-amber-200',
  resolved:    'border-emerald-400/30 bg-emerald-500/10 text-emerald-200',
  deferred:    'border-zinc-400/20 bg-zinc-500/10 text-zinc-300',
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
      <div className="rounded-md border border-white/10 bg-white/[.02] p-6 text-center text-[13px] text-text-2">
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
    <article className="rounded-md border border-white/[.08] bg-white/[.02] p-4 shadow-sm">
      <header className="mb-2 flex flex-wrap items-center gap-2">
        <h3 className="mr-auto text-[14px] font-semibold text-white/90">{flag.title}</h3>
        <span className={chip(SEVERITY_CLASS[flag.severity])}>{flag.severity}</span>
        <span className={chip(STATUS_CLASS[flag.status])}>{flag.status.replace('_', ' ')}</span>
      </header>

      <div className="mb-3 grid gap-1 text-[12px] text-text-2">
        <div>
          <span className="text-white/50">Source:</span>{' '}
          <span className="font-mono">{flag.source_adr}</span>
          <span className="px-2 text-white/30">·</span>
          <span className="text-white/50">Blocker:</span> {flag.blocker_type}
          {flag.owner ? (
            <>
              <span className="px-2 text-white/30">·</span>
              <span className="text-white/50">Owner:</span> {flag.owner}
            </>
          ) : null}
        </div>
        <div>
          <span className="text-white/50">Created:</span>{' '}
          {new Date(flag.created_at).toLocaleString()}
          {flag.resolved_at ? (
            <>
              <span className="px-2 text-white/30">·</span>
              <span className="text-white/50">Resolved:</span>{' '}
              {new Date(flag.resolved_at).toLocaleString()}
              {flag.resolved_by_email ? ` by ${flag.resolved_by_email}` : ''}
            </>
          ) : null}
        </div>
      </div>

      <p className="mb-3 whitespace-pre-wrap text-[13px] text-white/80">{flag.description}</p>

      {flag.resolution_notes ? (
        <p className="mb-3 rounded border border-white/[.06] bg-white/[.03] p-2 text-[12px] text-text-2">
          <span className="text-white/50">Notes: </span>
          {flag.resolution_notes}
        </p>
      ) : null}

      {canOperate ? (
        <div className="border-t border-white/[.06] pt-3">
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Optional resolution notes (recorded in admin_audit_log)"
            className="mb-2 w-full rounded border border-white/10 bg-white/[.03] p-2 text-[12px] text-white/90 placeholder:text-white/30 focus:border-white/25 focus:outline-none"
            rows={2}
          />
          <div className="flex flex-wrap gap-2">
            {flag.status !== 'in_progress' ? (
              <ActionButton disabled={isPending} onClick={() => act('in_progress')}>
                Mark in progress
              </ActionButton>
            ) : null}
            {flag.status !== 'resolved' ? (
              <ActionButton disabled={isPending} onClick={() => act('resolved')}>
                Resolve
              </ActionButton>
            ) : null}
            {flag.status !== 'deferred' ? (
              <ActionButton disabled={isPending} onClick={() => act('deferred')}>
                Defer
              </ActionButton>
            ) : null}
            {flag.status !== 'pending' ? (
              <ActionButton disabled={isPending} onClick={() => act('pending')}>
                Reopen
              </ActionButton>
            ) : null}
          </div>
          {error ? <p className="mt-2 text-[12px] text-red-300">{error}</p> : null}
        </div>
      ) : (
        <p className="border-t border-white/[.06] pt-2 text-[11px] text-white/40">
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
  children,
}: {
  onClick: () => void
  disabled?: boolean
  children: React.ReactNode
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      type="button"
      className="rounded-md border border-white/10 bg-white/[.04] px-3 py-1.5 text-[12px] text-white/80 transition-colors hover:bg-white/10 hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
    >
      {children}
    </button>
  )
}
