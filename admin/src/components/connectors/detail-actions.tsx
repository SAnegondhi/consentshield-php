'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import {
  ModalShell,
  ReasonField,
  FormFooter,
} from '@/components/common/modal-form'
import { deprecateConnector } from '@/app/(operator)/connectors/actions'

// ADR-0031 Sprint 1.2 — Connector detail-page action bar.
//
// Status-aware:
//   active      → Edit (link) + Deprecate (modal)
//   deprecated  → Clone as new version (link to /connectors/new?from=<id>) + read-only notice
//   retired     → View only (nothing)

type Modal = { kind: 'deprecate' } | null

interface Candidate {
  id: string
  label: string
}

export function ConnectorDetailActions({
  connectorId,
  status,
  canWrite,
  activeCandidates,
}: {
  connectorId: string
  status: 'active' | 'deprecated' | 'retired'
  canWrite: boolean
  activeCandidates: Candidate[]
}) {
  const [modal, setModal] = useState<Modal>(null)

  if (status === 'retired') {
    return (
      <p className="rounded border border-[color:var(--border)] bg-bg p-3 text-xs text-text-2">
        Retired connectors are read-only. Ship a new version via{' '}
        <strong>+ New connector</strong>.
      </p>
    )
  }

  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        {status === 'active' ? (
          <>
            <Link
              href={`/connectors/${connectorId}/edit`}
              className="rounded border border-[color:var(--border-mid)] bg-white px-3 py-1.5 text-xs text-text hover:bg-bg"
            >
              Edit
            </Link>
            <button
              type="button"
              onClick={() => setModal({ kind: 'deprecate' })}
              disabled={!canWrite}
              title={canWrite ? undefined : 'platform_operator role required'}
              className="rounded border border-red-300 bg-white px-3 py-1.5 text-xs text-red-700 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Deprecate
            </button>
          </>
        ) : null}
        {status === 'deprecated' ? (
          <>
            <Link
              href={`/connectors/new?from=${connectorId}`}
              className="rounded border border-[color:var(--border-mid)] bg-white px-3 py-1.5 text-xs text-text hover:bg-bg"
            >
              Clone as new version
            </Link>
            <span className="rounded border border-[color:var(--border)] bg-bg px-3 py-1.5 text-xs text-text-2">
              Deprecated — edits disabled
            </span>
          </>
        ) : null}
      </div>

      {modal?.kind === 'deprecate' ? (
        <DeprecateModal
          connectorId={connectorId}
          onClose={() => setModal(null)}
          candidates={activeCandidates}
        />
      ) : null}
    </>
  )
}

function DeprecateModal({
  connectorId,
  candidates,
  onClose,
}: {
  connectorId: string
  candidates: Candidate[]
  onClose: () => void
}) {
  const router = useRouter()
  const [replacementId, setReplacementId] = useState('')
  const [cutoverDate, setCutoverDate] = useState('')
  const [reason, setReason] = useState('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const reasonOk = reason.trim().length >= 10

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setPending(true)
    setError(null)
    const r = await deprecateConnector({
      connectorId,
      replacementId: replacementId || null,
      cutoverDeadline: cutoverDate ? new Date(cutoverDate).toISOString() : null,
      reason,
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
      title="Deprecate connector"
      subtitle="Customers using this connector will see a migration prompt when a replacement is set."
      onClose={onClose}
    >
      <form onSubmit={onSubmit} className="space-y-4 p-4">
        <label className="block text-xs font-medium uppercase tracking-wider text-text-3">
          Replacement connector (optional)
          <select
            value={replacementId}
            onChange={(e) => setReplacementId(e.target.value)}
            className="mt-1 block w-full rounded border border-[color:var(--border-mid)] px-2 py-1.5 text-sm"
          >
            <option value="">— no replacement —</option>
            {candidates.map((c) => (
              <option key={c.id} value={c.id}>
                {c.label}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-xs font-medium uppercase tracking-wider text-text-3">
          Cutover deadline (optional)
          <input
            type="date"
            value={cutoverDate}
            onChange={(e) => setCutoverDate(e.target.value)}
            className="mt-1 block w-full rounded border border-[color:var(--border-mid)] px-2 py-1.5 text-sm"
          />
        </label>
        <ReasonField reason={reason} onChange={setReason} />
        {error ? <p className="text-sm text-red-700">{error}</p> : null}
        <FormFooter
          pending={pending}
          onClose={onClose}
          submit="Deprecate"
          submitDanger
          disabled={!reasonOk}
        />
      </form>
    </ModalShell>
  )
}
