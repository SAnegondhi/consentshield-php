'use client'

import { useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'

// ADR-0058 Sprint 1.5 — one-time welcome toast shown when the wizard
// hands the user off via `/dashboard?welcome=1`. Auto-dismisses after
// 8 seconds and strips the `?welcome=1` query param so a refresh
// doesn't replay the toast.

export function WelcomeToast() {
  const params = useSearchParams()
  const router = useRouter()
  const isWelcome = params.get('welcome') === '1'
  const [dismissed, setDismissed] = useState(false)

  useEffect(() => {
    if (!isWelcome) return
    // Strip ?welcome=1 so a refresh doesn't replay the toast.
    const next = new URLSearchParams(params.toString())
    next.delete('welcome')
    const qs = next.toString()
    router.replace(qs ? `?${qs}` : window.location.pathname)

    const timer = setTimeout(() => setDismissed(true), 8_000)
    return () => clearTimeout(timer)
  }, [isWelcome, params, router])

  if (!isWelcome || dismissed) return null

  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed right-6 top-6 z-50 max-w-sm rounded-lg border border-teal-200 bg-white p-4 shadow-lg"
    >
      <div className="flex items-start gap-3">
        <span
          aria-hidden
          className="mt-0.5 flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full bg-teal-600 text-xs font-bold text-white"
        >
          ✓
        </span>
        <div>
          <p className="text-sm font-semibold text-gray-900">
            Welcome to ConsentShield!
          </p>
          <p className="mt-1 text-xs text-gray-600">
            Your account is fully set up. Explore the dashboard, or head
            to Settings → Properties to manage your web-property verification.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setDismissed(true)}
          aria-label="Dismiss"
          className="ml-2 text-gray-400 hover:text-gray-700"
        >
          ✕
        </button>
      </div>
    </div>
  )
}
