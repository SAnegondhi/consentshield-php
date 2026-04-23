'use client'

// ADR-1004 Phase 2 Sprint 2.2 — publish-notice form.
//
// Client component because we need useState for the markdown textarea +
// the material-change toggle and useTransition for the server action.

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { publishNoticeAction } from './actions'

export function PublishNoticeForm({
  orgId,
  nextVersion,
  affectedOnPriorVersion,
}: {
  orgId: string
  nextVersion: number
  affectedOnPriorVersion: number
}) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [material, setMaterial] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  const titleOk = title.trim().length >= 3
  const bodyOk = body.trim().length >= 10
  const canSubmit = titleOk && bodyOk && !isPending

  const submit = () => {
    setError(null)
    setSuccess(null)
    startTransition(async () => {
      const result = await publishNoticeAction({
        orgId,
        title,
        bodyMarkdown: body,
        materialChange: material,
      })
      if (!result.ok) {
        setError(result.error)
        return
      }
      setSuccess(`Published v${result.version}`)
      setTitle('')
      setBody('')
      setMaterial(false)
      router.refresh()
    })
  }

  return (
    <div className="rounded-lg border border-gray-200 bg-white">
      <div className="flex items-center justify-between px-5 py-3 border-b border-gray-200">
        <h2 className="font-medium text-sm">Publish new version</h2>
        <span className="text-xs text-gray-500">
          v{nextVersion} will be assigned automatically
        </span>
      </div>
      <div className="p-5 space-y-4">
        <label className="block">
          <span className="block text-xs uppercase tracking-wide text-gray-600 mb-1">
            Title
          </span>
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Short summary of what changed (≥3 chars)"
            className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
            disabled={isPending}
          />
          {!titleOk && title.length > 0 && (
            <p className="mt-1 text-[11px] text-red-600">Title must be at least 3 characters.</p>
          )}
        </label>

        <label className="block">
          <span className="block text-xs uppercase tracking-wide text-gray-600 mb-1">
            Body — Markdown supported
          </span>
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="The full notice text users see (≥10 chars)…"
            rows={10}
            className="w-full rounded-md border border-gray-300 px-3 py-2 text-xs font-mono leading-relaxed"
            disabled={isPending}
          />
          {!bodyOk && body.length > 0 && (
            <p className="mt-1 text-[11px] text-red-600">Body must be at least 10 characters.</p>
          )}
        </label>

        <label className="flex items-start gap-3 p-3 rounded-md border border-amber-200 bg-amber-50">
          <input
            type="checkbox"
            checked={material}
            onChange={(e) => setMaterial(e.target.checked)}
            className="mt-0.5"
            disabled={isPending}
          />
          <div className="flex-1">
            <strong className="block text-sm text-amber-800">
              Material change — trigger re-consent campaign
            </strong>
            <span className="text-xs text-amber-900 leading-relaxed">
              Material publishes count <strong>{affectedOnPriorVersion}</strong>{' '}
              active artefacts on v{nextVersion - 1}, mark them <code>replaced</code> as
              their owners re-consent under the new version, and surface a campaign view
              at <code>/dashboard/notices/&lt;id&gt;/campaign</code>. Existing artefacts
              stay valid against the v{nextVersion - 1} purpose set until the principal
              re-consents.
            </span>
          </div>
        </label>

        {error && (
          <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800">
            {error}
          </div>
        )}
        {success && (
          <div className="rounded-md border border-green-200 bg-green-50 px-3 py-2 text-xs text-green-800">
            {success}
          </div>
        )}

        <div className="flex justify-end gap-2 pt-1">
          <button
            type="button"
            onClick={submit}
            disabled={!canSubmit}
            className="rounded-md bg-black text-white px-4 py-2 text-sm font-medium disabled:opacity-50"
          >
            {isPending
              ? 'Publishing…'
              : material
                ? `Publish v${nextVersion} (material)`
                : `Publish v${nextVersion}`}
          </button>
        </div>
      </div>
    </div>
  )
}
