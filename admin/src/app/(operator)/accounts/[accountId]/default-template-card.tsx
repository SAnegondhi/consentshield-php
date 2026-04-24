'use client'

import { useState, useTransition } from 'react'
import { setAccountDefaultTemplate } from './default-template-actions'

// ADR-1027 Sprint 3.3 — admin picker for accounts.default_sectoral_template_id.

export interface TemplateOption {
  id: string
  template_code: string
  display_name: string
  sector: string
  version: number
}

interface Props {
  accountId: string
  currentTemplate: {
    id: string
    template_code: string
    display_name: string
    version: number
    status: string
  } | null
  publishedTemplates: TemplateOption[]
  canPlatformOperator: boolean
}

export function DefaultTemplateCard({
  accountId,
  currentTemplate,
  publishedTemplates,
  canPlatformOperator,
}: Props) {
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [selected, setSelected] = useState<string>(currentTemplate?.id ?? '')

  function submit() {
    setError(null)
    const fd = new FormData()
    fd.set('account_id', accountId)
    fd.set('template_id', selected)
    startTransition(async () => {
      const res = await setAccountDefaultTemplate(fd)
      if (res && 'error' in res && res.error) setError(res.error)
    })
  }

  return (
    <section className="rounded-md border border-[color:var(--border)] bg-white shadow-sm">
      <header className="flex items-center justify-between border-b border-[color:var(--border)] px-4 py-2.5">
        <h2 className="text-sm font-semibold">Default sectoral template</h2>
        <span className="text-[11px] text-text-3">
          Applied to every first-org wizard in this account
        </span>
      </header>

      <div className="space-y-3 px-4 py-3">
        {currentTemplate ? (
          <div className="rounded border border-[color:var(--border)] bg-bg px-3 py-2 text-xs">
            <div className="flex items-center gap-2">
              <strong className="text-text">{currentTemplate.display_name}</strong>
              <code className="font-mono text-[11px] text-text-3">
                {currentTemplate.template_code} · v{currentTemplate.version}
              </code>
              {currentTemplate.status !== 'published' ? (
                <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] text-amber-800">
                  stale · {currentTemplate.status}
                </span>
              ) : (
                <span className="rounded bg-green-100 px-1.5 py-0.5 text-[10px] text-green-700">
                  published
                </span>
              )}
            </div>
            <p className="mt-1 text-text-2">
              New orgs in this account pre-select this template at wizard
              Step 4. Customer can still override.
            </p>
          </div>
        ) : (
          <p className="text-xs text-text-3">
            No account default. New orgs fall back to sector-detection at
            wizard Step 4.
          </p>
        )}

        {canPlatformOperator ? (
          <form
            onSubmit={(e) => {
              e.preventDefault()
              submit()
            }}
            className="flex flex-wrap items-center gap-2"
          >
            <select
              value={selected}
              onChange={(e) => setSelected(e.target.value)}
              disabled={pending}
              className="flex-1 min-w-[260px] rounded border border-[color:var(--border-mid)] bg-white px-2 py-1 text-xs"
            >
              <option value="">— No default (clear) —</option>
              {publishedTemplates.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.display_name} · {t.sector} · {t.template_code} · v{t.version}
                </option>
              ))}
            </select>
            <button
              type="submit"
              disabled={pending || selected === (currentTemplate?.id ?? '')}
              className="rounded bg-red-700 px-3 py-1 text-xs font-medium text-white hover:bg-red-800 disabled:opacity-50"
            >
              {pending ? 'Saving…' : 'Save default'}
            </button>
          </form>
        ) : (
          <p className="text-[11px] text-text-3">
            Read-only: requires platform_operator role to change the
            account default.
          </p>
        )}

        {error ? (
          <div className="rounded border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800">
            {error}
          </div>
        ) : null}
      </div>
    </section>
  )
}
