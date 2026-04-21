'use client'

import { useState } from 'react'
import { setOnboardingStep, updateIndustry } from '../actions'
import { INDUSTRIES, type Industry } from './wizard-types'

export function Step2Company({
  orgId,
  orgName,
  initialIndustry,
  onComplete,
}: {
  orgId: string
  orgName: string
  initialIndustry: string | null
  onComplete: (industry: Industry) => void
}) {
  const [industry, setIndustry] = useState<Industry | ''>(
    (initialIndustry as Industry) ?? '',
  )
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!industry) {
      setError('Pick the option closest to your industry.')
      return
    }
    setLoading(true)
    setError('')

    const updateResult = await updateIndustry(orgId, industry)
    if (!updateResult.ok) {
      setError(updateResult.error)
      setLoading(false)
      return
    }

    const stepResult = await setOnboardingStep(orgId, 2)
    if (!stepResult.ok) {
      setError(stepResult.error)
      setLoading(false)
      return
    }

    onComplete(industry)
  }

  return (
    <div className="mx-auto max-w-lg rounded-lg border border-gray-200 bg-white p-8 shadow-sm">
      <h1 className="text-2xl font-semibold">Tell us about your business</h1>
      <p className="mt-2 text-sm text-gray-600">
        Your industry picks the right DPDP template in the next step —
        sector-specific purposes, legal bases, and default retentions.
      </p>

      <form onSubmit={handleSubmit} className="mt-6 space-y-4">
        <div>
          <label className="block text-sm font-medium text-gray-700">
            Organisation name
          </label>
          <input
            type="text"
            value={orgName}
            disabled
            className="mt-1 block w-full rounded border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-700"
          />
          <p className="mt-1 text-xs text-gray-500">
            You can rename this later in Settings.
          </p>
        </div>

        <div>
          <label
            htmlFor="industry"
            className="block text-sm font-medium text-gray-700"
          >
            Industry
          </label>
          <select
            id="industry"
            required
            value={industry}
            onChange={(e) => setIndustry(e.target.value as Industry | '')}
            className="mt-1 block w-full rounded border border-gray-300 bg-white px-3 py-2 text-sm focus:border-black focus:outline-none focus:ring-1 focus:ring-black"
          >
            <option value="">Select an industry…</option>
            {INDUSTRIES.map((i) => (
              <option key={i.code} value={i.code}>
                {i.label}
              </option>
            ))}
          </select>
        </div>

        {error ? <p className="text-sm text-red-600">{error}</p> : null}

        <button
          type="submit"
          disabled={loading}
          className="w-full rounded bg-black px-4 py-2 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-50"
        >
          {loading ? 'Saving…' : 'Continue'}
        </button>
      </form>
    </div>
  )
}
