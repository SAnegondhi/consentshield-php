'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import {
  ModalShell,
  ReasonField,
  FormFooter,
} from '@/components/common/modal-form'
import { deprecateSignature } from '@/app/(operator)/signatures/actions'

// ADR-0031 Sprint 2.2 — Signature detail-page action bar.

type Modal = { kind: 'deprecate' } | null

export function SignatureDetailActions({
  signatureId,
  status,
}: {
  signatureId: string
  status: 'active' | 'deprecated'
}) {
  const [modal, setModal] = useState<Modal>(null)

  if (status === 'deprecated') {
    return (
      <p className="rounded border border-[color:var(--border)] bg-bg p-3 text-xs text-text-2">
        Deprecated signatures are excluded from the KV snapshot. Create a new
        signature to replace it.
      </p>
    )
  }

  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <Link
          href={`/signatures/${signatureId}/edit`}
          className="rounded border border-[color:var(--border-mid)] bg-white px-3 py-1.5 text-xs text-text hover:bg-bg"
        >
          Edit
        </Link>
        <button
          type="button"
          onClick={() => setModal({ kind: 'deprecate' })}
          className="rounded border border-red-300 bg-white px-3 py-1.5 text-xs text-red-700 hover:bg-red-50"
        >
          Deprecate
        </button>
      </div>

      {modal?.kind === 'deprecate' ? (
        <DeprecateModal
          signatureId={signatureId}
          onClose={() => setModal(null)}
        />
      ) : null}
    </>
  )
}

function DeprecateModal({
  signatureId,
  onClose,
}: {
  signatureId: string
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
    const r = await deprecateSignature(signatureId, reason)
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
      title="Deprecate signature"
      subtitle="Excluded from the KV snapshot within 2 minutes."
      onClose={onClose}
    >
      <form onSubmit={onSubmit} className="space-y-4 p-4">
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
