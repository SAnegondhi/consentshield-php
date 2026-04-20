'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  FormFooter,
  ModalShell,
  ReasonField,
} from '@/components/common/modal-form'
import {
  restoreAccountAction,
  suspendAccountAction,
  startAccountImpersonationAction,
} from '../actions'

// ADR-0048 Sprint 1.2 — Account detail action bar.

export function AccountActionBar({
  accountId,
  accountName,
  status,
  canWrite,
}: {
  accountId: string
  accountName: string
  status: string
  canWrite: boolean
}) {
  const [modal, setModal] = useState<null | 'suspend' | 'restore' | 'impersonate'>(null)
  const isSuspended = status === 'suspended'

  return (
    <div className="flex gap-2">
      {isSuspended ? (
        <button
          type="button"
          onClick={() => setModal('restore')}
          disabled={!canWrite}
          title={canWrite ? 'Restore account + child orgs' : 'platform_operator required'}
          className="rounded bg-teal px-3 py-1.5 text-xs font-medium text-white hover:bg-teal-dark disabled:cursor-not-allowed disabled:opacity-50"
        >
          Restore
        </button>
      ) : (
        <button
          type="button"
          onClick={() => setModal('suspend')}
          disabled={!canWrite}
          title={canWrite ? 'Suspend account + fan out to child orgs' : 'platform_operator required'}
          className="rounded border border-red-200 bg-white px-3 py-1.5 text-xs font-medium text-red-700 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50"
        >
          Suspend
        </button>
      )}

      {/* ADR-0055 Sprint 1.1 — account-scoped impersonation */}
      <button
        type="button"
        onClick={() => setModal('impersonate')}
        title="Start account-scoped impersonation (cross-org view). Support tier or higher."
        className="rounded border border-[color:var(--border)] bg-white px-3 py-1.5 text-xs font-medium text-text-1 hover:bg-bg"
      >
        Impersonate account
      </button>

      {modal === 'suspend' ? (
        <SuspendModal accountId={accountId} onClose={() => setModal(null)} />
      ) : null}
      {modal === 'restore' ? (
        <RestoreModal accountId={accountId} onClose={() => setModal(null)} />
      ) : null}
      {modal === 'impersonate' ? (
        <ImpersonateAccountModal
          accountId={accountId}
          accountName={accountName}
          onClose={() => setModal(null)}
        />
      ) : null}
    </div>
  )
}

function SuspendModal({
  accountId,
  onClose,
}: {
  accountId: string
  onClose: () => void
}) {
  const router = useRouter()
  const [reason, setReason] = useState('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const ok = reason.trim().length >= 10

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setPending(true)
    setError(null)
    const r = await suspendAccountAction({ accountId, reason })
    setPending(false)
    if (!r.ok) {
      setError(r.error)
      return
    }
    onClose()
    router.refresh()
  }

  return (
    <ModalShell
      title="Suspend account"
      subtitle="Sets accounts.status=suspended and flips every currently-active child org to suspended. Worker stops serving the account's banner on the next KV sync (~2 min). Restore reverses the fan-out set captured at suspend time."
      onClose={onClose}
    >
      <form onSubmit={onSubmit} className="space-y-4 p-4">
        <ReasonField reason={reason} onChange={setReason} />
        {error ? <p className="text-sm text-red-700">{error}</p> : null}
        <FormFooter
          pending={pending}
          onClose={onClose}
          submit="Suspend"
          submitDanger
          disabled={!ok}
        />
      </form>
    </ModalShell>
  )
}

const IMPERSONATION_REASONS = [
  { value: 'bug_investigation', label: 'Bug investigation' },
  { value: 'data_correction', label: 'Data correction' },
  { value: 'compliance_query', label: 'Compliance query' },
  { value: 'partner_demo', label: 'Partner demo' },
  { value: 'other', label: 'Other' },
] as const

function ImpersonateAccountModal({
  accountId,
  accountName,
  onClose,
}: {
  accountId: string
  accountName: string
  onClose: () => void
}) {
  const router = useRouter()
  const [reason, setReason] = useState<string>('bug_investigation')
  const [reasonDetail, setReasonDetail] = useState('')
  const [durationMinutes, setDurationMinutes] = useState<number>(30)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const ok = reasonDetail.trim().length >= 10

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setPending(true)
    setError(null)
    const r = await startAccountImpersonationAction({
      accountId,
      accountName,
      reason,
      reasonDetail,
      durationMinutes,
    })
    setPending(false)
    if (!r.ok) {
      setError(r.error)
      return
    }
    onClose()
    router.refresh()
  }

  return (
    <ModalShell
      title={`Impersonate account — ${accountName}`}
      subtitle="Account-scoped impersonation gives operators a cross-org view of billing, settings, and audit trail. Time-boxed, reason-bound, audit-logged. The account_owner is notified within 5 minutes."
      onClose={onClose}
    >
      <form onSubmit={onSubmit} className="space-y-4 p-4">
        <label className="flex flex-col text-[11px] text-text-3">
          <span className="mb-1">Reason</span>
          <select
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            className="rounded border border-[color:var(--border-mid)] bg-white px-2 py-1 text-sm"
          >
            {IMPERSONATION_REASONS.map((r) => (
              <option key={r.value} value={r.value}>
                {r.label}
              </option>
            ))}
          </select>
        </label>
        <ReasonField reason={reasonDetail} onChange={setReasonDetail} />
        <label className="flex flex-col text-[11px] text-text-3">
          <span className="mb-1">Duration (minutes)</span>
          <select
            value={durationMinutes}
            onChange={(e) => setDurationMinutes(Number(e.target.value))}
            className="w-32 rounded border border-[color:var(--border-mid)] bg-white px-2 py-1 text-sm"
          >
            {[15, 30, 60, 120].map((d) => (
              <option key={d} value={d}>
                {d} min
              </option>
            ))}
          </select>
        </label>
        {error ? <p className="text-sm text-red-700">{error}</p> : null}
        <FormFooter
          pending={pending}
          onClose={onClose}
          submit="Start impersonation"
          disabled={!ok}
        />
      </form>
    </ModalShell>
  )
}

function RestoreModal({
  accountId,
  onClose,
}: {
  accountId: string
  onClose: () => void
}) {
  const router = useRouter()
  const [reason, setReason] = useState('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const ok = reason.trim().length >= 10

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setPending(true)
    setError(null)
    const r = await restoreAccountAction({ accountId, reason })
    setPending(false)
    if (!r.ok) {
      setError(r.error)
      return
    }
    onClose()
    router.refresh()
  }

  return (
    <ModalShell
      title="Restore account"
      subtitle="Sets accounts.status=active and restores only the orgs captured in the most recent suspend audit row. Orgs suspended separately (e.g., operator-disabled individually) stay suspended."
      onClose={onClose}
    >
      <form onSubmit={onSubmit} className="space-y-4 p-4">
        <ReasonField reason={reason} onChange={setReason} />
        {error ? <p className="text-sm text-red-700">{error}</p> : null}
        <FormFooter
          pending={pending}
          onClose={onClose}
          submit="Restore"
          disabled={!ok}
        />
      </form>
    </ModalShell>
  )
}
