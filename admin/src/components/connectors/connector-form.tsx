'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { Field, ReasonField } from '@/components/common/modal-form'
import {
  createConnector,
  updateConnector,
} from '@/app/(operator)/connectors/actions'

// ADR-0031 Sprint 1.2 — Connector create/edit form.
//
// Mode "create": all fields editable. connector_code + version writeable.
// Mode "edit": connector_code + version disabled (they're part of the
// primary key and versioning invariant); display_name + purposes +
// credentials schema + webhook template + doc URL + retention-lock
// editable. RPC update_connector skips null fields.

export interface ConnectorFormInput {
  connectorCode: string
  displayName: string
  vendor: string
  version: string
  supportedPurposesCsv: string
  requiredCredentialsJson: string
  webhookEndpointTemplate: string
  documentationUrl: string
  retentionLockSupported: boolean
}

const DEFAULT_SCHEMA = JSON.stringify(
  {
    type: 'object',
    required: [],
    properties: {},
  },
  null,
  2,
)

export function ConnectorForm({
  mode,
  connectorId,
  initial,
}: {
  mode: 'create' | 'edit'
  connectorId?: string
  initial?: Partial<ConnectorFormInput>
}) {
  const router = useRouter()

  const [values, setValues] = useState<ConnectorFormInput>({
    connectorCode: initial?.connectorCode ?? '',
    displayName: initial?.displayName ?? '',
    vendor: initial?.vendor ?? '',
    version: initial?.version ?? '',
    supportedPurposesCsv: initial?.supportedPurposesCsv ?? '',
    requiredCredentialsJson: initial?.requiredCredentialsJson ?? DEFAULT_SCHEMA,
    webhookEndpointTemplate: initial?.webhookEndpointTemplate ?? '',
    documentationUrl: initial?.documentationUrl ?? '',
    retentionLockSupported: initial?.retentionLockSupported ?? false,
  })
  const [reason, setReason] = useState('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function set<K extends keyof ConnectorFormInput>(k: K, v: ConnectorFormInput[K]) {
    setValues((prev) => ({ ...prev, [k]: v }))
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setPending(true)
    setError(null)

    if (mode === 'create') {
      const r = await createConnector({ ...values, reason })
      setPending(false)
      if (!r.ok) {
        setError(r.error)
        return
      }
      router.push(`/connectors/${r.data!.connectorId}`)
    } else {
      const r = await updateConnector({
        connectorId: connectorId!,
        displayName: values.displayName,
        supportedPurposesCsv: values.supportedPurposesCsv,
        requiredCredentialsJson: values.requiredCredentialsJson,
        webhookEndpointTemplate: values.webhookEndpointTemplate,
        documentationUrl: values.documentationUrl,
        retentionLockSupported: values.retentionLockSupported,
        reason,
      })
      setPending(false)
      if (!r.ok) {
        setError(r.error)
        return
      }
      router.push(`/connectors/${connectorId}`)
    }
  }

  const reasonOk = reason.trim().length >= 10

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <section className="grid grid-cols-1 gap-3 rounded-md border border-[color:var(--border)] bg-white p-4 shadow-sm md:grid-cols-2">
        <Field label="Connector code">
          <input
            value={values.connectorCode}
            onChange={(e) => set('connectorCode', e.target.value)}
            disabled={mode === 'edit'}
            placeholder="mailchimp_v1"
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
        <Field label="Version">
          <input
            value={values.version}
            onChange={(e) => set('version', e.target.value)}
            disabled={mode === 'edit'}
            placeholder="v1"
            className="rounded border border-[color:var(--border-mid)] px-3 py-1.5 font-mono text-sm disabled:bg-bg disabled:text-text-3"
          />
        </Field>
      </section>

      <section className="rounded-md border border-[color:var(--border)] bg-white p-4 shadow-sm">
        <Field label="Webhook endpoint template">
          <input
            value={values.webhookEndpointTemplate}
            onChange={(e) => set('webhookEndpointTemplate', e.target.value)}
            placeholder="https://api.vendor.com/v1/{resource_id}"
            className="rounded border border-[color:var(--border-mid)] px-3 py-1.5 font-mono text-sm"
          />
        </Field>
      </section>

      <section className="rounded-md border border-[color:var(--border)] bg-white p-4 shadow-sm">
        <Field label="Required credentials (JSON schema)">
          <textarea
            value={values.requiredCredentialsJson}
            onChange={(e) => set('requiredCredentialsJson', e.target.value)}
            rows={8}
            className="rounded border border-[color:var(--border-mid)] px-3 py-2 font-mono text-xs"
          />
        </Field>
      </section>

      <section className="grid grid-cols-1 gap-3 rounded-md border border-[color:var(--border)] bg-white p-4 shadow-sm md:grid-cols-2">
        <Field label="Supported purpose codes (comma-separated)">
          <input
            value={values.supportedPurposesCsv}
            onChange={(e) => set('supportedPurposesCsv', e.target.value)}
            placeholder="marketing, analytics"
            className="rounded border border-[color:var(--border-mid)] px-3 py-1.5 text-sm"
          />
        </Field>
        <Field label="Documentation URL">
          <input
            value={values.documentationUrl}
            onChange={(e) => set('documentationUrl', e.target.value)}
            placeholder="https://vendor.com/api-docs"
            className="rounded border border-[color:var(--border-mid)] px-3 py-1.5 text-sm"
          />
        </Field>
        <label className="flex items-center gap-2 text-xs text-text-2 md:col-span-2">
          <input
            type="checkbox"
            checked={values.retentionLockSupported}
            onChange={(e) => set('retentionLockSupported', e.target.checked)}
          />
          <span>
            <strong>Retention lock supported</strong> — enable if the vendor&apos;s
            API supports legally-mandated retention windows (e.g., Razorpay 7yr
            for payment records).
          </span>
        </label>
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
          {pending ? 'Saving…' : mode === 'create' ? 'Create connector' : 'Save changes'}
        </button>
      </div>
    </form>
  )
}
