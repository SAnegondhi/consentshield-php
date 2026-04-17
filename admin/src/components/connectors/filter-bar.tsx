'use client'

import { useRouter, useSearchParams } from 'next/navigation'

export function ConnectorsFilterBar({ vendors }: { vendors: string[] }) {
  const router = useRouter()
  const params = useSearchParams()
  const currentStatus = params.get('status') ?? ''
  const currentVendor = params.get('vendor') ?? ''

  function setParam(key: string, value: string) {
    const next = new URLSearchParams(params.toString())
    if (value) next.set(key, value)
    else next.delete(key)
    router.push(`/connectors?${next.toString()}`)
  }

  return (
    <div className="flex flex-wrap items-center gap-3 rounded-md border border-[color:var(--border)] bg-white p-3 shadow-sm">
      <label className="flex items-center gap-2 text-xs text-text-2">
        <span className="font-medium uppercase tracking-wider">Status</span>
        <select
          value={currentStatus}
          onChange={(e) => setParam('status', e.target.value)}
          className="rounded border border-[color:var(--border-mid)] px-2 py-1 text-sm"
        >
          <option value="">All</option>
          <option value="active">Active</option>
          <option value="deprecated">Deprecated</option>
          <option value="retired">Retired</option>
        </select>
      </label>

      <label className="flex items-center gap-2 text-xs text-text-2">
        <span className="font-medium uppercase tracking-wider">Vendor</span>
        <select
          value={currentVendor}
          onChange={(e) => setParam('vendor', e.target.value)}
          className="rounded border border-[color:var(--border-mid)] px-2 py-1 text-sm"
        >
          <option value="">All</option>
          {vendors.map((v) => (
            <option key={v} value={v}>
              {v}
            </option>
          ))}
        </select>
      </label>

      {(currentStatus || currentVendor) && (
        <button
          type="button"
          onClick={() => router.push('/connectors')}
          className="text-xs text-text-3 hover:underline"
        >
          Clear filters
        </button>
      )}
    </div>
  )
}
