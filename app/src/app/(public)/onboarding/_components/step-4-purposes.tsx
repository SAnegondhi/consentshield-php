'use client'

import { useEffect, useState } from 'react'
import {
  applyTemplate,
  getAccountDefaultTemplate,
  listTemplatesForSector,
  setOnboardingStep,
} from '../actions'

interface TemplateOption {
  template_code: string
  display_name: string
  description: string
  version: number
  purpose_count: number
}

export function Step4Purposes({
  orgId,
  industry,
  onComplete,
}: {
  orgId: string
  industry: string
  onComplete: () => void
}) {
  const [templates, setTemplates] = useState<TemplateOption[] | null>(null)
  const [accountDefault, setAccountDefault] = useState<{
    template_code: string
    display_name: string
  } | null>(null)
  const [pending, setPending] = useState<string | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false
    // ADR-1027 Sprint 3.3 — pull the two in parallel: the sector's
    // published templates and the account-default (if any). The two
    // promises are independent so a slow Account fetch never stalls
    // the template picker render.
    Promise.all([
      listTemplatesForSector(industry),
      getAccountDefaultTemplate(),
    ]).then(([tplRes, defRes]) => {
      if (cancelled) return
      if (!tplRes.ok) {
        setError(tplRes.error)
        setTemplates([])
      } else {
        setTemplates(tplRes.data)
      }
      if (defRes.ok && defRes.data) {
        setAccountDefault({
          template_code: defRes.data.template_code,
          display_name: defRes.data.display_name,
        })
      }
    })
    return () => {
      cancelled = true
    }
  }, [industry])

  async function handleApply(code: string) {
    setPending(code)
    setError('')
    const applyResult = await applyTemplate(code)
    if (!applyResult.ok) {
      setError(applyResult.error)
      setPending(null)
      return
    }
    const stepResult = await setOnboardingStep(orgId, 4)
    if (!stepResult.ok) {
      setError(stepResult.error)
      setPending(null)
      return
    }
    onComplete()
  }

  async function handleSkip() {
    setPending('skip')
    setError('')
    const stepResult = await setOnboardingStep(orgId, 4)
    if (!stepResult.ok) {
      setError(stepResult.error)
      setPending(null)
      return
    }
    onComplete()
  }

  return (
    <div className="mx-auto max-w-3xl rounded-lg border border-gray-200 bg-white p-8 shadow-sm">
      <h1 className="text-2xl font-semibold">
        Pick a starting set of purposes
      </h1>
      <p className="mt-2 text-sm text-gray-600">
        A sector template is a pre-composed bundle of consent purposes,
        legal bases, and default retentions for the{' '}
        <strong>{industry}</strong> sector. You can edit every purpose
        later from the dashboard.
      </p>

      {error ? (
        <p className="mt-4 rounded border border-red-200 bg-red-50 p-3 text-sm text-red-800">
          {error}
        </p>
      ) : null}

      {templates === null ? (
        <p className="mt-6 text-sm text-gray-500">Loading templates…</p>
      ) : templates.length === 0 ? (
        <div className="mt-6 rounded border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          No published templates are available for{' '}
          <code>{industry}</code> yet. You can pick a template later from
          Settings → Sector template, or continue without one.
        </div>
      ) : (
        <div className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-2">
          {/* ADR-1027 Sprint 3.3 — pre-selection: if the account has a
              default template AND it's in the sector's published list,
              float it to the top with a visible "Account default" badge. */}
          {orderTemplates(templates, accountDefault).map((t) => {
            const isAccountDefault =
              accountDefault !== null &&
              accountDefault.template_code === t.template_code
            return (
              <div
                key={`${t.template_code}-${t.version}`}
                className={
                  isAccountDefault
                    ? 'rounded border-2 border-teal-500 bg-teal-50 p-4'
                    : 'rounded border border-gray-200 bg-white p-4 hover:border-gray-400'
                }
              >
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-semibold text-gray-900">
                        {t.display_name}
                      </p>
                      {isAccountDefault ? (
                        <span className="rounded bg-teal-600 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-white">
                          Account default
                        </span>
                      ) : null}
                    </div>
                    <p className="mt-0.5 font-mono text-xs text-gray-500">
                      {t.template_code} · v{t.version} · {t.purpose_count}{' '}
                      purposes
                    </p>
                  </div>
                </div>
                <p className="mt-2 text-sm text-gray-700">{t.description}</p>
                <div className="mt-3 flex justify-end">
                  <button
                    type="button"
                    disabled={pending !== null}
                    onClick={() => handleApply(t.template_code)}
                    className={
                      isAccountDefault
                        ? 'rounded bg-teal-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-teal-700 disabled:opacity-50'
                        : 'rounded bg-black px-3 py-1.5 text-xs font-medium text-white hover:bg-gray-800 disabled:opacity-50'
                    }
                  >
                    {pending === t.template_code
                      ? 'Applying…'
                      : isAccountDefault
                        ? 'Use account default'
                        : 'Use this template'}
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      )}

      <div className="mt-6 border-t border-gray-100 pt-4">
        <button
          type="button"
          disabled={pending !== null}
          onClick={handleSkip}
          className="text-xs text-gray-500 hover:text-gray-800 disabled:opacity-50"
        >
          {pending === 'skip' ? 'Skipping…' : 'Skip for now →'}
        </button>
      </div>
    </div>
  )
}

// ADR-1027 Sprint 3.3 — float the account-default template to the top
// when it matches one of the sector-published templates. Returns a new
// array; does not mutate input.
function orderTemplates(
  templates: TemplateOption[],
  accountDefault: { template_code: string } | null,
): TemplateOption[] {
  if (!accountDefault) return templates
  const match = templates.find(
    (t) => t.template_code === accountDefault.template_code,
  )
  if (!match) return templates
  return [match, ...templates.filter((t) => t.template_code !== match.template_code)]
}
