'use client'

import { useRouter, useSearchParams } from 'next/navigation'
import { useTransition } from 'react'

interface AdminOption {
  id: string
  display_name: string | null
}

interface AccountOption {
  id: string
  name: string
  plan_code: string
  org_count: number
}

interface Props {
  admins: AdminOption[]
  accounts: AccountOption[]
  actions: string[]
  initialAdminId: string
  initialAction: string
  initialOrgId: string
  initialAccountId: string
  initialFrom: string
  initialTo: string
}

export function AuditLogFilterBar({
  admins,
  accounts,
  actions,
  initialAdminId,
  initialAction,
  initialOrgId,
  initialAccountId,
  initialFrom,
  initialTo,
}: Props) {
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
      router.push(`/audit-log?${params.toString()}`)
    })
  }

  return (
    <form
      className="flex flex-wrap items-end gap-3 rounded-md border border-[color:var(--border)] bg-white p-4 shadow-sm"
      onSubmit={(e) => {
        e.preventDefault()
        const fd = new FormData(e.currentTarget)
        push({
          admin_user_id: String(fd.get('admin_user_id') ?? ''),
          action: String(fd.get('action') ?? ''),
          account_id: String(fd.get('account_id') ?? ''),
          org_id: String(fd.get('org_id') ?? ''),
          from: String(fd.get('from') ?? ''),
          to: String(fd.get('to') ?? ''),
        })
      }}
    >
      <Field label="Admin">
        <select
          name="admin_user_id"
          defaultValue={initialAdminId}
          className="rounded border border-[color:var(--border-mid)] px-2 py-1 text-xs"
        >
          <option value="">All admins</option>
          {admins.map((a) => (
            <option key={a.id} value={a.id}>
              {a.display_name ?? a.id.slice(0, 8)}
            </option>
          ))}
        </select>
      </Field>

      <Field label="Action">
        <select
          name="action"
          defaultValue={initialAction}
          className="rounded border border-[color:var(--border-mid)] px-2 py-1 text-xs"
        >
          <option value="">All actions</option>
          {actions.map((a) => (
            <option key={a} value={a}>
              {a}
            </option>
          ))}
        </select>
      </Field>

      <Field label="Account">
        <select
          name="account_id"
          defaultValue={initialAccountId}
          className="rounded border border-[color:var(--border-mid)] px-2 py-1 text-xs"
        >
          <option value="">All accounts</option>
          {accounts.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name} · {a.plan_code} · {a.org_count}{' '}
              {a.org_count === 1 ? 'org' : 'orgs'}
            </option>
          ))}
        </select>
      </Field>

      <Field label="Org ID (partial ok)">
        <input
          name="org_id"
          defaultValue={initialOrgId}
          placeholder="e.g. 1f9f1e70"
          className="rounded border border-[color:var(--border-mid)] px-2 py-1 text-xs"
        />
      </Field>

      <Field label="From">
        <input
          type="date"
          name="from"
          defaultValue={initialFrom}
          className="rounded border border-[color:var(--border-mid)] px-2 py-1 text-xs"
        />
      </Field>

      <Field label="To">
        <input
          type="date"
          name="to"
          defaultValue={initialTo}
          className="rounded border border-[color:var(--border-mid)] px-2 py-1 text-xs"
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
        onClick={() =>
          push({
            admin_user_id: '',
            action: '',
            account_id: '',
            org_id: '',
            from: '',
            to: '',
          })
        }
        className="rounded border border-[color:var(--border-mid)] bg-white px-3 py-1.5 text-xs text-text-2 hover:bg-bg"
      >
        Reset
      </button>
    </form>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-xs font-medium uppercase tracking-wider text-text-3">
        {label}
      </span>
      {children}
    </label>
  )
}
