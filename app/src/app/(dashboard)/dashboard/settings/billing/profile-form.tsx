'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { updateBillingProfile } from './actions'

interface BillingProfile {
  billing_legal_name: string | null
  billing_gstin: string | null
  billing_state_code: string | null
  billing_address: string | null
  billing_email: string | null
  billing_profile_updated_at: string | null
  role: string
}

interface Props {
  profile: BillingProfile
}

// Sampled subset. Full GST code list is exhaustive; this covers the vast
// majority of our expected customers. Customers in other states can still
// submit any valid 2-digit code via an "Other" path (Sprint 1.3 follow-up
// if needed).
const STATE_OPTIONS: Array<{ code: string; name: string }> = [
  { code: '07', name: 'Delhi (07)' },
  { code: '09', name: 'Uttar Pradesh (09)' },
  { code: '19', name: 'West Bengal (19)' },
  { code: '22', name: 'Chhattisgarh (22)' },
  { code: '23', name: 'Madhya Pradesh (23)' },
  { code: '24', name: 'Gujarat (24)' },
  { code: '27', name: 'Maharashtra (27)' },
  { code: '29', name: 'Karnataka (29)' },
  { code: '32', name: 'Kerala (32)' },
  { code: '33', name: 'Tamil Nadu (33)' },
  { code: '36', name: 'Telangana (36)' },
  { code: '37', name: 'Andhra Pradesh (37)' },
]

const GSTIN_REGEX = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/

