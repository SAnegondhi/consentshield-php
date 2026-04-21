'use client'

import { useState } from 'react'
import { seedDataInventory, setOnboardingStep } from '../actions'

interface Toggles {
  email: boolean
  payments: boolean
  analytics: boolean
}

export function Step3DataInventory({
  orgId,
  onComplete,
}: {
  orgId: string
  onComplete: () => void
}) {
  const [flags, setFlags] = useState<Toggles>({
    email: false,
    payments: false,
    analytics: false,
  })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError('')

    const seedResult = await seedDataInventory(orgId, flags)
    if (!seedResult.ok) {
      setError(seedResult.error)
      setLoading(false)
      return
    }

    const stepResult = await setOnboardingStep(orgId, 3)
    if (!stepResult.ok) {
      setError(stepResult.error)
      setLoading(false)
      return
    }

    onComplete()
  }

  return (
    <div className="mx-auto max-w-lg rounded-lg border border-gray-200 bg-white p-8 shadow-sm">
      <h1 className="text-2xl font-semibold">What data do you collect?</h1>
      <p className="mt-2 text-sm text-gray-600">
        A rough sketch is enough — we&apos;ll seed your Data Inventory so
        you can refine it later in Settings → Data Inventory.
      </p>

      <form onSubmit={handleSubmit} className="mt-6 space-y-3">
        <ToggleRow
          label="Email addresses"
          description="For sign-in, transactional mail, or marketing."
          checked={flags.email}
          onChange={(v) => setFlags((s) => ({ ...s, email: v }))}
        />
        <ToggleRow
          label="Payment information"
          description="Card details, bank details, or UPI handles."
          checked={flags.payments}
          onChange={(v) => setFlags((s) => ({ ...s, payments: v }))}
        />
        <ToggleRow
          label="Analytics / usage telemetry"
          description="Pageviews, clicks, session recordings, A/B tests."
          checked={flags.analytics}
          onChange={(v) => setFlags((s) => ({ ...s, analytics: v }))}
        />

        {error ? <p className="text-sm text-red-600">{error}</p> : null}

        <button
          type="submit"
          disabled={loading}
          className="mt-2 w-full rounded bg-black px-4 py-2 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-50"
        >
          {loading ? 'Saving…' : 'Continue'}
        </button>
      </form>

      <p className="mt-4 text-xs text-gray-500">
        None of these apply? Continue — you can add categories later.
      </p>
    </div>
  )
}

function ToggleRow({
  label,
  description,
  checked,
  onChange,
}: {
  label: string
  description: string
  checked: boolean
  onChange: (v: boolean) => void
}) {
  return (
    <label className="flex cursor-pointer items-start justify-between gap-4 rounded border border-gray-200 p-3 hover:border-gray-400">
      <div>
        <p className="text-sm font-medium text-gray-900">{label}</p>
        <p className="mt-0.5 text-xs text-gray-600">{description}</p>
      </div>
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-1 h-5 w-5 rounded border-gray-300 text-black focus:ring-black"
      />
    </label>
  )
}
