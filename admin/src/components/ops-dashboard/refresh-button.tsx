'use client'

import { useState, useTransition } from 'react'
import { refreshPlatformMetrics } from '../../app/(operator)/actions'

export function RefreshButton() {
  const [pending, startTransition] = useTransition()
  const [result, setResult] = useState<string | null>(null)

  return (
    <div className="flex items-center gap-3">
      <button
        type="button"
        onClick={() =>
          startTransition(async () => {
            const r = await refreshPlatformMetrics()
            setResult(r.ok ? `Refreshed for ${r.date}` : `Error: ${r.error}`)
            window.setTimeout(() => setResult(null), 4000)
          })
        }
        disabled={pending}
        className="rounded border border-zinc-300 bg-white px-3 py-1.5 text-xs font-medium text-zinc-800 hover:bg-zinc-50 disabled:opacity-50"
      >
        {pending ? 'Refreshing…' : 'Refresh now'}
      </button>
      {result ? (
        <span className="text-xs text-zinc-600">{result}</span>
      ) : null}
    </div>
  )
}
