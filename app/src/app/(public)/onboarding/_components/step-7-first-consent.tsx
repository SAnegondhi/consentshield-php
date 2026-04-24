'use client'

import { useEffect, useRef, useState } from 'react'
import { setOnboardingStep } from '../actions'

interface StatusResponse {
  onboarding_step: number
  onboarded_at: string | null
  first_consent_at: string | null
  // ADR-1025 Sprint 2.2 — storage provisioning state (soft-banner fuel).
  storage_verified: boolean | null
}

const POLL_INTERVAL_MS = 5_000
const TIMEOUT_MS = 5 * 60 * 1000

type Stage = 'watching' | 'consented' | 'timed_out' | 'finalising'

export function Step7FirstConsent({
  orgId,
  onDone,
}: {
  orgId: string
  onDone: () => void
}) {
  const [stage, setStage] = useState<Stage>('watching')
  const [firstConsentAt, setFirstConsentAt] = useState<string | null>(null)
  const [elapsedSec, setElapsedSec] = useState(0)
  const [error, setError] = useState('')
  // ADR-1025 Sprint 2.2 — tracks export_configurations.is_verified. `null`
  // means no row yet (provisioning trigger in flight), `false` means
  // verification hasn't succeeded, `true` means storage is ready. Hides
  // the soft banner when `true`.
  const [storageVerified, setStorageVerified] = useState<boolean | null>(null)

  const startedAtRef = useRef<number | null>(null)
  if (startedAtRef.current === null) {
    startedAtRef.current = new Date().getTime()
  }

  useEffect(() => {
    if (stage !== 'watching') return
    let cancelled = false

    async function tick() {
      try {
        const res = await fetch(`/api/orgs/${orgId}/onboarding/status`)
        if (!res.ok) {
          setError(`status ${res.status}`)
          return
        }
        const json = (await res.json()) as StatusResponse
        if (cancelled) return

        setStorageVerified(json.storage_verified)

        if (json.first_consent_at) {
          setFirstConsentAt(json.first_consent_at)
          setStage('consented')
          return
        }

        const elapsed = new Date().getTime() - (startedAtRef.current ?? 0)
        setElapsedSec(Math.floor(elapsed / 1000))
        if (elapsed >= TIMEOUT_MS) {
          setStage('timed_out')
        }
      } catch (err) {
        if (cancelled) return
        setError(err instanceof Error ? err.message : 'poll_failed')
      }
    }

    // Fire immediately + then interval.
    void tick()
    const id = setInterval(() => {
      void tick()
    }, POLL_INTERVAL_MS)

    return () => {
      cancelled = true
      clearInterval(id)
    }
  }, [orgId, stage])

  async function finalise(destination: 'dashboard') {
    setStage('finalising')
    const step = await setOnboardingStep(orgId, 7)
    if (!step.ok) {
      setError(step.error)
      setStage('consented')
      return
    }
    if (destination === 'dashboard') {
      window.location.href = '/dashboard?welcome=1'
    } else {
      onDone()
    }
  }

  return (
    <div className="mx-auto max-w-2xl rounded-lg border border-gray-200 bg-white p-8 shadow-sm">
      {storageVerified !== true ? <StorageInitialisingBanner /> : null}
      <h1 className="text-2xl font-semibold">
        {stage === 'consented'
          ? 'First consent captured!'
          : stage === 'timed_out'
            ? 'No consent yet — that’s fine'
            : 'Waiting for the first consent event'}
      </h1>

      {stage === 'watching' ? (
        <div className="mt-4 space-y-4">
          <p className="text-sm text-gray-600">
            Visit your site in another tab, interact with the banner, and
            we&apos;ll light this screen up the moment the first event
            lands. We watch for up to 5 minutes — if it doesn&apos;t happen
            in this session, we&apos;ll email you when it does.
          </p>
          <div className="flex items-center gap-3">
            <Spinner />
            <span className="text-xs text-gray-500">
              {fmtElapsed(elapsedSec)} elapsed · polling every 5 s
            </span>
          </div>
          {error ? <p className="text-xs text-red-600">{error}</p> : null}
          <button
            type="button"
            onClick={() => setStage('timed_out')}
            className="text-xs text-gray-500 hover:text-gray-800"
          >
            Skip the wait →
          </button>
        </div>
      ) : null}

      {stage === 'consented' ? (
        <div className="mt-4 space-y-4">
          <p className="text-sm text-gray-700">
            We captured a consent event at{' '}
            <strong>
              {firstConsentAt ? new Date(firstConsentAt).toLocaleString() : '—'}
            </strong>
            . Your ConsentShield pipeline is live.
          </p>
          {error ? (
            <p className="rounded border border-red-200 bg-red-50 p-3 text-sm text-red-800">
              {error}
            </p>
          ) : null}
          <button
            type="button"
            onClick={() => finalise('dashboard')}
            className="rounded bg-black px-4 py-2 text-sm font-medium text-white hover:bg-gray-800"
          >
            Open my dashboard
          </button>
        </div>
      ) : null}

      {stage === 'timed_out' ? (
        <div className="mt-4 space-y-4">
          <p className="text-sm text-gray-700">
            No consent event has landed yet in this session. That&apos;s
            normal — banners only fire when visitors interact. We&apos;ll
            email you when the first event arrives. Meanwhile, continue to
            your dashboard.
          </p>
          {error ? (
            <p className="rounded border border-red-200 bg-red-50 p-3 text-sm text-red-800">
              {error}
            </p>
          ) : null}
          <button
            type="button"
            onClick={() => finalise('dashboard')}
            className="rounded bg-black px-4 py-2 text-sm font-medium text-white hover:bg-gray-800"
          >
            Finish setup and open dashboard
          </button>
        </div>
      ) : null}

      {stage === 'finalising' ? (
        <p className="mt-4 text-sm text-gray-500">Finishing up…</p>
      ) : null}
    </div>
  )
}

function Spinner() {
  return (
    <span
      aria-label="Loading"
      className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-gray-300 border-t-gray-800"
    />
  )
}

function fmtElapsed(sec: number): string {
  const m = Math.floor(sec / 60)
  const s = sec % 60
  return `${m}m ${s.toString().padStart(2, '0')}s`
}

// ADR-1025 Sprint 2.2 — soft banner shown while the CS-managed R2 bucket is
// still being provisioned in the background. Non-blocking: the wizard's
// other actions (waiting for first consent, proceeding to dashboard) stay
// fully usable. Disappears on the next poll tick once
// `export_configurations.is_verified` flips to true.
function StorageInitialisingBanner() {
  return (
    <div
      role="status"
      aria-live="polite"
      className="mb-6 flex items-start gap-3 rounded-md border border-blue-200 bg-blue-50 p-3 text-sm text-blue-900"
    >
      <Spinner />
      <div>
        <div className="font-medium">Storage initialising</div>
        <p className="mt-0.5 text-xs text-blue-800">
          We&apos;re provisioning your compliance-record bucket in the
          background. You can keep using the wizard — this banner clears
          automatically when storage is ready (usually &lt; 30 seconds).
        </p>
      </div>
    </div>
  )
}
