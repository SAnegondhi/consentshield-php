'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { publishDpia, supersedeDpia } from '../actions'

interface ReplacementCandidate {
  id: string
  title: string
  conducted_at: string
}

interface Props {
  dpia: { id: string; status: string }
  canAct: boolean
  replacementCandidates: ReplacementCandidate[]
}

export function DpiaDetailActions({ dpia, canAct, replacementCandidates }: Props) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [replacementId, setReplacementId] = useState<string>('')

  if (!canAct) {
    return (
      <div className="rounded border border-gray-200 bg-gray-50 p-3 text-xs text-gray-500">
        Read-only — only account_owner / org_admin can publish or supersede DPIA records.
      </div>
    )
  }

  function handlePublish() {
    setError(null)
    startTransition(async () => {
      const result = await publishDpia(dpia.id)
      if ('error' in result) {
        setError(result.error)
      } else {
        router.refresh()
      }
    })
  }

  function handleSupersede() {
    setError(null)
    if (!replacementId) {
      setError('Select a replacement DPIA')
      return
    }
    startTransition(async () => {
      const result = await supersedeDpia(dpia.id, replacementId)
      if ('error' in result) {
        setError(result.error)
      } else {
        router.push(`/dashboard/dpia/${replacementId}`)
      }
    })
  }

  return (
    <section className="rounded-lg border border-gray-200 bg-white p-4">
      <h2 className="mb-3 text-sm font-semibold text-gray-700">Actions</h2>

      {dpia.status === 'draft' && (
        <div className="space-y-2">
          <p className="text-sm text-gray-600">This DPIA is still a draft.</p>
          <button
            onClick={handlePublish}
            disabled={isPending}
            className="rounded bg-emerald-700 px-3 py-1.5 text-sm text-white hover:bg-emerald-800 disabled:opacity-50"
          >
            {isPending ? 'Publishing…' : 'Publish DPIA'}
          </button>
        </div>
      )}

      {dpia.status === 'published' && (
        <div className="space-y-3">
          <p className="text-sm text-gray-600">
            Publish a new DPIA as a replacement, then supersede this one. Superseded DPIAs remain in the
            record (historical evidence) but are no longer active.
          </p>
          {replacementCandidates.length === 0 ? (
            <p className="text-xs text-gray-400 italic">
              No draft DPIAs available as replacement. Create one first.
            </p>
          ) : (
            <div className="flex items-center gap-2">
              <select
                value={replacementId}
                onChange={(e) => setReplacementId(e.target.value)}
                className="flex-1 rounded border border-gray-300 px-3 py-1.5 text-sm"
              >
                <option value="">Select replacement draft…</option>
                {replacementCandidates.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.title} (conducted {new Date(c.conducted_at).toLocaleDateString('en-IN')})
                  </option>
                ))}
              </select>
              <button
                onClick={handleSupersede}
                disabled={isPending || !replacementId}
                className="rounded border border-gray-300 px-3 py-1.5 text-sm hover:bg-gray-50 disabled:opacity-50"
              >
                {isPending ? 'Saving…' : 'Supersede with selected'}
              </button>
            </div>
          )}
        </div>
      )}

      {dpia.status === 'superseded' && (
        <p className="text-sm text-gray-400">
          This DPIA has been superseded — it is kept as historical record. Create a new DPIA to start a new cycle.
        </p>
      )}

      {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
    </section>
  )
}
