'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

const DEFAULT_PURPOSES = [
  {
    id: 'essential',
    name: 'Essential',
    description: 'Required for the site to function.',
    required: true,
    default: true,
  },
  {
    id: 'analytics',
    name: 'Analytics',
    description: 'Helps us understand how the site is used.',
    required: false,
    default: false,
  },
  {
    id: 'marketing',
    name: 'Marketing',
    description: 'Personalised ads and remarketing.',
    required: false,
    default: false,
  },
]

export function CreateBannerForm({
  orgId,
  properties,
}: {
  orgId: string
  properties: { id: string; name: string }[]
}) {
  const [open, setOpen] = useState(false)
  const [propertyId, setPropertyId] = useState(properties[0]?.id ?? '')
  const [headline, setHeadline] = useState('We use cookies')
  const [bodyCopy, setBodyCopy] = useState(
    'We use cookies to deliver our services and analyse traffic. Choose which purposes you accept.',
  )
  const [position, setPosition] = useState('bottom-bar')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const router = useRouter()

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError('')

    const res = await fetch(`/api/orgs/${orgId}/banners`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        property_id: propertyId,
        headline,
        body_copy: bodyCopy,
        position,
        purposes: DEFAULT_PURPOSES,
      }),
    })

    if (!res.ok) {
      const body = await res.json()
      setError(body.error || 'Failed to create banner')
      setLoading(false)
      return
    }

    const { banner } = await res.json()
    setLoading(false)
    setOpen(false)
    router.push(`/dashboard/banners/${banner.id}`)
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="rounded bg-black px-4 py-2 text-sm font-medium text-white hover:bg-gray-800"
      >
        + Create Banner
      </button>
    )
  }

  return (
    <form onSubmit={handleSubmit} className="rounded border border-gray-200 p-4 space-y-4">
      <h2 className="font-medium">New Banner</h2>

      <div>
        <label htmlFor="property" className="block text-sm font-medium">
          Web Property
        </label>
        <select
          id="property"
          value={propertyId}
          onChange={(e) => setPropertyId(e.target.value)}
          required
          className="mt-1 block w-full rounded border border-gray-300 px-3 py-2 text-sm"
        >
          {properties.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label htmlFor="headline" className="block text-sm font-medium">
          Headline
        </label>
        <input
          id="headline"
          type="text"
          value={headline}
          onChange={(e) => setHeadline(e.target.value)}
          required
          className="mt-1 block w-full rounded border border-gray-300 px-3 py-2 text-sm"
        />
      </div>

      <div>
        <label htmlFor="body" className="block text-sm font-medium">
          Body Copy
        </label>
        <textarea
          id="body"
          value={bodyCopy}
          onChange={(e) => setBodyCopy(e.target.value)}
          rows={3}
          required
          className="mt-1 block w-full rounded border border-gray-300 px-3 py-2 text-sm"
        />
      </div>

      <div>
        <label htmlFor="position" className="block text-sm font-medium">
          Position
        </label>
        <select
          id="position"
          value={position}
          onChange={(e) => setPosition(e.target.value)}
          className="mt-1 block w-full rounded border border-gray-300 px-3 py-2 text-sm"
        >
          <option value="bottom-bar">Bottom bar</option>
          <option value="bottom-left">Bottom left</option>
          <option value="bottom-right">Bottom right</option>
          <option value="modal">Modal</option>
        </select>
      </div>

      <p className="text-xs text-gray-500">
        Banner will start with three default purposes (Essential, Analytics, Marketing). You can
        edit them on the next screen.
      </p>

      {error && <p className="text-sm text-red-600">{error}</p>}

      <div className="flex gap-2">
        <button
          type="submit"
          disabled={loading}
          className="rounded bg-black px-4 py-2 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-50"
        >
          {loading ? 'Creating...' : 'Create Banner'}
        </button>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="rounded border border-gray-300 px-4 py-2 text-sm font-medium hover:bg-gray-50"
        >
          Cancel
        </button>
      </div>
    </form>
  )
}
