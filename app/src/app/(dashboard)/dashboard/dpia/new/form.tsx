'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { createDpia } from '../actions'

interface Props {
  orgId: string
}

export function NewDpiaForm({ orgId }: Props) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  const today = new Date().toISOString().slice(0, 10)
  const defaultReview = new Date(Date.now() + 365 * 86_400_000).toISOString().slice(0, 10)

  const [form, setForm] = useState({
    title: '',
    processing_description: '',
    categories_text: '', // comma-separated in the UI; split server-side
    risk_level: 'medium' as 'low' | 'medium' | 'high',
    mitigation_text: '', // freeform notes
    auditor_name: '',
    auditor_attestation_ref: '',
    conducted_at: today,
    next_review_at: defaultReview,
  })

  function handleSubmit(intent: 'draft' | 'publish') {
    setError(null)

    if (form.title.trim().length < 3) {
      setError('Title must be at least 3 characters')
      return
    }
    if (form.processing_description.trim().length < 10) {
      setError('Processing description must be at least 10 characters')
      return
    }
    const categories = form.categories_text
      .split(/[,\n]/)
      .map(s => s.trim())
      .filter(Boolean)

    startTransition(async () => {
      const result = await createDpia({
        org_id: orgId,
        title: form.title.trim(),
        processing_description: form.processing_description.trim(),
        data_categories: categories,
        risk_level: form.risk_level,
        mitigations: form.mitigation_text.trim()
          ? { notes: form.mitigation_text.trim() }
          : {},
        auditor_name: form.auditor_name.trim() || null,
        auditor_attestation_ref: form.auditor_attestation_ref.trim() || null,
        conducted_at: form.conducted_at,
        next_review_at: form.next_review_at || null,
      })

      if ('error' in result) {
        setError(result.error)
        return
      }

      if (intent === 'publish') {
        const { publishDpia } = await import('../actions')
        const pub = await publishDpia(result.id)
        if ('error' in pub) {
          // Created but not published — surface the detail page
          setError(`Draft created but publish failed: ${pub.error}`)
          router.push(`/dashboard/dpia/${result.id}`)
          return
        }
      }

      router.push(`/dashboard/dpia/${result.id}`)
    })
  }

  return (
    <div className="space-y-5 rounded-lg border border-gray-200 bg-white p-6">
      <div>
        <label className="mb-1 block text-xs uppercase tracking-wide text-gray-500">Title *</label>
        <input
          type="text"
          value={form.title}
          onChange={(e) => setForm({ ...form, title: e.target.value })}
          className="w-full rounded border border-gray-300 px-3 py-1.5"
          maxLength={200}
          placeholder="e.g. Customer on-boarding KYC data flow"
        />
      </div>

      <div>
        <label className="mb-1 block text-xs uppercase tracking-wide text-gray-500">
          Processing description *
        </label>
        <textarea
          value={form.processing_description}
          onChange={(e) => setForm({ ...form, processing_description: e.target.value })}
          className="w-full rounded border border-gray-300 px-3 py-1.5"
          rows={4}
          maxLength={5000}
          placeholder="Describe the processing — purpose, lawful basis, subject categories, retention window."
        />
      </div>

      <div>
        <label className="mb-1 block text-xs uppercase tracking-wide text-gray-500">
          Data categories
        </label>
        <input
          type="text"
          value={form.categories_text}
          onChange={(e) => setForm({ ...form, categories_text: e.target.value })}
          className="w-full rounded border border-gray-300 px-3 py-1.5 font-mono text-xs"
          placeholder="contact.email, financial.kyc_category, identity.pan_flag"
        />
        <p className="mt-1 text-xs text-gray-400">
          Comma-separated category names only — never raw values (Rule 3).
        </p>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="mb-1 block text-xs uppercase tracking-wide text-gray-500">Risk level *</label>
          <select
            value={form.risk_level}
            onChange={(e) =>
              setForm({ ...form, risk_level: e.target.value as 'low' | 'medium' | 'high' })
            }
            className="w-full rounded border border-gray-300 px-3 py-1.5"
          >
            <option value="low">Low</option>
            <option value="medium">Medium</option>
            <option value="high">High</option>
          </select>
        </div>
        <div>
          <label className="mb-1 block text-xs uppercase tracking-wide text-gray-500">Auditor name</label>
          <input
            type="text"
            value={form.auditor_name}
            onChange={(e) => setForm({ ...form, auditor_name: e.target.value })}
            className="w-full rounded border border-gray-300 px-3 py-1.5"
            placeholder="e.g. KPMG India"
          />
        </div>
      </div>

      <div>
        <label className="mb-1 block text-xs uppercase tracking-wide text-gray-500">
          Attestation reference
        </label>
        <input
          type="text"
          value={form.auditor_attestation_ref}
          onChange={(e) => setForm({ ...form, auditor_attestation_ref: e.target.value })}
          className="w-full rounded border border-gray-300 px-3 py-1.5 text-xs"
          placeholder="URL or reference to your internally-stored DPIA artefact"
        />
        <p className="mt-1 text-xs text-gray-400">
          We do NOT store the DPIA PDF itself — only the reference.
        </p>
      </div>

      <div>
        <label className="mb-1 block text-xs uppercase tracking-wide text-gray-500">Mitigations</label>
        <textarea
          value={form.mitigation_text}
          onChange={(e) => setForm({ ...form, mitigation_text: e.target.value })}
          className="w-full rounded border border-gray-300 px-3 py-1.5"
          rows={3}
          placeholder="Describe risk mitigations (encryption, access controls, retention limits, etc.)"
        />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="mb-1 block text-xs uppercase tracking-wide text-gray-500">Conducted on *</label>
          <input
            type="date"
            value={form.conducted_at}
            onChange={(e) => setForm({ ...form, conducted_at: e.target.value })}
            className="w-full rounded border border-gray-300 px-3 py-1.5"
          />
        </div>
        <div>
          <label className="mb-1 block text-xs uppercase tracking-wide text-gray-500">Next review</label>
          <input
            type="date"
            value={form.next_review_at}
            onChange={(e) => setForm({ ...form, next_review_at: e.target.value })}
            className="w-full rounded border border-gray-300 px-3 py-1.5"
          />
          <p className="mt-1 text-xs text-gray-400">Default 12 months after conducted date.</p>
        </div>
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}

      <div className="flex items-center justify-end gap-2 border-t border-gray-200 pt-4">
        <button
          onClick={() => handleSubmit('draft')}
          disabled={isPending}
          className="rounded border border-gray-200 bg-white px-3 py-1.5 text-sm hover:bg-gray-50 disabled:opacity-50"
        >
          {isPending ? 'Saving…' : 'Save as draft'}
        </button>
        <button
          onClick={() => handleSubmit('publish')}
          disabled={isPending}
          className="rounded bg-emerald-700 px-3 py-1.5 text-sm text-white hover:bg-emerald-800 disabled:opacity-50"
        >
          {isPending ? 'Saving…' : 'Save & publish'}
        </button>
      </div>
    </div>
  )
}