export function BillingProfileForm({ profile }: Props) {
  const router = useRouter()
  const canEdit = profile.role === 'account_owner'
  const [editing, setEditing] = useState(false)
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  const [form, setForm] = useState({
    billing_legal_name: profile.billing_legal_name ?? '',
    billing_gstin: profile.billing_gstin ?? '',
    billing_state_code: profile.billing_state_code ?? '',
    billing_address: profile.billing_address ?? '',
    billing_email: profile.billing_email ?? '',
  })

  function handleCancel() {
    setForm({
      billing_legal_name: profile.billing_legal_name ?? '',
      billing_gstin: profile.billing_gstin ?? '',
      billing_state_code: profile.billing_state_code ?? '',
      billing_address: profile.billing_address ?? '',
      billing_email: profile.billing_email ?? '',
    })
    setError(null)
    setEditing(false)
  }

  function handleSave() {
    setError(null)

    // Client-side pre-validation (server re-validates authoritatively)
    if (form.billing_legal_name.trim().length < 2) {
      setError('Legal name must be at least 2 characters')
      return
    }
    if (form.billing_gstin && !GSTIN_REGEX.test(form.billing_gstin.trim().toUpperCase())) {
      setError('GSTIN does not match the expected format (e.g. 29ABCDE1234F1Z5)')
      return
    }
    if (!form.billing_state_code) {
      setError('Registered state is required')
      return
    }
    if (form.billing_address.trim().length < 1) {
      setError('Billing address is required')
      return
    }
    if (!form.billing_email.includes('@')) {
      setError('Billing email is required')
      return
    }

    startTransition(async () => {
      const result = await updateBillingProfile({
        legal_name: form.billing_legal_name.trim(),
        gstin: form.billing_gstin.trim().toUpperCase() || null,
        state_code: form.billing_state_code,
        address: form.billing_address.trim(),
        email: form.billing_email.trim(),
      })
      if ('error' in result) {
        setError(result.error)
      } else {
        setEditing(false)
        router.refresh()
      }
    })
  }

  if (!editing) {
    return (
      <section className="mb-6 rounded-lg border border-gray-200 bg-white p-5">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-gray-700">Billing profile</h2>
          {canEdit && (
            <button
              onClick={() => setEditing(true)}
              className="rounded border border-gray-200 bg-white px-3 py-1 text-xs hover:bg-gray-50"
            >
              Edit
            </button>
          )}
        </div>
        <dl className="grid grid-cols-2 gap-x-6 gap-y-4 text-sm">
          <div>
            <dt className="text-xs uppercase tracking-wide text-gray-500">Legal name</dt>
            <dd className="mt-0.5">
              {profile.billing_legal_name ?? <span className="text-gray-400 italic">not set</span>}
            </dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-wide text-gray-500">GSTIN</dt>
            <dd className="mt-0.5 font-mono text-xs">
              {profile.billing_gstin ?? <span className="font-sans text-gray-400 italic">not registered</span>}
            </dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-wide text-gray-500">Registered state</dt>
            <dd className="mt-0.5">
              {profile.billing_state_code ?? <span className="text-gray-400 italic">not set</span>}
            </dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-wide text-gray-500">Billing email</dt>
            <dd className="mt-0.5">
              {profile.billing_email ?? <span className="text-gray-400 italic">not set</span>}
            </dd>
          </div>
          <div className="col-span-2">
            <dt className="text-xs uppercase tracking-wide text-gray-500">Billing address</dt>
            <dd className="mt-0.5 whitespace-pre-line">
              {profile.billing_address ?? <span className="text-gray-400 italic">not set</span>}
            </dd>
          </div>
          {profile.billing_profile_updated_at && (
            <div className="col-span-2 text-xs text-gray-400">
              Last updated {new Date(profile.billing_profile_updated_at).toLocaleString('en-IN')}
            </div>
          )}
        </dl>
      </section>
    )
  }

  // Edit mode — only reached if canEdit is true (button hidden otherwise)
  return (
    <section className="mb-6 rounded-lg border border-gray-200 bg-white p-5">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-gray-700">Billing profile</h2>
        <span className="text-xs text-emerald-700">Editing</span>
      </div>
      <div className="grid grid-cols-2 gap-x-6 gap-y-4 text-sm">
        <div className="col-span-1">
          <label className="mb-1 block text-xs uppercase tracking-wide text-gray-500">Legal name *</label>
          <input
            type="text"
            value={form.billing_legal_name}
            onChange={(e) => setForm({ ...form, billing_legal_name: e.target.value })}
            className="w-full rounded border border-gray-300 px-3 py-1.5"
            maxLength={200}
          />
          <p className="mt-1 text-xs text-gray-400">Printed on every invoice</p>
        </div>
        <div className="col-span-1">
          <label className="mb-1 block text-xs uppercase tracking-wide text-gray-500">GSTIN</label>
          <input
            type="text"
            value={form.billing_gstin}
            onChange={(e) => setForm({ ...form, billing_gstin: e.target.value })}
            className="w-full rounded border border-gray-300 px-3 py-1.5 font-mono text-xs"
            placeholder="29ABCDE1234F1Z5"
            maxLength={15}
          />
          <p className="mt-1 text-xs text-gray-400">Optional; required for input tax credit claims</p>
        </div>
        <div className="col-span-1">
          <label className="mb-1 block text-xs uppercase tracking-wide text-gray-500">Registered state *</label>
          <select
            value={form.billing_state_code}
            onChange={(e) => setForm({ ...form, billing_state_code: e.target.value })}
            className="w-full rounded border border-gray-300 px-3 py-1.5"
          >
            <option value="">Select state</option>
            {STATE_OPTIONS.map((s) => (
              <option key={s.code} value={s.code}>
                {s.name}
              </option>
            ))}
          </select>
          <p className="mt-1 text-xs text-gray-400">Determines IGST vs CGST+SGST split</p>
        </div>
        <div className="col-span-1">
          <label className="mb-1 block text-xs uppercase tracking-wide text-gray-500">Billing email *</label>
          <input
            type="email"
            value={form.billing_email}
            onChange={(e) => setForm({ ...form, billing_email: e.target.value })}
            className="w-full rounded border border-gray-300 px-3 py-1.5"
          />
          <p className="mt-1 text-xs text-gray-400">Invoice PDFs are emailed here on issuance</p>
        </div>
        <div className="col-span-2">
          <label className="mb-1 block text-xs uppercase tracking-wide text-gray-500">Billing address *</label>
          <textarea
            value={form.billing_address}
            onChange={(e) => setForm({ ...form, billing_address: e.target.value })}
            className="w-full rounded border border-gray-300 px-3 py-1.5"
            rows={3}
            maxLength={500}
          />
          <p className="mt-1 text-xs text-gray-400">
            Printed on every invoice. Do NOT include personal addresses.
          </p>
        </div>
      </div>

      {error && <p className="mt-3 text-sm text-red-600">{error}</p>}

      <div className="mt-4 flex items-center gap-2">
        <button
          onClick={handleSave}
          disabled={isPending}
          className="rounded bg-emerald-700 px-3 py-1.5 text-sm text-white hover:bg-emerald-800 disabled:opacity-50"
        >
          {isPending ? 'Saving…' : 'Save changes'}
        </button>
        <button
          onClick={handleCancel}
          disabled={isPending}
          className="rounded border border-gray-200 bg-white px-3 py-1.5 text-sm hover:bg-gray-50 disabled:opacity-50"
        >
          Cancel
        </button>
      </div>
    </section>
  )
}
