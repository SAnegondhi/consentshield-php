'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { Field, ReasonField } from '@/components/common/modal-form'
import { importPack } from '@/app/(operator)/signatures/actions'

// ADR-0031 Sprint 2.2 — Tracker signature pack import form.

export function ImportPackForm() {
  const router = useRouter()
  const [pack, setPack] = useState('')
  const [reason, setReason] = useState('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<{ count: number } | null>(null)

  const reasonOk = reason.trim().length >= 10
  const packPresent = pack.trim().length > 0

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setPending(true)
    setError(null)
    setResult(null)
    const r = await importPack({ packJson: pack, reason })
    setPending(false)
    if (!r.ok) {
      setError(r.error)
      return
    }
    setResult({ count: r.data!.count })
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <section className="rounded-md border border-[color:var(--border)] bg-white p-4 shadow-sm">
        <Field label="Pack JSON (array)">
          <textarea
            value={pack}
            onChange={(e) => setPack(e.target.value)}
            rows={14}
            placeholder="[ {...}, {...} ]"
            className="rounded border border-[color:var(--border-mid)] px-3 py-2 font-mono text-xs"
          />
        </Field>
      </section>

      <section className="rounded-md border border-[color:var(--border)] bg-white p-4 shadow-sm">
        <ReasonField reason={reason} onChange={setReason} />
      </section>

      {error ? (
        <p className="rounded border border-red-200 bg-red-50 p-3 text-sm text-red-800">
          {error}
        </p>
      ) : null}

      {result ? (
        <p className="rounded border border-green-200 bg-green-50 p-3 text-sm text-green-800">
          Imported {result.count} signature{result.count === 1 ? '' : 's'}.
          Existing codes were skipped.
        </p>
      ) : null}

      <div className="flex items-center justify-end gap-2">
        <button
          type="button"
          onClick={() => router.push('/signatures')}
          className="rounded border border-[color:var(--border)] bg-white px-3 py-1.5 text-xs text-text-2 hover:bg-bg"
        >
          {result ? 'Done' : 'Cancel'}
        </button>
        <button
          type="submit"
          disabled={pending || !reasonOk || !packPresent}
          className="rounded bg-teal px-3 py-1.5 text-xs font-medium text-white hover:bg-teal-mid disabled:opacity-50"
        >
          {pending ? 'Importing…' : 'Import pack'}
        </button>
      </div>
    </form>
  )
}
