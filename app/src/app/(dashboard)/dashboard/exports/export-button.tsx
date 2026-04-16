'use client'

import { useState } from 'react'

export function ExportButton({ orgId }: { orgId: string }) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function generate() {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/orgs/${orgId}/audit-export`, { method: 'POST' })
      if (!res.ok) {
        const text = await res.text()
        setError(text || `Export failed (${res.status})`)
        return
      }
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const cd = res.headers.get('content-disposition') ?? ''
      const match = cd.match(/filename="([^"]+)"/)
      const filename = match ? match[1] : `audit-export-${Date.now()}.zip`
      const a = document.createElement('a')
      a.href = url
      a.download = filename
      a.click()
      URL.revokeObjectURL(url)
      window.location.reload()
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex flex-col items-end gap-2">
      <button
        type="button"
        onClick={generate}
        disabled={loading}
        className="rounded bg-black px-4 py-2 text-sm font-medium text-white hover:bg-gray-800 disabled:bg-gray-400"
      >
        {loading ? 'Generating…' : 'Export ZIP'}
      </button>
      {error && <p className="text-xs text-red-600">{error}</p>}
    </div>
  )
}
