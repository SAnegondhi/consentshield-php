'use client'

import { useEffect, useState } from 'react'
import { setOnboardingStep } from '../actions'

interface DepaScore {
  total: number
  coverage_score: number
  expiry_score: number
  freshness_score: number
  revocation_score: number
  computed_at: string
  stale: boolean
}

interface TopAction {
  title: string
  detail: string
}

export function Step6Scores({
  orgId,
  onComplete,
}: {
  orgId: string
  onComplete: () => void
}) {
  const [score, setScore] = useState<DepaScore | null>(null)
  const [error, setError] = useState('')
  const [advancing, setAdvancing] = useState(false)

  useEffect(() => {
    let cancelled = false
    fetch(`/api/orgs/${orgId}/depa-score`)
      .then((r) => r.json() as Promise<DepaScore | { error: string }>)
      .then((json) => {
        if (cancelled) return
        if ('error' in json) {
          setError(json.error)
          return
        }
        setScore(json)
      })
      .catch((err) => {
        if (cancelled) return
        setError(err instanceof Error ? err.message : 'score_fetch_failed')
      })
    return () => {
      cancelled = true
    }
  }, [orgId])

  async function handleContinue() {
    setAdvancing(true)
    const step = await setOnboardingStep(orgId, 6)
    if (!step.ok) {
      setError(step.error)
      setAdvancing(false)
      return
    }
    onComplete()
  }

  const actions = score ? buildTop3Actions(score) : []

  return (
    <div className="mx-auto max-w-3xl rounded-lg border border-gray-200 bg-white p-8 shadow-sm">
      <h1 className="text-2xl font-semibold">Your DEPA compliance score</h1>
      <p className="mt-2 text-sm text-gray-600">
        A rolling 0–100 score across four dimensions. Fresh orgs start
        near zero — the score climbs as real consent events land.
      </p>

      {error ? (
        <p className="mt-4 rounded border border-red-200 bg-red-50 p-3 text-sm text-red-800">
          {error}
        </p>
      ) : null}

      {score === null && !error ? (
        <p className="mt-6 text-sm text-gray-500">Calculating…</p>
      ) : null}

      {score ? (
        <div className="mt-6 space-y-6">
          <TotalGauge total={score.total} />
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <DimensionTile label="Coverage" value={score.coverage_score} />
            <DimensionTile label="Expiry" value={score.expiry_score} />
            <DimensionTile label="Freshness" value={score.freshness_score} />
            <DimensionTile label="Revocation" value={score.revocation_score} />
          </div>

          {actions.length > 0 ? (
            <div className="rounded border border-gray-200 bg-gray-50 p-4">
              <h2 className="text-sm font-semibold text-gray-900">
                Top 3 actions to raise your score
              </h2>
              <ol className="mt-3 space-y-3">
                {actions.map((a, i) => (
                  <li key={i} className="flex items-start gap-3">
                    <span className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full bg-teal-600 text-[11px] font-semibold text-white">
                      {i + 1}
                    </span>
                    <div>
                      <p className="text-sm font-medium text-gray-900">
                        {a.title}
                      </p>
                      <p className="mt-0.5 text-xs text-gray-600">
                        {a.detail}
                      </p>
                    </div>
                  </li>
                ))}
              </ol>
            </div>
          ) : null}

          {score.stale ? (
            <p className="text-xs text-gray-500">
              This score is computed live; nightly refresh hasn&apos;t run
              for this org yet.
            </p>
          ) : null}

          <button
            type="button"
            onClick={handleContinue}
            disabled={advancing}
            className="w-full rounded bg-black px-4 py-2 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-50"
          >
            {advancing ? 'Continuing…' : 'Looks good — continue'}
          </button>
        </div>
      ) : null}
    </div>
  )
}

function TotalGauge({ total }: { total: number }) {
  const clamped = Math.max(0, Math.min(100, Math.round(total)))
  const color =
    clamped >= 75
      ? 'bg-teal-600'
      : clamped >= 50
        ? 'bg-amber-500'
        : 'bg-rose-500'
  return (
    <div>
      <div className="flex items-baseline justify-between">
        <span className="text-xs font-medium uppercase tracking-wide text-gray-500">
          Total
        </span>
        <span className="text-3xl font-semibold text-gray-900">
          {clamped}
          <span className="ml-1 text-sm font-normal text-gray-400">/ 100</span>
        </span>
      </div>
      <div className="mt-2 h-3 w-full overflow-hidden rounded-full bg-gray-100">
        <div
          className={`h-full ${color}`}
          style={{ width: `${clamped}%` }}
          role="progressbar"
          aria-valuenow={clamped}
          aria-valuemin={0}
          aria-valuemax={100}
        />
      </div>
    </div>
  )
}

function DimensionTile({ label, value }: { label: string; value: number }) {
  const clamped = Math.max(0, Math.min(100, Math.round(value)))
  return (
    <div className="rounded border border-gray-200 bg-white p-3">
      <p className="text-[11px] font-medium uppercase tracking-wide text-gray-500">
        {label}
      </p>
      <p className="mt-1 text-xl font-semibold text-gray-900">{clamped}</p>
    </div>
  )
}

// Pick the lowest three dimensions and map each to a canned action.
// Stable ordering: worst-first so the actions match the weakest
// signal. If multiple dimensions tie, order is
// coverage → expiry → freshness → revocation.
function buildTop3Actions(score: DepaScore): TopAction[] {
  const dimensions: ReadonlyArray<{
    key: 'coverage' | 'expiry' | 'freshness' | 'revocation'
    value: number
    action: TopAction
  }> = [
    {
      key: 'coverage',
      value: score.coverage_score,
      action: {
        title: 'Cover every purpose in your consent banner',
        detail:
          'Your banner should present one toggle per purpose defined in your Data Inventory. Missing or unused purposes pull this score down.',
      },
    },
    {
      key: 'expiry',
      value: score.expiry_score,
      action: {
        title: 'Set realistic expiry windows',
        detail:
          'Purposes without a validity window (or with windows longer than your legal basis allows) drag this down. 12–24 months is typical for marketing; shorter for analytics.',
      },
    },
    {
      key: 'freshness',
      value: score.freshness_score,
      action: {
        title: 'Re-prompt on material change',
        detail:
          'Old consent ages out of compliance. Trigger a fresh consent event when you change purposes, processors, or retention terms.',
      },
    },
    {
      key: 'revocation',
      value: score.revocation_score,
      action: {
        title: 'Honour revocations end-to-end',
        detail:
          'Every revoked artefact should drive a downstream deletion receipt. Missing or delayed receipts pull this score down.',
      },
    },
  ]
  return [...dimensions]
    .sort((a, b) => a.value - b.value)
    .slice(0, 3)
    .map((d) => d.action)
}
