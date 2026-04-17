'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  createDraft,
  updateDraft,
  type PurposeRow,
} from '@/app/(operator)/templates/actions'

// ADR-0030 Sprint 2.1 — Template form shared by /new and /[id]/edit.

interface BaseProps {
  initialValues: {
    templateCode: string
    displayName: string
    description: string
    sector: string
    purposes: PurposeRow[]
  }
  knownSectors: string[]
}

type Props =
  | (BaseProps & { mode: 'new' })
  | (BaseProps & { mode: 'edit'; templateId: string })

const FRAMEWORKS = [
  'DPDP',
  'DPDP + RBI',
  'DPDP + RBI KYC',
  'DPDP + AA',
  'DPDP + RBI + AA',
  'DPDP + Healthcare',
  'ABDM',
  'Custom',
] as const

export function TemplateForm(props: Props) {
  const router = useRouter()
  const [templateCode, setTemplateCode] = useState(props.initialValues.templateCode)
  const [displayName, setDisplayName] = useState(props.initialValues.displayName)
  const [description, setDescription] = useState(props.initialValues.description)
  const [sector, setSector] = useState(props.initialValues.sector)
  const [purposes, setPurposes] = useState<PurposeRow[]>(props.initialValues.purposes)
  const [reason, setReason] = useState('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const reasonOk = reason.trim().length >= 10
  const saveOk =
    displayName.trim() &&
    description.trim() &&
    sector.trim() &&
    purposes.length > 0 &&
    purposes.every((p) => p.purpose_code.trim() && p.display_name.trim()) &&
    reasonOk

  function addPurpose() {
    setPurposes((prev) => [
      ...prev,
      {
        purpose_code: '',
        display_name: '',
        framework: 'DPDP',
        data_scope: [],
        default_expiry: '',
        auto_delete: false,
      },
    ])
  }

  function removePurpose(i: number) {
    setPurposes((prev) => prev.filter((_, idx) => idx !== i))
  }

  function patchPurpose(i: number, patch: Partial<PurposeRow>) {
    setPurposes((prev) =>
      prev.map((p, idx) => (idx === i ? { ...p, ...patch } : p)),
    )
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setPending(true)
    setError(null)

    if (props.mode === 'new') {
      const r = await createDraft({
        templateCode,
        displayName,
        description,
        sector,
        purposes,
        reason,
      })
      setPending(false)
      if (!r.ok) {
        setError(r.error)
        return
      }
      router.push(`/templates/${r.data!.templateId}`)
      router.refresh()
    } else {
      const r = await updateDraft({
        templateId: props.templateId,
        displayName,
        description,
        purposes,
        reason,
      })
      setPending(false)
      if (!r.ok) {
        setError(r.error)
        return
      }
      router.push(`/templates/${props.templateId}`)
      router.refresh()
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <section className="rounded-md border border-zinc-200 bg-white p-4 shadow-sm">
        <h2 className="mb-3 text-sm font-semibold">Metadata</h2>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <LabeledInput
            label="Template code (snake_case)"
            value={templateCode}
            onChange={setTemplateCode}
            disabled={props.mode === 'edit'}
            placeholder="bfsi_starter"
            required
            mono
          />
          <LabeledInput
            label="Display name"
            value={displayName}
            onChange={setDisplayName}
            placeholder="BFSI Starter"
            required
          />
          <LabeledInput
            label="Sector"
            value={sector}
            onChange={setSector}
            disabled={props.mode === 'edit'}
            placeholder="bfsi"
            required
            list="sector-suggestions"
          />
          <datalist id="sector-suggestions">
            {props.knownSectors.map((s) => (
              <option key={s} value={s} />
            ))}
          </datalist>
          <div className="sm:col-span-2">
            <label className="block text-xs font-medium uppercase tracking-wider text-zinc-500">
              Description
            </label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
              required
              className="mt-1 w-full rounded border border-zinc-300 px-3 py-2 text-sm"
              placeholder="What is this template for? Which regulators are addressed?"
            />
          </div>
        </div>
      </section>

      <section className="rounded-md border border-zinc-200 bg-white shadow-sm">
        <header className="flex items-center justify-between border-b border-zinc-200 p-4">
          <h2 className="text-sm font-semibold">
            Purpose definitions
            <span className="ml-2 text-xs font-normal text-zinc-500">
              {purposes.length} purpose{purposes.length === 1 ? '' : 's'}
            </span>
          </h2>
          <button
            type="button"
            onClick={addPurpose}
            className="rounded border border-zinc-300 bg-white px-3 py-1 text-xs text-zinc-700 hover:bg-zinc-50"
          >
            + Add purpose
          </button>
        </header>

        {purposes.length === 0 ? (
          <p className="p-6 text-center text-sm text-zinc-500">
            At least one purpose is required before the draft can be saved.
          </p>
        ) : (
          <ul className="divide-y divide-zinc-200">
            {purposes.map((p, i) => (
              <li key={i} className="p-4">
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <LabeledInput
                    label="Purpose code"
                    value={p.purpose_code}
                    onChange={(v) => patchPurpose(i, { purpose_code: v })}
                    placeholder="marketing"
                    mono
                    required
                  />
                  <LabeledInput
                    label="Display name"
                    value={p.display_name}
                    onChange={(v) => patchPurpose(i, { display_name: v })}
                    placeholder="Marketing"
                    required
                  />
                  <label className="block">
                    <span className="block text-xs font-medium uppercase tracking-wider text-zinc-500">
                      Framework
                    </span>
                    <select
                      value={p.framework}
                      onChange={(e) =>
                        patchPurpose(i, { framework: e.target.value })
                      }
                      className="mt-1 w-full rounded border border-zinc-300 px-3 py-2 text-sm"
                    >
                      {FRAMEWORKS.map((f) => (
                        <option key={f} value={f}>
                          {f}
                        </option>
                      ))}
                    </select>
                  </label>
                  <LabeledInput
                    label="Default expiry"
                    value={p.default_expiry}
                    onChange={(v) => patchPurpose(i, { default_expiry: v })}
                    placeholder="180 days / Never / 10 years (statutory)"
                  />
                  <div className="sm:col-span-2">
                    <DataScopeEditor
                      categories={p.data_scope}
                      onChange={(next) => patchPurpose(i, { data_scope: next })}
                    />
                  </div>
                  <label className="flex items-center gap-2 text-sm text-zinc-700">
                    <input
                      type="checkbox"
                      checked={p.auto_delete}
                      onChange={(e) =>
                        patchPurpose(i, { auto_delete: e.target.checked })
                      }
                    />
                    Auto-delete after expiry
                  </label>
                  <div className="flex items-end justify-end">
                    <button
                      type="button"
                      onClick={() => removePurpose(i)}
                      className="rounded border border-red-300 bg-white px-3 py-1.5 text-xs text-red-700 hover:bg-red-50"
                    >
                      Remove
                    </button>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}

        <footer className="border-t border-zinc-200 p-3 text-xs text-zinc-500">
          data_scope values are <strong>category declarations only</strong>,
          never actual personal data values (Rule 3).
        </footer>
      </section>

      <section className="rounded-md border border-zinc-200 bg-white p-4 shadow-sm">
        <label className="block text-xs font-medium uppercase tracking-wider text-zinc-500">
          Reason (≥ 10 chars · appears in audit log)
        </label>
        <textarea
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          rows={2}
          required
          placeholder={
            props.mode === 'new'
              ? 'Why create this draft?'
              : 'What changed in this edit?'
          }
          className="mt-1 w-full rounded border border-zinc-300 px-3 py-2 text-sm"
        />
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
          className="rounded border border-zinc-300 bg-white px-4 py-2 text-sm text-zinc-700 hover:bg-zinc-50"
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={pending || !saveOk}
          className="rounded bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800 disabled:opacity-50"
        >
          {pending ? 'Saving…' : props.mode === 'new' ? 'Create draft' : 'Save draft'}
        </button>
      </div>
    </form>
  )
}

function LabeledInput({
  label,
  value,
  onChange,
  disabled,
  placeholder,
  required,
  mono,
  list,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  disabled?: boolean
  placeholder?: string
  required?: boolean
  mono?: boolean
  list?: string
}) {
  return (
    <label className="block">
      <span className="block text-xs font-medium uppercase tracking-wider text-zinc-500">
        {label}
      </span>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        placeholder={placeholder}
        required={required}
        list={list}
        className={
          (mono
            ? 'mt-1 w-full rounded border border-zinc-300 px-3 py-2 font-mono text-sm'
            : 'mt-1 w-full rounded border border-zinc-300 px-3 py-2 text-sm') +
          ' disabled:bg-zinc-50 disabled:text-zinc-500'
        }
      />
    </label>
  )
}

function DataScopeEditor({
  categories,
  onChange,
}: {
  categories: string[]
  onChange: (next: string[]) => void
}) {
  const [input, setInput] = useState('')

  function add() {
    const trimmed = input.trim()
    if (!trimmed || categories.includes(trimmed)) return
    onChange([...categories, trimmed])
    setInput('')
  }

  return (
    <div>
      <span className="block text-xs font-medium uppercase tracking-wider text-zinc-500">
        Data scope (categories only — not actual values)
      </span>
      <div className="mt-1 flex flex-wrap gap-1">
        {categories.map((c) => (
          <span
            key={c}
            className="inline-flex items-center gap-1 rounded bg-zinc-100 px-2 py-0.5 font-mono text-xs text-zinc-700"
          >
            {c}
            <button
              type="button"
              onClick={() => onChange(categories.filter((x) => x !== c))}
              className="text-zinc-500 hover:text-red-700"
              aria-label={`Remove ${c}`}
            >
              ×
            </button>
          </span>
        ))}
      </div>
      <div className="mt-2 flex gap-2">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              add()
            }
          }}
          placeholder="email_address"
          className="flex-1 rounded border border-zinc-300 px-3 py-1.5 font-mono text-xs"
        />
        <button
          type="button"
          onClick={add}
          className="rounded border border-zinc-300 bg-white px-3 py-1.5 text-xs text-zinc-700 hover:bg-zinc-50"
        >
          Add
        </button>
      </div>
    </div>
  )
}
