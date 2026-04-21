'use client'

import { useState } from 'react'
import { swapPlan } from '../actions'

interface Plan {
  code: 'starter' | 'growth' | 'pro'
  name: string
  blurb: string
}

const PLANS: Plan[] = [
  {
    code: 'starter',
    name: 'Starter',
    blurb: '1 org, 1 web property, 10k consent events / month.',
  },
  {
    code: 'growth',
    name: 'Growth',
    blurb: '3 orgs, 5 properties each, 100k events / month.',
  },
  {
    code: 'pro',
    name: 'Pro',
    blurb: '10 orgs, 20 properties each, 1M events / month.',
  },
]

export function PlanSwap({
  orgId,
  currentPlan,
  onSwapped,
}: {
  orgId: string
  currentPlan: string | null
  onSwapped: (newPlan: Plan['code']) => void
}) {
  const [open, setOpen] = useState(false)
  const [pending, setPending] = useState<Plan['code'] | null>(null)
  const [error, setError] = useState('')

  async function handleSwap(target: Plan['code']) {
    setPending(target)
    setError('')
    const result = await swapPlan(orgId, target)
    setPending(null)
    if (!result.ok) {
      setError(result.error)
      return
    }
    onSwapped(target)
    setOpen(false)
  }

  const displayPlan =
    currentPlan ?? 'your current plan'

  return (
    <>
      <div className="mb-4 flex items-center justify-end gap-2 text-xs text-gray-500">
        <span>
          Plan:{' '}
          <code className="font-mono font-medium text-gray-700">
            {displayPlan}
          </code>
        </span>
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="rounded border border-gray-300 px-2 py-1 text-[11px] hover:border-gray-500"
        >
          Change plan
        </button>
      </div>

      {open ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="plan-swap-title"
          className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 p-4"
          onClick={() => setOpen(false)}
        >
          <div
            className="w-full max-w-xl rounded-lg bg-white p-6 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <header className="flex items-start justify-between">
              <div>
                <h2
                  id="plan-swap-title"
                  className="text-lg font-semibold text-gray-900"
                >
                  Change plan
                </h2>
                <p className="mt-1 text-xs text-gray-600">
                  Swap freely while you&apos;re onboarding. After handoff, plan
                  changes go through Settings → Billing.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="text-gray-400 hover:text-gray-700"
                aria-label="Close"
              >
                ✕
              </button>
            </header>

            {error ? (
              <p className="mt-3 rounded border border-red-200 bg-red-50 p-2 text-xs text-red-800">
                {error}
              </p>
            ) : null}

            <div className="mt-4 space-y-3">
              {PLANS.map((p) => {
                const isCurrent = p.code === currentPlan
                return (
                  <div
                    key={p.code}
                    className={
                      isCurrent
                        ? 'rounded border-2 border-teal-500 bg-teal-50 p-3'
                        : 'rounded border border-gray-200 p-3 hover:border-gray-400'
                    }
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-sm font-semibold text-gray-900">
                          {p.name}
                        </p>
                        <p className="mt-0.5 text-xs text-gray-600">
                          {p.blurb}
                        </p>
                      </div>
                      {isCurrent ? (
                        <span className="rounded-full bg-teal-600 px-2 py-0.5 text-[10px] font-medium text-white">
                          Current
                        </span>
                      ) : (
                        <button
                          type="button"
                          disabled={pending !== null}
                          onClick={() => handleSwap(p.code)}
                          className="rounded bg-black px-3 py-1 text-xs font-medium text-white hover:bg-gray-800 disabled:opacity-50"
                        >
                          {pending === p.code ? 'Switching…' : 'Switch'}
                        </button>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>

            <p className="mt-4 text-[11px] text-gray-500">
              Enterprise plans are sold-by-conversation — email{' '}
              <a
                href="mailto:hello@consentshield.in"
                className="underline hover:text-gray-800"
              >
                hello@consentshield.in
              </a>
              .
            </p>
          </div>
        </div>
      ) : null}
    </>
  )
}
