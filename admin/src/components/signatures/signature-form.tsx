'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { Field, ReasonField } from '@/components/common/modal-form'
import {
  createSignature,
  updateSignature,
} from '@/app/(operator)/signatures/actions'

// ADR-0031 Sprint 2.2 — Tracker signature create/edit form.

const SIG_TYPES = [
  'script_src',
  'resource_url',
  'cookie_name',
  'localstorage_key',
  'dom_attribute',
] as const
const CATEGORIES = [
  'analytics',
  'marketing',
  'advertising',
  'social',
  'functional',
  'other',
] as const
const SEVERITIES = ['info', 'warn', 'critical'] as const

export interface SignatureFormInput {
  signatureCode: string
  displayName: string
  vendor: string
  signatureType: string
  pattern: string
  category: string
  severity: string
  notes: string
}

const DEFAULT: SignatureFormInput = {
  signatureCode: '',
  displayName: '',
  vendor: '',
  signatureType: 'script_src',
  pattern: '',
  category: 'analytics',
  severity: 'warn',
  notes: '',
}

export function SignatureForm({
  mode,
  signatureId,
  initial,
}: {
  mode: 'create' | 'edit'
  signatureId?: string
  initial?: Partial<SignatureFormInput>
}) {
  const router = useRouter()
  const [values, setValues] = useState<SignatureFormInput>({
    ...DEFAULT,
    ...initial,
  })
  const [reason, setReason] = useState('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function set<K extends keyof SignatureFormInput>(k: K, v: SignatureFormInput[K]) {
    setValues((prev) => ({ ...prev, [k]: v }))
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setPending(true)
    setError(null)

    if (mode === 'create') {
      const r = await createSignature({ ...values, reason })
      setPending(false)
      if (!r.ok) {
        setError(r.error)
        return
      }
      router.push(`/signatures/${r.data!.signatureId}`)
    } else {
      const r = await updateSignature({
        signatureId: signatureId!,
        displayName: values.displayName,
        pattern: values.pattern,
        category: values.category,
        severity: values.severity,
        notes: values.notes,
        reason,
      })
      setPending(false)
      if (!r.ok) {
        setError(r.error)
        return
      }
      router.push(`/signatures/${signatureId}`)
    }
  }

  const reasonOk = reason.trim().length >= 10

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <section className="grid grid-cols-1 gap-3 rounded-md border border-[color:var(--border)] bg-white p-4 shadow-sm md:grid-cols-2">
        <Field label="Signature code">
          <input
            value={values.signatureCode}
            onChange={(e) => set('signatureCode', e.target.value)}
            disabled={mode === 'edit'}
            placeholder="ga4"
            className="rounded border border-[color:var(--border-mid)] px-3 py-1.5 font-mono text-sm disabled:bg-bg disabled:text-text-3"
          />
        </Field>
        <Field label="Display name">
          <input
            value={values.displayName}
            onChange={(e) => set('displayName', e.target.value)}
            className="rounded border border-[color:var(--border-mid)] px-3 py-1.5 text-sm"
          />
        </Field>
        <Field label="Vendor">
          <input
            value={values.vendor}
            onChange={(e) => set('vendor', e.target.value)}
            disabled={mode === 'edit'}
            className="rounded border border-[color:var(--border-mid)] px-3 py-1.5 text-sm disabled:bg-bg disabled:text-text-3"
          />
        </Field>
        <Field label="Signature type">
          <select
            value={values.signatureType}
            onChange={(e) => set('signatureType', e.target.value)}
            disabled={mode === 'edit'}
            className="rounded border border-[color:var(--border-mid)] px-3 py-1.5 text-sm disabled:bg-bg disabled:text-text-3"
          >
            {SIG_TYPES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Category">
          <select
            value={values.category}
            onChange={(e) => set('category', e.target.value)}
            className="rounded border border-[color:var(--border-mid)] px-3 py-1.5 text-sm"
          >
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Severity">
          <select
            value={values.severity}
            onChange={(e) => set('severity', e.target.value)}
            className="rounded border border-[color:var(--border-mid)] px-3 py-1.5 text-sm"
          >
            {SEVERITIES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </Field>
      </section>

      <section className="rounded-md border border-[color:var(--border)] bg-white p-4 shadow-sm">
        <Field label="Pattern (regex)">
          <input
            value={values.pattern}
            onChange={(e) => set('pattern', e.target.value)}
            placeholder="/googletagmanager\.com\/gtag\/js/"
            className="rounded border border-[color:var(--border-mid)] px-3 py-1.5 font-mono text-sm"
          />
        </Field>
        <p className="mt-2 text-[11px] text-text-3">
          JS regex. Either raw body (<code>googletagmanager\.com\/gtag</code>) or
          slash-delimited (<code>/googletagmanager\.com\/gtag/i</code>). Pattern
          is compile-checked on submit.
        </p>
      </section>

      <section className="rounded-md border border-[color:var(--border)] bg-white p-4 shadow-sm">
        <Field label="Notes (operator-only)">
          <textarea
            value={values.notes}
            onChange={(e) => set('notes', e.target.value)}
            rows={3}
            className="rounded border border-[color:var(--border-mid)] px-3 py-2 text-sm"
          />
        </Field>
      </section>

      <section className="rounded-md border border-[color:var(--border)] bg-white p-4 shadow-sm">
        <ReasonField reason={reason} onChange={setReason} />
      </section>

      {error ? (
        <p className="rounded border border-red-200 bg-red-50 p-3 text-sm text-red-800">
          {error}
        </p>
      ) : null}

      <div className="flex items-center justify-end gap-2">
        <button
          type="button"
          onClick={() => router.back()}
          className="rounded border border-[color:var(--border)] bg-white px-3 py-1.5 text-xs text-text-2 hover:bg-bg"
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={pending || !reasonOk}
          className="rounded bg-teal px-3 py-1.5 text-xs font-medium text-white hover:bg-teal-mid disabled:opacity-50"
        >
          {pending ? 'Saving…' : mode === 'create' ? 'Create signature' : 'Save changes'}
        </button>
      </div>
    </form>
  )
}
