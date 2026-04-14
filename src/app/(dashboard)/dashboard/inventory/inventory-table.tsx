'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

interface InventoryItem {
  id: string
  data_category: string
  collection_source: string | null
  purposes: string[]
  legal_basis: string
  retention_period: string | null
  third_parties: string[]
  data_locations: string[]
  source_type: string
  is_complete: boolean
}

const LEGAL_BASES = [
  { value: 'consent', label: 'Consent' },
  { value: 'contract', label: 'Contract' },
  { value: 'legal_obligation', label: 'Legal obligation' },
  { value: 'legitimate_interest', label: 'Legitimate interest' },
  { value: 'vital_interests', label: 'Vital interests' },
  { value: 'public_task', label: 'Public task' },
]

export function InventoryTable({
  orgId,
  initialItems,
}: {
  orgId: string
  initialItems: InventoryItem[]
}) {
  const [open, setOpen] = useState(false)
  const router = useRouter()

  return (
    <>
      {open ? (
        <NewItemForm
          orgId={orgId}
          onCancel={() => setOpen(false)}
          onCreated={() => {
            setOpen(false)
            router.refresh()
          }}
        />
      ) : (
        <button
          onClick={() => setOpen(true)}
          className="rounded bg-black px-4 py-2 text-sm font-medium text-white hover:bg-gray-800"
        >
          + Add Data Category
        </button>
      )}

      <div className="rounded border border-gray-200">
        {initialItems.length > 0 ? (
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-left text-xs">
              <tr>
                <th className="px-4 py-2 font-medium">Category</th>
                <th className="px-4 py-2 font-medium">Source</th>
                <th className="px-4 py-2 font-medium">Purposes</th>
                <th className="px-4 py-2 font-medium">Legal basis</th>
                <th className="px-4 py-2 font-medium">Retention</th>
                <th className="px-4 py-2 font-medium">Third parties</th>
                <th className="px-4 py-2 font-medium">Status</th>
                <th className="px-4 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {initialItems.map((item) => (
                <InventoryRow
                  key={item.id}
                  orgId={orgId}
                  item={item}
                  onChange={() => router.refresh()}
                />
              ))}
            </tbody>
          </table>
        ) : (
          <p className="px-4 py-8 text-center text-sm text-gray-600">
            No data inventory items yet. Add one to start documenting your data flows.
          </p>
        )}
      </div>
    </>
  )
}

function InventoryRow({
  orgId,
  item,
  onChange,
}: {
  orgId: string
  item: InventoryItem
  onChange: () => void
}) {
  const [deleting, setDeleting] = useState(false)

  async function handleDelete() {
    if (!confirm(`Delete "${item.data_category}"?`)) return
    setDeleting(true)
    const res = await fetch(`/api/orgs/${orgId}/inventory/${item.id}`, {
      method: 'DELETE',
    })
    if (res.ok) onChange()
    else setDeleting(false)
  }

  return (
    <tr className="border-t border-gray-200">
      <td className="px-4 py-2 font-medium">{item.data_category}</td>
      <td className="px-4 py-2 text-gray-600">{item.collection_source || '—'}</td>
      <td className="px-4 py-2 text-gray-600">
        {item.purposes.length > 0 ? item.purposes.join(', ') : '—'}
      </td>
      <td className="px-4 py-2 text-gray-600">{item.legal_basis}</td>
      <td className="px-4 py-2 text-gray-600">{item.retention_period || '—'}</td>
      <td className="px-4 py-2 text-gray-600">
        {item.third_parties.length > 0 ? item.third_parties.join(', ') : '—'}
      </td>
      <td className="px-4 py-2">
        {item.is_complete ? (
          <span className="rounded bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700">
            Complete
          </span>
        ) : (
          <span className="rounded bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700">
            Incomplete
          </span>
        )}
        {item.source_type === 'auto_detected' && (
          <span className="ml-1 text-xs text-gray-500">auto</span>
        )}
      </td>
      <td className="px-4 py-2 text-right">
        <button
          onClick={handleDelete}
          disabled={deleting}
          className="text-xs text-red-600 hover:underline disabled:opacity-50"
        >
          {deleting ? 'Deleting...' : 'Delete'}
        </button>
      </td>
    </tr>
  )
}

function NewItemForm({
  orgId,
  onCancel,
  onCreated,
}: {
  orgId: string
  onCancel: () => void
  onCreated: () => void
}) {
  const [dataCategory, setDataCategory] = useState('')
  const [collectionSource, setCollectionSource] = useState('')
  const [purposes, setPurposes] = useState('')
  const [legalBasis, setLegalBasis] = useState('consent')
  const [retentionPeriod, setRetentionPeriod] = useState('')
  const [thirdParties, setThirdParties] = useState('')
  const [dataLocations, setDataLocations] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError('')

    const res = await fetch(`/api/orgs/${orgId}/inventory`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        data_category: dataCategory,
        collection_source: collectionSource || undefined,
        purposes: purposes
          .split(',')
          .map((p) => p.trim())
          .filter(Boolean),
        legal_basis: legalBasis,
        retention_period: retentionPeriod || undefined,
        third_parties: thirdParties
          .split(',')
          .map((p) => p.trim())
          .filter(Boolean),
        data_locations: dataLocations
          .split(',')
          .map((p) => p.trim())
          .filter(Boolean),
      }),
    })

    if (!res.ok) {
      const body = await res.json()
      setError(body.error || 'Failed')
      setLoading(false)
      return
    }

    onCreated()
  }

  return (
    <form onSubmit={handleSubmit} className="rounded border border-gray-200 p-4 space-y-3">
      <h2 className="font-medium">New Data Category</h2>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Data Category *" required value={dataCategory} onChange={setDataCategory} placeholder="email_address" />
        <Field label="Collection Source" value={collectionSource} onChange={setCollectionSource} placeholder="signup_form" />
        <Field
          label="Purposes (comma-separated)"
          value={purposes}
          onChange={setPurposes}
          placeholder="marketing, analytics"
        />
        <div>
          <label className="block text-sm font-medium">Legal Basis</label>
          <select
            value={legalBasis}
            onChange={(e) => setLegalBasis(e.target.value)}
            className="mt-1 block w-full rounded border border-gray-300 px-3 py-2 text-sm"
          >
            {LEGAL_BASES.map((b) => (
              <option key={b.value} value={b.value}>
                {b.label}
              </option>
            ))}
          </select>
        </div>
        <Field
          label="Retention Period"
          value={retentionPeriod}
          onChange={setRetentionPeriod}
          placeholder="12 months"
        />
        <Field
          label="Third Parties (comma-separated)"
          value={thirdParties}
          onChange={setThirdParties}
          placeholder="Razorpay, Mixpanel"
        />
        <Field
          label="Data Locations (ISO codes)"
          value={dataLocations}
          onChange={setDataLocations}
          placeholder="IN, US"
        />
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}

      <div className="flex gap-2 pt-2">
        <button
          type="submit"
          disabled={loading}
          className="rounded bg-black px-4 py-2 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-50"
        >
          {loading ? 'Saving...' : 'Save'}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="rounded border border-gray-300 px-4 py-2 text-sm font-medium hover:bg-gray-50"
        >
          Cancel
        </button>
      </div>
    </form>
  )
}

function Field({
  label,
  value,
  onChange,
  placeholder,
  required,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  placeholder?: string
  required?: boolean
}) {
  return (
    <div>
      <label className="block text-sm font-medium">{label}</label>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        required={required}
        className="mt-1 block w-full rounded border border-gray-300 px-3 py-2 text-sm"
      />
    </div>
  )
}
