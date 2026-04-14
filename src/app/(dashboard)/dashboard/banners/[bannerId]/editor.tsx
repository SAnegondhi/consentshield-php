'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { BannerPreview } from './preview'

interface Purpose {
  id: string
  name: string
  description: string
  required: boolean
  default: boolean
}

interface Banner {
  id: string
  property_id: string
  version: number
  is_active: boolean
  headline: string
  body_copy: string
  position: string
  purposes: Purpose[]
  monitoring_enabled: boolean
}

export function BannerEditor({ orgId, banner }: { orgId: string; banner: Banner }) {
  const [headline, setHeadline] = useState(banner.headline)
  const [bodyCopy, setBodyCopy] = useState(banner.body_copy)
  const [position, setPosition] = useState(banner.position)
  const [purposes, setPurposes] = useState<Purpose[]>(banner.purposes ?? [])
  const [monitoringEnabled, setMonitoringEnabled] = useState(banner.monitoring_enabled)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [loading, setLoading] = useState(false)
  const router = useRouter()

  function updatePurpose(index: number, updates: Partial<Purpose>) {
    setPurposes((prev) => prev.map((p, i) => (i === index ? { ...p, ...updates } : p)))
  }

  function addPurpose() {
    setPurposes((prev) => [
      ...prev,
      {
        id: `purpose_${prev.length + 1}`,
        name: 'New Purpose',
        description: '',
        required: false,
        default: false,
      },
    ])
  }

  function removePurpose(index: number) {
    setPurposes((prev) => prev.filter((_, i) => i !== index))
  }

  async function handleSave() {
    setLoading(true)
    setError('')
    setSuccess('')

    const res = await fetch(`/api/orgs/${orgId}/banners/${banner.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        headline,
        body_copy: bodyCopy,
        position,
        purposes,
        monitoring_enabled: monitoringEnabled,
      }),
    })

    if (!res.ok) {
      const body = await res.json()
      setError(body.error || 'Save failed')
      setLoading(false)
      return
    }

    setSuccess('Saved')
    setLoading(false)
    router.refresh()
  }

  async function handlePublish() {
    setLoading(true)
    setError('')
    setSuccess('')

    // Save first
    const saveRes = await fetch(`/api/orgs/${orgId}/banners/${banner.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        headline,
        body_copy: bodyCopy,
        position,
        purposes,
        monitoring_enabled: monitoringEnabled,
      }),
    })

    if (!saveRes.ok) {
      const body = await saveRes.json()
      setError(body.error || 'Save failed')
      setLoading(false)
      return
    }

    // Then publish
    const pubRes = await fetch(`/api/orgs/${orgId}/banners/${banner.id}/publish`, {
      method: 'POST',
    })

    if (!pubRes.ok) {
      const body = await pubRes.json()
      setError(body.error || 'Publish failed')
      setLoading(false)
      return
    }

    setSuccess('Published — banner is now live')
    setLoading(false)
    router.refresh()
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      {/* Editor panel */}
      <div className="space-y-4 rounded border border-gray-200 p-4">
        <h2 className="font-medium">Configuration</h2>

        <div>
          <label htmlFor="headline" className="block text-sm font-medium">
            Headline
          </label>
          <input
            id="headline"
            type="text"
            value={headline}
            onChange={(e) => setHeadline(e.target.value)}
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

        <div className="flex items-center gap-2">
          <input
            id="monitoring"
            type="checkbox"
            checked={monitoringEnabled}
            onChange={(e) => setMonitoringEnabled(e.target.checked)}
          />
          <label htmlFor="monitoring" className="text-sm">
            Enable tracker monitoring
          </label>
        </div>

        <div>
          <div className="flex items-center justify-between mb-2">
            <label className="text-sm font-medium">Purposes</label>
            <button
              type="button"
              onClick={addPurpose}
              className="text-xs font-medium text-black hover:underline"
            >
              + Add Purpose
            </button>
          </div>
          <div className="space-y-3">
            {purposes.map((p, i) => (
              <div key={i} className="rounded border border-gray-200 p-3 space-y-2">
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={p.id}
                    onChange={(e) => updatePurpose(i, { id: e.target.value })}
                    placeholder="id"
                    className="flex-1 rounded border border-gray-300 px-2 py-1 text-xs font-mono"
                  />
                  <input
                    type="text"
                    value={p.name}
                    onChange={(e) => updatePurpose(i, { name: e.target.value })}
                    placeholder="Name"
                    className="flex-1 rounded border border-gray-300 px-2 py-1 text-xs"
                  />
                  <button
                    type="button"
                    onClick={() => removePurpose(i)}
                    className="text-xs text-red-600 hover:underline"
                  >
                    Remove
                  </button>
                </div>
                <input
                  type="text"
                  value={p.description}
                  onChange={(e) => updatePurpose(i, { description: e.target.value })}
                  placeholder="Description"
                  className="block w-full rounded border border-gray-300 px-2 py-1 text-xs"
                />
                <div className="flex gap-4 text-xs">
                  <label className="flex items-center gap-1">
                    <input
                      type="checkbox"
                      checked={p.required}
                      onChange={(e) =>
                        updatePurpose(i, { required: e.target.checked })
                      }
                    />
                    Required
                  </label>
                  <label className="flex items-center gap-1">
                    <input
                      type="checkbox"
                      checked={p.default}
                      onChange={(e) =>
                        updatePurpose(i, { default: e.target.checked })
                      }
                    />
                    Default checked
                  </label>
                </div>
              </div>
            ))}
          </div>
        </div>

        {error && <p className="text-sm text-red-600">{error}</p>}
        {success && <p className="text-sm text-green-700">{success}</p>}

        <div className="flex gap-2 pt-2">
          <button
            onClick={handleSave}
            disabled={loading}
            className="rounded border border-gray-300 px-4 py-2 text-sm font-medium hover:bg-gray-50 disabled:opacity-50"
          >
            {loading ? 'Saving...' : 'Save Draft'}
          </button>
          <button
            onClick={handlePublish}
            disabled={loading}
            className="rounded bg-black px-4 py-2 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-50"
          >
            {loading ? 'Publishing...' : 'Save & Publish'}
          </button>
        </div>
      </div>

      {/* Preview panel */}
      <div className="rounded border border-gray-200 p-4">
        <h2 className="font-medium mb-4">Live Preview</h2>
        <BannerPreview
          headline={headline}
          bodyCopy={bodyCopy}
          position={position}
          purposes={purposes}
        />
      </div>
    </div>
  )
}
