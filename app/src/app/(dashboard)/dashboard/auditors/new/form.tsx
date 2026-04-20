'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { createEngagement, type RegistrationCategory } from '../actions'

interface Props {
  orgId: string
}

const CATEGORIES: Array<{ value: RegistrationCategory; label: string }> = [
  { value: 'ca_firm', label: 'CA firm (ICAI-registered)' },
  { value: 'sebi_registered', label: 'SEBI-registered' },
  { value: 'iso_27001_certified_cb', label: 'ISO 27001 certified body' },
  { value: 'dpdp_empanelled', label: 'DPDP empanelled' },
  { value: 'rbi_empanelled', label: 'RBI empanelled' },
  { value: 'other', label: 'Other' },
]

export function NewEngagementForm({ orgId }: Props) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  const today = new Date().toISOString().slice(0, 10)

  const [form, setForm] = useState({
    auditor_name: '',
    registration_category: 'ca_firm' as RegistrationCategory,
    registration_ref: '',
    scope: '',
    engagement_start: today,
    attestation_ref: '',
  })

  function handleSubmit() {
    setError(null)

    if (form.auditor_name.trim().length < 2) {
      setError('Auditor name must be at least 2 characters')
      return
    }
    if (form.scope.trim().length < 3) {
      setError('Scope must be at least 3 characters')
      return
    }

    startTransition(async () => {
      const result = await createEngagement({
        org_id: orgId,
        auditor_name: form.auditor_name.trim(),
        registration_category: form.registration_category,
        registration_ref: form.registration_ref.trim() || null,
        scope: form.scope.trim(),
        engagement_start: form.engagement_start,
        attestation_ref: form.attestation_ref.trim() || null,
      })
      if ('error' in result) {
        setError(result.error)
        return
      }
      router.push(`/dashboard/auditors/${result.id}`)
    })
  }

  return (
    <div className="space-y-5 rounded-lg border border-gray-200 bg-white p-6">
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="mb-1 block text-xs uppercase tracking-wide text-gray-500">Auditor name *</label>
          <input
            type="text"
            value={form.auditor_name}
            onChange={(e) => setForm({ ...form, auditor_name: e.target.value })}
            className="w-full rounded border border-gray-300 px-3 py-1.5"
            placeholder="e.g. KPMG India"
          />
        </div>
        <div>
          <label className="mb-1 block text-xs uppercase tracking-wide text-gray-500">
            Registration category *
          </label>
          <select
            value={form.registration_category}
            onChange={(e) =>
              setForm({ ...form, registration_category: e.target.value as RegistrationCategory })
            }
            className="w-full rounded border border-gray-300 px-3 py-1.5"
          >
            {CATEGORIES.map((c) => (
              <option key={c.value} value={c.value}>
                {c.label}
              </option>
            ))}
          </select>
          <p className="mt-1 text-xs text-gray-400">Category declaration only — we do NOT store PAN values.</p>
        </div>
      </div>

      <div>
        <label className="mb-1 block text-xs uppercase tracking-wide text-gray-500">Scope *</label>
        <textarea
          value={form.scope}
          onChange={(e) => setForm({ ...form, scope: e.target.value })}
          className="w-full rounded border border-gray-300 px-3 py-1.5"
          rows={3}
          maxLength={2000}
          placeholder="What this audit covers (e.g. Annual DPDP compliance for FY 2025-26)"
        />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="mb-1 block text-xs uppercase tracking-wide text-gray-500">Registration reference</label>
          <input
            type="text"
            value={form.registration_ref}
            onChange={(e) => setForm({ ...form, registration_ref: e.target.value })}
            className="w-full rounded border border-gray-300 px-3 py-1.5 text-xs"
            placeholder="Public URL e.g. icai.org/member/12345"
          />
        </div>
        <div>
          <label className="mb-1 block text-xs uppercase tracking-wide text-gray-500">Engagement start *</label>
          <input
            type="date"
            value={form.engagement_start}
            onChange={(e) => setForm({ ...form, engagement_start: e.target.value })}
            className="w-full rounded border border-gray-300 px-3 py-1.5"
          />
        </div>
      </div>

      <div>
        <label className="mb-1 block text-xs uppercase tracking-wide text-gray-500">
          Attestation reference
        </label>
        <input
          type="text"
          value={form.attestation_ref}
          onChange={(e) => setForm({ ...form, attestation_ref: e.target.value })}
          className="w-full rounded border border-gray-300 px-3 py-1.5 text-xs"
          placeholder="URL to customer-stored audit report (typically added on complete)"
        />
        <p className="mt-1 text-xs text-gray-400">
          Optional at creation — typically populated when you complete the engagement.
        </p>
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}

      <div className="flex items-center justify-end gap-2 border-t border-gray-200 pt-4">
        <button
          onClick={handleSubmit}
          disabled={isPending}
          className="rounded bg-emerald-700 px-3 py-1.5 text-sm text-white hover:bg-emerald-800 disabled:opacity-50"
        >
          {isPending ? 'Creating…' : 'Create engagement'}
        </button>
      </div>
    </div>
  )
}
