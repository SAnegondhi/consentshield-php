'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import {
  ModalShell,
  ReasonField,
  FormFooter,
} from '@/components/common/modal-form'
import {
  publishTemplate,
  deprecateTemplate,
} from '@/app/(operator)/templates/actions'

// ADR-0030 Sprint 2.1 — Detail-page action bar.
//
// Status-aware:
//   draft       → Edit (link) + Publish (modal)
//   published   → Clone as new version (link to /templates/new?from=<id>) + Deprecate (modal)
//   deprecated  → View only (nothing)
//
// Publish + Deprecate are platform_operator-only (RPC enforces;
// disabled visually when canPublish=false).

type Modal = { kind: 'publish' } | { kind: 'deprecate' } | null

export function TemplateDetailActions({
  templateId,
  status,
  canPublish,
}: {
  templateId: string
  status: 'draft' | 'published' | 'deprecated'
  canPublish: boolean
}) {
  const [modal, setModal] = useState<Modal>(null)

  if (status === 'deprecated') {
    return (
      <p className="rounded border border-[color:var(--border)] bg-bg p-3 text-xs text-text-2">
        Deprecated templates are read-only. To ship an updated version, use{' '}
        <strong>Clone as new version</strong> from the most recent published
        version of this template_code (if any).
      </p>
    )
  }

  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        {status === 'draft' ? (
          <>
            <Link
              href={`/templates/${templateId}/edit`}
              className="rounded border border-[color:var(--border-mid)] bg-white px-3 py-1.5 text-xs text-text hover:bg-bg"
            >
              Edit
            </Link>
            <button
              type="button"
              onClick={() => setModal({ kind: 'publish' })}
              disabled={!canPublish}
              title={canPublish ? undefined : 'platform_operator role required'}
              className="rounded bg-teal px-3 py-1.5 text-xs font-medium text-white hover:bg-teal-mid disabled:cursor-not-allowed disabled:opacity-50"
            >
              Publish
            </button>
          </>
        ) : null}
        {status === 'published' ? (
          <>
            <Link
              href={`/templates/new?from=${templateId}`}
              className="rounded border border-[color:var(--border-mid)] bg-white px-3 py-1.5 text-xs text-text hover:bg-bg"
            >
              Clone as new version
            </Link>
            <button
              type="button"
              onClick={() => setModal({ kind: 'deprecate' })}
              disabled={!canPublish}
              title={canPublish ? undefined : 'platform_operator role required'}
              className="rounded border border-red-300 bg-white px-3 py-1.5 text-xs text-red-700 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Deprecate
            </button>
          </>
        ) : null}
      </div>

      {modal?.kind === 'publish' ? (
        <PublishModal templateId={templateId} onClose={() => setModal(null)} />
      ) : null}
      {modal?.kind === 'deprecate' ? (
        <DeprecateModal templateId={templateId} onClose={() => setModal(null)} />
      ) : null}
    </>
  )
}

function PublishModal({
  templateId,
  onClose,
}: {
  templateId: string
  onClose: () => void
}) {
  const router = useRouter()
  const [notes, setNotes] = useState('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const notesOk = notes.trim().length >= 10

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setPending(true)
    setError(null)
    const r = await publishTemplate(templateId, notes)
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
      title="Publish template"
      subtitle="Auto-deprecates the prior published version of the same template_code."
      onClose={onClose}
    >
      <form onSubmit={onSubmit} className="space-y-4 p-4">
        <div className="rounded border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
          <strong>Once published, this version is immutable.</strong> To make
          further changes, use <em>Clone as new version</em> to create a new
          draft.
        </div>
        <ReasonField reason={notes} onChange={setNotes} />
        {error ? <p className="text-sm text-red-700">{error}</p> : null}
        <FormFooter
          pending={pending}
          onClose={onClose}
          submit="Publish"
          disabled={!notesOk}
        />
      </form>
    </ModalShell>
  )
}

function DeprecateModal({
  templateId,
  onClose,
}: {
  templateId: string
  onClose: () => void
}) {
  const router = useRouter()
  const [reason, setReason] = useState('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const reasonOk = reason.trim().length >= 10

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setPending(true)
    setError(null)
    const r = await deprecateTemplate(templateId, reason)
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
      title="Deprecate template"
      subtitle="Orgs currently using this template are not migrated automatically."
      onClose={onClose}
    >
      <form onSubmit={onSubmit} className="space-y-4 p-4">
        <div className="rounded border border-red-200 bg-red-50 p-3 text-xs text-red-900">
          <strong>No successor is recorded by this action.</strong> If there
          is a newer version, prefer cloning and publishing the new version —
          publish auto-deprecates the prior version with a successor link.
        </div>
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
