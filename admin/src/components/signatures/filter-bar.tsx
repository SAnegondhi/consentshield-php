'use client'

import { useRouter, useSearchParams } from 'next/navigation'

const CATEGORIES = [
  { value: 'analytics', label: 'Analytics' },
  { value: 'marketing', label: 'Marketing' },
  { value: 'advertising', label: 'Advertising' },
  { value: 'social', label: 'Social' },
  { value: 'functional', label: 'Functional' },
  { value: 'other', label: 'Other' },
] as const

export function SignaturesFilterBar() {
  const router = useRouter()
  const params = useSearchParams()
  const currentCategory = params.get('category') ?? ''
  const currentSeverity = params.get('severity') ?? ''
  const currentStatus = params.get('status') ?? ''

  function setParam(key: string, value: string) {
    const next = new URLSearchParams(params.toString())
    if (value) next.set(key, value)
    else next.delete(key)
    router.push(`/signatures?${next.toString()}`)
  }

  const pillClass = (active: boolean, color: 'navy' | 'red' | 'gray') => {
    if (active) {
      return color === 'red'
        ? 'cursor-pointer rounded-full bg-admin-accent px-2.5 py-0.5 text-[11px] font-medium text-white'
        : color === 'navy'
          ? 'cursor-pointer rounded-full bg-teal px-2.5 py-0.5 text-[11px] font-medium text-white'
          : 'cursor-pointer rounded-full bg-[color:var(--border)] px-2.5 py-0.5 text-[11px] font-medium text-text-2'
    }
    return 'cursor-pointer rounded-full bg-bg px-2.5 py-0.5 text-[11px] font-medium text-text-2 hover:bg-[color:var(--border)]'
  }

  return (
    <div className="space-y-3 rounded-md border border-[color:var(--border)] bg-white p-3 shadow-sm">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-text-3">
          Category
        </span>
        <button
          type="button"
          onClick={() => setParam('category', '')}
          className={pillClass(currentCategory === '', 'navy')}
        >
          All
        </button>
        {CATEGORIES.map((c) => (
          <button
            key={c.value}
            type="button"
            onClick={() => setParam('category', c.value)}
            className={pillClass(currentCategory === c.value, 'gray')}
          >
            {c.label}
          </button>
        ))}
        <button
          type="button"
          onClick={() =>
            setParam('severity', currentSeverity === 'critical' ? '' : 'critical')
          }
          className={pillClass(currentSeverity === 'critical', 'red')}
        >
          Critical severity
        </button>
      </div>
      <div className="flex flex-wrap items-center gap-2">
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
          </select>
        </label>
        {(currentCategory || currentSeverity || currentStatus) && (
          <button
            type="button"
            onClick={() => router.push('/signatures')}
            className="text-xs text-text-3 hover:underline"
          >
            Clear filters
          </button>
        )}
      </div>
    </div>
  )
}
