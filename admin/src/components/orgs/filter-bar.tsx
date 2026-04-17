'use client'

import { useRouter, useSearchParams } from 'next/navigation'
import { useTransition } from 'react'

const PLANS = ['free', 'starter', 'growth', 'pro', 'enterprise'] as const
const STATUSES = ['active', 'suspended', 'archived'] as const

interface Props {
  initialPlan: string
  initialStatus: string
  initialQ: string
}

export function OrgsFilterBar({ initialPlan, initialStatus, initialQ }: Props) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [pending, startTransition] = useTransition()

  function push(patch: Record<string, string>) {
    const params = new URLSearchParams(searchParams.toString())
    for (const [key, value] of Object.entries(patch)) {
      if (value) params.set(key, value)
      else params.delete(key)
    }
    params.delete('page')
    startTransition(() => {
      router.push(`/orgs?${params.toString()}`)
    })
  }

  return (
    <form
      className="flex flex-wrap items-end gap-3 rounded-md border border-zinc-200 bg-white p-4 shadow-sm"
      onSubmit={(e) => {
        e.preventDefault()
        const fd = new FormData(e.currentTarget)
        push({
          plan: String(fd.get('plan') ?? ''),
          status: String(fd.get('status') ?? ''),
          q: String(fd.get('q') ?? ''),
        })
      }}
    >
      <Field label="Plan">
        <select
          name="plan"
          defaultValue={initialPlan}
          className="rounded border border-zinc-300 px-2 py-1 text-xs"
        >
          <option value="">All plans</option>
          {PLANS.map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </select>
      </Field>

      <Field label="Status">
        <select
          name="status"
          defaultValue={initialStatus}
          className="rounded border border-zinc-300 px-2 py-1 text-xs"
        >
          <option value="">Any</option>
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
      </Field>

      <Field label="Search (name, email, id prefix)">
        <input
          name="q"
          defaultValue={initialQ}
          placeholder="e.g. acme"
          className="w-64 rounded border border-zinc-300 px-2 py-1 text-xs"
        />
      </Field>

      <button
        type="submit"
        disabled={pending}
        className="rounded bg-red-700 px-3 py-1.5 text-xs font-medium text-white hover:bg-red-800 disabled:opacity-50"
      >
        {pending ? 'Applying…' : 'Apply'}
      </button>
      <button
        type="button"
        onClick={() => push({ plan: '', status: '', q: '' })}
        className="rounded border border-zinc-300 bg-white px-3 py-1.5 text-xs text-zinc-700 hover:bg-zinc-50"
      >
        Reset
      </button>
    </form>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-xs font-medium uppercase tracking-wider text-zinc-500">
        {label}
      </span>
      {children}
    </label>
  )
}
