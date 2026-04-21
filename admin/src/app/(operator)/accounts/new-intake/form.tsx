'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createOperatorIntakeAction } from '../actions'

interface PlanRow {
  plan_code: string
  display_name: string
  base_price_inr: number | null
  trial_days: number
}

export function NewIntakeForm({ plans }: { plans: PlanRow[] }) {
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [planCode, setPlanCode] = useState(plans[0]?.plan_code ?? '')
  const [orgName, setOrgName] = useState('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')
  const [ok, setOk] = useState<{ id: string } | null>(null)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setOk(null)

    if (!email.trim()) {
      setError('Email is required.')
      return
    }
    if (!planCode) {
      setError('Pick a plan.')
      return
    }

    setPending(true)
    const result = await createOperatorIntakeAction({
      email: email.trim(),
      planCode,
      orgName: orgName.trim() || null,
    })
    setPending(false)

    if (!result.ok) {
      setError(result.error)
      return
    }

    setOk({ id: result.data.id })
    setEmail('')
    setOrgName('')
    router.refresh()
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="space-y-4 rounded-md border border-[color:var(--border)] bg-white p-5 shadow-sm"
    >
      <div>
        <label
          htmlFor="email"
          className="block text-xs font-medium uppercase tracking-wide text-text-3"
        >
          Invitee email
        </label>
        <input
          id="email"
          type="email"
          required
          autoFocus
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="mt-1 block w-full rounded border border-[color:var(--border-mid)] px-3 py-2 text-sm"
        />
      </div>

      <div>
        <label
          htmlFor="plan"
          className="block text-xs font-medium uppercase tracking-wide text-text-3"
        >
          Plan
        </label>
        <select
          id="plan"
          required
          value={planCode}
          onChange={(e) => setPlanCode(e.target.value)}
          className="mt-1 block w-full rounded border border-[color:var(--border-mid)] bg-white px-3 py-2 text-sm"
        >
          {plans.map((p) => (
            <option key={p.plan_code} value={p.plan_code}>
              {p.display_name}
              {p.base_price_inr != null ? ` · ₹${p.base_price_inr}/mo` : ''}
              {p.trial_days > 0 ? ` · ${p.trial_days}d trial` : ''}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label
          htmlFor="org"
          className="block text-xs font-medium uppercase tracking-wide text-text-3"
        >
          Default organisation name{' '}
          <span className="font-normal normal-case text-text-3">
            (optional — defaults to the email&apos;s local part)
          </span>
        </label>
        <input
          id="org"
          type="text"
          value={orgName}
          onChange={(e) => setOrgName(e.target.value)}
          placeholder="Acme Corp"
          className="mt-1 block w-full rounded border border-[color:var(--border-mid)] px-3 py-2 text-sm"
        />
      </div>

      {error ? (
        <p className="rounded border border-red-200 bg-red-50 p-2 text-xs text-red-800">
          {error}
        </p>
      ) : null}

      {ok ? (
        <p className="rounded border border-green-200 bg-green-50 p-2 text-xs text-green-900">
          Intake created (id <code className="font-mono">{ok.id.slice(0, 8)}</code>). The
          invite email is being dispatched via Resend.
        </p>
      ) : null}

      <div className="flex items-center justify-end gap-2">
        <button
          type="submit"
          disabled={pending}
          className="rounded bg-teal px-4 py-2 text-sm font-medium text-white hover:bg-teal-dark disabled:opacity-50"
        >
          {pending ? 'Creating intake…' : 'Send invite'}
        </button>
      </div>
    </form>
  )
}
