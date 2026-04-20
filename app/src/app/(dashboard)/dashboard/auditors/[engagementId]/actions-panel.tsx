'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { completeEngagement, terminateEngagement, updateEngagement } from '../actions'

interface Engagement {
  id: string
  scope: string
  notes: string | null
  attestation_ref: string | null
  status: string
  engagement_start: string
}

interface Props {
  engagement: Engagement
  canAct: boolean
}

export function EngagementActions({ engagement, canAct }: Props) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [mode, setMode] = useState<'idle' | 'complete' | 'terminate' | 'update'>('idle')

  // Complete form
  const today = new Date().toISOString().slice(0, 10)
  const [endDate, setEndDate] = useState(today)
  const [completeAttestation, setCompleteAttestation] = useState('')

  // Terminate form
  const [termReason, setTermReason] = useState('')
  const [termEndDate, setTermEndDate] = useState(today)

  // Update form
  const [editScope, setEditScope] = useState(engagement.scope)
  const [editNotes, setEditNotes] = useState(engagement.notes ?? '')
  const [editAttestation, setEditAttestation] = useState(engagement.attestation_ref ?? '')

  if (!canAct) {
    return (
      <div className="rounded border border-gray-200 bg-gray-50 p-3 text-xs text-gray-500">
        Read-only — only account_owner / org_admin can complete, terminate, or update engagements.
      </div>
    )
  }

  function handleComplete() {
    setError(null)
    if (endDate < engagement.engagement_start) {
      setError('End date must be on or after engagement start')
      return
    }
    startTransition(async () => {
      const result = await completeEngagement(engagement.id, endDate, completeAttestation.trim() || null)
      if ('error' in result) {
        setError(result.error)
      } else {
        setMode('idle')
        router.refresh()
      }
    })
  }

  function handleTerminate() {
    setError(null)
    if (termReason.trim().length < 3) {
      setError('Reason is required (3+ characters)')
      return
    }
    startTransition(async () => {
      const result = await terminateEngagement(engagement.id, termEndDate, termReason.trim())
      if ('error' in result) {
        setError(result.error)
      } else {
        setMode('idle')
        router.refresh()
      }
    })
  }

  function handleUpdate() {
    setError(null)
    startTransition(async () => {
      const result = await updateEngagement(
        engagement.id,
        editScope.trim() !== engagement.scope ? editScope.trim() : null,
        editNotes.trim() || null,
        editAttestation.trim() || null,
      )
      if ('error' in result) {
        setError(result.error)
      } else {
        setMode('idle')
        router.refresh()
      }
    })
  }

  if (engagement.status === 'terminated') {
    return (
      <div className="rounded border border-gray-200 bg-gray-50 p-4 text-sm text-gray-500">
        This engagement was terminated — rows are frozen and cannot be edited.
      </div>
    )
  }

  return (
    <section className="rounded-lg border border-gray-200 bg-white p-4">
      <h2 className="mb-3 text-sm font-semibold text-gray-700">Actions</h2>

      {mode === 'idle' && (
        <div className="flex flex-wrap gap-2">
          {engagement.status === 'active' && (
            <>
              <button
                onClick={() => setMode('complete')}
                className="rounded bg-emerald-700 px-3 py-1.5 text-sm text-white hover:bg-emerald-800"
              >
                Mark complete
              </button>
              <button
                onClick={() => setMode('terminate')}
                className="rounded border border-red-300 bg-white px-3 py-1.5 text-sm text-red-700 hover:bg-red-50"
              >
                Terminate
              </button>
            </>
          )}
          <button
            onClick={() => setMode('update')}
            className="rounded border border-gray-200 bg-white px-3 py-1.5 text-sm hover:bg-gray-50"
          >
            Edit scope / notes / attestation
          </button>
        </div>
      )}

      {mode === 'complete' && (
        <div className="space-y-3">
          <div>
            <label className="mb-1 block text-xs uppercase tracking-wide text-gray-500">Engagement end *</label>
            <input
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              className="w-full rounded border border-gray-300 px-3 py-1.5 text-sm"
              min={engagement.engagement_start}
            />
          </div>
          <div>
            <label className="mb-1 block text-xs uppercase tracking-wide text-gray-500">Attestation reference</label>
            <input
              type="text"
              value={completeAttestation}
              onChange={(e) => setCompleteAttestation(e.target.value)}
              className="w-full rounded border border-gray-300 px-3 py-1.5 text-xs"
              placeholder="URL to final audit report (customer-stored)"
            />
          </div>
          {error && <p className="text-sm text-red-600">{error}</p>}
          <div className="flex justify-end gap-2">
            <button
              onClick={() => setMode('idle')}
              className="rounded border border-gray-200 px-3 py-1.5 text-sm hover:bg-gray-50"
            >
              Cancel
            </button>
            <button
              onClick={handleComplete}
              disabled={isPending}
              className="rounded bg-emerald-700 px-3 py-1.5 text-sm text-white hover:bg-emerald-800 disabled:opacity-50"
            >
              {isPending ? 'Saving…' : 'Mark complete'}
            </button>
          </div>
        </div>
      )}

      {mode === 'terminate' && (
        <div className="space-y-3">
          <div>
            <label className="mb-1 block text-xs uppercase tracking-wide text-gray-500">Termination date *</label>
            <input
              type="date"
              value={termEndDate}
              onChange={(e) => setTermEndDate(e.target.value)}
              className="w-full rounded border border-gray-300 px-3 py-1.5 text-sm"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs uppercase tracking-wide text-gray-500">Reason *</label>
            <textarea
              value={termReason}
              onChange={(e) => setTermReason(e.target.value)}
              className="w-full rounded border border-gray-300 px-3 py-1.5 text-sm"
              rows={3}
              placeholder="Why is this engagement being terminated?"
            />
          </div>
          {error && <p className="text-sm text-red-600">{error}</p>}
          <div className="flex justify-end gap-2">
            <button
              onClick={() => setMode('idle')}
              className="rounded border border-gray-200 px-3 py-1.5 text-sm hover:bg-gray-50"
            >
              Cancel
            </button>
            <button
              onClick={handleTerminate}
              disabled={isPending}
              className="rounded bg-red-700 px-3 py-1.5 text-sm text-white hover:bg-red-800 disabled:opacity-50"
            >
              {isPending ? 'Saving…' : 'Confirm terminate'}
            </button>
          </div>
        </div>
      )}

      {mode === 'update' && (
        <div className="space-y-3">
          <div>
            <label className="mb-1 block text-xs uppercase tracking-wide text-gray-500">Scope</label>
            <textarea
              value={editScope}
              onChange={(e) => setEditScope(e.target.value)}
              className="w-full rounded border border-gray-300 px-3 py-1.5 text-sm"
              rows={3}
            />
          </div>
          <div>
            <label className="mb-1 block text-xs uppercase tracking-wide text-gray-500">Notes</label>
            <textarea
              value={editNotes}
              onChange={(e) => setEditNotes(e.target.value)}
              className="w-full rounded border border-gray-300 px-3 py-1.5 text-sm"
              rows={3}
            />
          </div>
          <div>
            <label className="mb-1 block text-xs uppercase tracking-wide text-gray-500">Attestation reference</label>
            <input
              type="text"
              value={editAttestation}
              onChange={(e) => setEditAttestation(e.target.value)}
              className="w-full rounded border border-gray-300 px-3 py-1.5 text-xs"
            />
          </div>
          {error && <p className="text-sm text-red-600">{error}</p>}
          <div className="flex justify-end gap-2">
            <button
              onClick={() => setMode('idle')}
              className="rounded border border-gray-200 px-3 py-1.5 text-sm hover:bg-gray-50"
            >
              Cancel
            </button>
            <button
              onClick={handleUpdate}
              disabled={isPending}
              className="rounded bg-emerald-700 px-3 py-1.5 text-sm text-white hover:bg-emerald-800 disabled:opacity-50"
            >
              {isPending ? 'Saving…' : 'Save changes'}
            </button>
          </div>
        </div>
      )}
    </section>
  )
}
