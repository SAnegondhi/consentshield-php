'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  Field,
  FormFooter,
  ModalShell,
  ReasonField,
} from '@/components/common/modal-form'
import { setSdfStatus } from './actions'

// ADR-0046 Phase 1 Sprint 1.2 — admin SDF card on /orgs/[orgId].

type SdfStatus = 'not_designated' | 'self_declared' | 'notified' | 'exempt'

export interface SdfCardProps {
  orgId: string
  sdfStatus: SdfStatus
  sdfNotifiedAt: string | null
  sdfNotificationRef: string | null
  canWrite: boolean
}

const STATUS_LABEL: Record<SdfStatus, string> = {
  not_designated: 'Not designated',
  self_declared: 'Self-declared',
  notified: 'Notified (Gazette)',
  exempt: 'Exempt',
}

const STATUS_TONE: Record<SdfStatus, 'gray' | 'amber' | 'red' | 'green'> = {
  not_designated: 'gray',
  self_declared: 'amber',
  notified: 'red',
  exempt: 'green',
}

export function SdfCard({
  orgId,
  sdfStatus,
  sdfNotifiedAt,
  sdfNotificationRef,
  canWrite,
}: SdfCardProps) {
  const [open, setOpen] = useState(false)
  return (
    <section className="rounded-md border border-[color:var(--border)] bg-white shadow-sm">
      <header className="flex items-center justify-between border-b border-[color:var(--border)] px-4 py-2.5">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-semibold">SDF status</h2>
          <Pill tone={STATUS_TONE[sdfStatus]}>{STATUS_LABEL[sdfStatus]}</Pill>
        </div>
        <button
          type="button"
          onClick={() => setOpen(true)}
          disabled={!canWrite}
          title={canWrite ? undefined : 'platform_operator required'}
          className="rounded border border-[color:var(--border-mid)] bg-white px-2.5 py-1 text-[11px] hover:bg-bg disabled:cursor-not-allowed disabled:opacity-50"
        >
          Edit
        </button>
      </header>
      <div className="space-y-2 px-4 py-3 text-sm">
        <KV label="Status">{STATUS_LABEL[sdfStatus]}</KV>
        <KV label="Notification ref">
          {sdfNotificationRef ? (
            <code className="font-mono text-xs">{sdfNotificationRef}</code>
          ) : (
            <span className="text-text-3">—</span>
          )}
        </KV>
        <KV label="Notified at">
          {sdfNotifiedAt ? new Date(sdfNotifiedAt).toLocaleDateString() : <span className="text-text-3">—</span>}
        </KV>
      </div>
      <footer className="border-t border-[color:var(--border)] px-4 py-2 text-[11px] text-text-3">
        DPDP §10. Stores category + reference only — notification PDFs
        stay in the customer&rsquo;s own storage.
      </footer>

      {open ? (
        <SdfEditModal
          orgId={orgId}
          initialStatus={sdfStatus}
          initialRef={sdfNotificationRef ?? ''}
          initialNotifiedAt={sdfNotifiedAt ?? ''}
          onClose={() => setOpen(false)}
        />
      ) : null}
    </section>
  )
}

function KV({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-xs text-text-3">{label}</span>
      <span className="text-xs text-text-1">{children}</span>
    </div>
  )
}

function Pill({
  tone,
  children,
}: {
  tone: 'green' | 'amber' | 'red' | 'gray'
  children: React.ReactNode
}) {
  const classes =
    tone === 'green'
      ? 'rounded-full bg-green-100 px-2 py-0.5 text-[11px] font-medium text-green-700'
      : tone === 'amber'
        ? 'rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-800'
        : tone === 'red'
          ? 'rounded-full bg-red-100 px-2 py-0.5 text-[11px] font-medium text-red-700'
          : 'rounded-full bg-bg px-2 py-0.5 text-[11px] font-medium text-text-3'
  return <span className={classes}>{children}</span>
}

function SdfEditModal({
  orgId,
  initialStatus,
  initialRef,
  initialNotifiedAt,
  onClose,
}: {
  orgId: string
  initialStatus: SdfStatus
  initialRef: string
  initialNotifiedAt: string
  onClose: () => void
}) {
  const router = useRouter()
  const [status, setStatus] = useState<SdfStatus>(initialStatus)
  const [notificationRef, setNotificationRef] = useState(initialRef)
  const [notifiedAt, setNotifiedAt] = useState(() => {
    if (!initialNotifiedAt) return ''
    // datetime-local expects YYYY-MM-DDTHH:MM (no timezone).
    const d = new Date(initialNotifiedAt)
    const pad = (n: number) => String(n).padStart(2, '0')
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
  })
  const [reason, setReason] = useState('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const ok = reason.trim().length >= 10

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setPending(true)
    setError(null)
    const r = await setSdfStatus(orgId, {
      sdfStatus: status,
      notificationRef,
      notifiedAt,
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

  const isDesignated = status !== 'not_designated'

  return (
    <ModalShell
      title="SDF status"
      subtitle="Declare or update the organisation&rsquo;s Significant Data Fiduciary status. Reverting to 'not designated' clears the notification metadata."
      onClose={onClose}
    >
      <form onSubmit={onSubmit} className="space-y-4 p-4">
        <Field label="Status">
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value as SdfStatus)}
            className="rounded border border-[color:var(--border-mid)] bg-white px-3 py-1.5 text-sm"
          >
            <option value="not_designated">Not designated</option>
            <option value="self_declared">Self-declared</option>
            <option value="notified">Notified (Gazette)</option>
            <option value="exempt">Exempt</option>
          </select>
        </Field>
        <Field label="Notification reference">
          <input
            value={notificationRef}
            onChange={(e) => setNotificationRef(e.target.value)}
            placeholder="e.g. G.S.R. 123(E) 2026-04-10"
            disabled={!isDesignated}
            className="rounded border border-[color:var(--border-mid)] px-3 py-1.5 font-mono text-sm disabled:bg-bg disabled:text-text-3"
          />
        </Field>
        <Field label="Notified at">
          <input
            type="datetime-local"
            value={notifiedAt}
            onChange={(e) => setNotifiedAt(e.target.value)}
            disabled={!isDesignated}
            className="rounded border border-[color:var(--border-mid)] px-3 py-1.5 text-sm disabled:bg-bg disabled:text-text-3"
          />
        </Field>
        <ReasonField reason={reason} onChange={setReason} />
        {!isDesignated && (initialRef || initialNotifiedAt) ? (
          <p className="rounded border border-amber-200 bg-amber-50 p-2 text-[11px] text-amber-900">
            Reverting to not_designated will clear notification metadata.
          </p>
        ) : null}
        {error ? <p className="text-sm text-red-700">{error}</p> : null}
        <FormFooter pending={pending} onClose={onClose} submit="Save" disabled={!ok} />
      </form>
    </ModalShell>
  )
}
