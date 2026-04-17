'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import {
  createPurpose,
  updatePurpose,
  togglePurposeActive,
  createMapping,
  deleteMapping,
} from './actions'

interface PurposeDef {
  id: string
  purpose_code: string
  display_name: string
  description: string
  framework: string
  data_scope: string[]
  default_expiry_days: number
  auto_delete_on_expiry: boolean
  is_active: boolean
  created_at: string
}

interface Mapping {
  id: string
  purpose_definition_id: string
  connector_id: string
  data_categories: string[]
}

interface Connector {
  id: string
  display_name: string
  connector_type: string
  status: string
}

interface Props {
  initialTab: 'catalogue' | 'connectors'
  isAdmin: boolean
  purposes: PurposeDef[]
  mappings: Mapping[]
  connectors: Connector[]
}

export function PurposesView(props: Props) {
  const [tab, setTab] = useState<'catalogue' | 'connectors'>(props.initialTab)
  const activeCount = props.purposes.filter((p) => p.is_active).length
  const archivedCount = props.purposes.length - activeCount

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-4 border-b border-gray-200">
        <TabButton active={tab === 'catalogue'} onClick={() => setTab('catalogue')}>
          Catalogue
        </TabButton>
        <TabButton active={tab === 'connectors'} onClick={() => setTab('connectors')}>
          Connector mappings
        </TabButton>
        <div className="ml-auto flex items-center gap-2 pb-2 text-xs text-gray-500">
          <span className="rounded bg-green-50 px-2 py-0.5 text-green-700">
            {activeCount} active
          </span>
          {archivedCount > 0 ? (
            <span className="rounded bg-gray-100 px-2 py-0.5 text-gray-600">
              {archivedCount} archived
            </span>
          ) : null}
        </div>
      </div>

      {tab === 'catalogue' ? (
        <CatalogueView isAdmin={props.isAdmin} purposes={props.purposes} />
      ) : (
        <ConnectorsView
          isAdmin={props.isAdmin}
          purposes={props.purposes.filter((p) => p.is_active)}
          mappings={props.mappings}
          connectors={props.connectors}
        />
      )}
    </div>
  )
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      onClick={onClick}
      className={`-mb-px border-b-2 px-3 py-2 text-sm ${
        active
          ? 'border-black font-medium text-black'
          : 'border-transparent text-gray-600 hover:text-black'
      }`}
    >
      {children}
    </button>
  )
}

// ═══════════════════════════════════════════════════════════
// Catalogue tab
// ═══════════════════════════════════════════════════════════

function CatalogueView({ isAdmin, purposes }: { isAdmin: boolean; purposes: PurposeDef[] }) {
  const [showCreate, setShowCreate] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)

  return (
    <div className="space-y-4">
      {isAdmin ? (
        <div className="flex items-center justify-between">
          <p className="text-sm text-gray-600">
            Soft-delete only — archive a purpose to remove it from new banners. Existing artefacts
            keep referencing archived purposes.
          </p>
          <button
            onClick={() => setShowCreate((v) => !v)}
            className="rounded bg-black px-3 py-1.5 text-sm font-medium text-white hover:bg-gray-800"
          >
            {showCreate ? 'Cancel' : '+ New purpose'}
          </button>
        </div>
      ) : (
        <p className="text-sm text-gray-600">
          Read-only view — admins and owners can create or edit purpose definitions.
        </p>
      )}

      {showCreate && isAdmin ? (
        <CreatePurposeForm onDone={() => setShowCreate(false)} />
      ) : null}

      <div className="overflow-x-auto rounded border border-gray-200">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-left text-xs uppercase text-gray-500">
            <tr>
              <th className="px-3 py-2">Code</th>
              <th className="px-3 py-2">Display name</th>
              <th className="px-3 py-2">Framework</th>
              <th className="px-3 py-2">Data scope</th>
              <th className="px-3 py-2">Expiry</th>
              <th className="px-3 py-2">Auto-delete</th>
              <th className="px-3 py-2">Status</th>
              <th className="px-3 py-2"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {purposes.length === 0 ? (
              <tr>
                <td colSpan={8} className="px-3 py-6 text-center text-gray-500">
                  No purpose definitions yet.
                  {isAdmin ? ' Start by creating one above.' : ''}
                </td>
              </tr>
            ) : (
              purposes.map((p) =>
                editingId === p.id ? (
                  <tr key={p.id} className="bg-amber-50">
                    <td colSpan={8} className="p-3">
                      <EditPurposeForm
                        purpose={p}
                        onDone={() => setEditingId(null)}
                      />
                    </td>
                  </tr>
                ) : (
                  <PurposeRow
                    key={p.id}
                    p={p}
                    isAdmin={isAdmin}
                    onEdit={() => setEditingId(p.id)}
                  />
                ),
              )
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function PurposeRow({
  p,
  isAdmin,
  onEdit,
}: {
  p: PurposeDef
  isAdmin: boolean
  onEdit: () => void
}) {
  const [isPending, startTransition] = useTransition()
  const router = useRouter()

  function handleToggle() {
    startTransition(async () => {
      const res = await togglePurposeActive(p.id, !p.is_active)
      if (res.error) alert(res.error)
      else router.refresh()
    })
  }

  return (
    <tr className={p.is_active ? '' : 'bg-gray-50 text-gray-500'}>
      <td className="px-3 py-2 font-mono text-xs">{p.purpose_code}</td>
      <td className="px-3 py-2">{p.display_name}</td>
      <td className="px-3 py-2 uppercase text-xs">{p.framework}</td>
      <td className="px-3 py-2">
        <div className="flex flex-wrap gap-1">
          {p.data_scope.length === 0 ? (
            <span className="rounded bg-red-50 px-1.5 py-0.5 text-xs text-red-700">
              empty (coverage=0)
            </span>
          ) : (
            p.data_scope.map((d) => (
              <span
                key={d}
                className="rounded bg-gray-100 px-1.5 py-0.5 font-mono text-xs text-gray-700"
              >
                {d}
              </span>
            ))
          )}
        </div>
      </td>
      <td className="px-3 py-2 tabular-nums text-xs">
        {p.default_expiry_days === 0 ? '∞' : `${p.default_expiry_days}d`}
      </td>
      <td className="px-3 py-2 text-xs">{p.auto_delete_on_expiry ? 'yes' : 'no'}</td>
      <td className="px-3 py-2">
        {p.is_active ? (
          <span className="rounded bg-green-50 px-2 py-0.5 text-xs text-green-700">Active</span>
        ) : (
          <span className="rounded bg-gray-100 px-2 py-0.5 text-xs text-gray-600">Archived</span>
        )}
      </td>
      <td className="px-3 py-2 text-right">
        {isAdmin ? (
          <div className="flex justify-end gap-2">
            <button
              onClick={onEdit}
              className="text-xs text-gray-600 hover:text-black"
            >
              Edit
            </button>
            <button
              onClick={handleToggle}
              disabled={isPending}
              className="text-xs text-gray-600 hover:text-black disabled:opacity-50"
            >
              {p.is_active ? 'Archive' : 'Unarchive'}
            </button>
          </div>
        ) : null}
      </td>
    </tr>
  )
}

function CreatePurposeForm({ onDone }: { onDone: () => void }) {
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()
  const router = useRouter()

  function handleSubmit(formData: FormData) {
    startTransition(async () => {
      const res = await createPurpose(formData)
      if (res.error) setError(res.error)
      else {
        setError(null)
        onDone()
        router.refresh()
      }
    })
  }

  return (
    <form
      action={handleSubmit}
      className="grid grid-cols-1 gap-3 rounded border border-gray-200 bg-gray-50 p-4 md:grid-cols-2"
    >
      <label className="text-sm">
        <span className="text-xs text-gray-600">purpose_code (snake_case)</span>
        <input
          name="purpose_code"
          required
          pattern="[a-z][a-z0-9_]*"
          className="mt-1 block w-full rounded border border-gray-300 px-2 py-1 font-mono text-sm"
          placeholder="marketing_email"
        />
      </label>
      <label className="text-sm">
        <span className="text-xs text-gray-600">Display name</span>
        <input
          name="display_name"
          required
          className="mt-1 block w-full rounded border border-gray-300 px-2 py-1 text-sm"
        />
      </label>
      <label className="text-sm md:col-span-2">
        <span className="text-xs text-gray-600">Description (shown in preference centre)</span>
        <textarea
          name="description"
          required
          rows={2}
          className="mt-1 block w-full rounded border border-gray-300 px-2 py-1 text-sm"
        />
      </label>
      <label className="text-sm">
        <span className="text-xs text-gray-600">
          data_scope (comma-separated categories — never values; Rule 3)
        </span>
        <input
          name="data_scope"
          placeholder="email_address, name"
          className="mt-1 block w-full rounded border border-gray-300 px-2 py-1 font-mono text-sm"
        />
      </label>
      <label className="text-sm">
        <span className="text-xs text-gray-600">Framework</span>
        <select
          name="framework"
          defaultValue="dpdp"
          className="mt-1 block w-full rounded border border-gray-300 px-2 py-1 text-sm"
        >
          <option value="dpdp">DPDP</option>
          <option value="abdm">ABDM</option>
          <option value="gdpr">GDPR</option>
        </select>
      </label>
      <label className="text-sm">
        <span className="text-xs text-gray-600">Default expiry (days; 0 = forever)</span>
        <input
          name="default_expiry_days"
          type="number"
          min={0}
          defaultValue={180}
          className="mt-1 block w-full rounded border border-gray-300 px-2 py-1 text-sm"
        />
      </label>
      <label className="flex items-center gap-2 text-sm">
        <input name="auto_delete_on_expiry" type="checkbox" />
        <span>Auto-delete on expiry (stages R2 export; see ADR-0023)</span>
      </label>
      {error ? (
        <p className="md:col-span-2 text-sm text-red-700">{error}</p>
      ) : null}
      <div className="md:col-span-2 flex justify-end gap-2">
        <button
          type="button"
          onClick={onDone}
          className="rounded border border-gray-300 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-100"
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={isPending}
          className="rounded bg-black px-3 py-1.5 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-50"
        >
          Create purpose
        </button>
      </div>
    </form>
  )
}

function EditPurposeForm({
  purpose,
  onDone,
}: {
  purpose: PurposeDef
  onDone: () => void
}) {
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()
  const router = useRouter()

  function handleSubmit(formData: FormData) {
    startTransition(async () => {
      const res = await updatePurpose(purpose.id, formData)
      if (res.error) setError(res.error)
      else {
        setError(null)
        onDone()
        router.refresh()
      }
    })
  }

  return (
    <form action={handleSubmit} className="grid grid-cols-1 gap-3 md:grid-cols-2">
      <div className="md:col-span-2 text-xs text-gray-600">
        Editing{' '}
        <code className="font-mono">{purpose.purpose_code}</code> —{' '}
        <span className="uppercase">{purpose.framework}</span> (code and framework are
        immutable).
      </div>
      <label className="text-sm">
        <span className="text-xs text-gray-600">Display name</span>
        <input
          name="display_name"
          required
          defaultValue={purpose.display_name}
          className="mt-1 block w-full rounded border border-gray-300 px-2 py-1 text-sm"
        />
      </label>
      <label className="text-sm">
        <span className="text-xs text-gray-600">Default expiry (days)</span>
        <input
          name="default_expiry_days"
          type="number"
          min={0}
          defaultValue={purpose.default_expiry_days}
          className="mt-1 block w-full rounded border border-gray-300 px-2 py-1 text-sm"
        />
      </label>
      <label className="text-sm md:col-span-2">
        <span className="text-xs text-gray-600">Description</span>
        <textarea
          name="description"
          required
          rows={2}
          defaultValue={purpose.description}
          className="mt-1 block w-full rounded border border-gray-300 px-2 py-1 text-sm"
        />
      </label>
      <label className="text-sm md:col-span-2">
        <span className="text-xs text-gray-600">data_scope</span>
        <input
          name="data_scope"
          defaultValue={purpose.data_scope.join(', ')}
          className="mt-1 block w-full rounded border border-gray-300 px-2 py-1 font-mono text-sm"
        />
      </label>
      <label className="flex items-center gap-2 text-sm">
        <input
          name="auto_delete_on_expiry"
          type="checkbox"
          defaultChecked={purpose.auto_delete_on_expiry}
        />
        <span>Auto-delete on expiry</span>
      </label>
      {error ? (
        <p className="md:col-span-2 text-sm text-red-700">{error}</p>
      ) : null}
      <div className="md:col-span-2 flex justify-end gap-2">
        <button
          type="button"
          onClick={onDone}
          className="rounded border border-gray-300 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-100"
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={isPending}
          className="rounded bg-black px-3 py-1.5 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-50"
        >
          Save
        </button>
      </div>
    </form>
  )
}

// ═══════════════════════════════════════════════════════════
// Connector mappings tab (ADR-0024 Sprint 1.2)
// ═══════════════════════════════════════════════════════════

function ConnectorsView({
  isAdmin,
  purposes,
  mappings,
  connectors,
}: {
  isAdmin: boolean
  purposes: PurposeDef[]
  mappings: Mapping[]
  connectors: Connector[]
}) {
  const [showCreate, setShowCreate] = useState(false)
  const purposeById = new Map(purposes.map((p) => [p.id, p]))
  const connectorById = new Map(connectors.map((c) => [c.id, c]))

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-gray-600 max-w-3xl">
          When an artefact is revoked, deletion fans out to the connectors mapped here. Each
          mapping declares which subset of the purpose&apos;s <code className="font-mono">data_scope</code>{' '}
          that connector handles.
        </p>
        {isAdmin ? (
          <button
            onClick={() => setShowCreate((v) => !v)}
            className="rounded bg-black px-3 py-1.5 text-sm font-medium text-white hover:bg-gray-800"
          >
            {showCreate ? 'Cancel' : '+ New mapping'}
          </button>
        ) : null}
      </div>

      {showCreate && isAdmin ? (
        <CreateMappingForm
          purposes={purposes}
          connectors={connectors.filter((c) => c.status === 'active')}
          onDone={() => setShowCreate(false)}
        />
      ) : null}

      <div className="overflow-x-auto rounded border border-gray-200">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-left text-xs uppercase text-gray-500">
            <tr>
              <th className="px-3 py-2">Purpose</th>
              <th className="px-3 py-2">Connector</th>
              <th className="px-3 py-2">Handles scope subset</th>
              <th className="px-3 py-2">Connector status</th>
              <th className="px-3 py-2"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {mappings.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-3 py-6 text-center text-gray-500">
                  No connector mappings.{' '}
                  {isAdmin
                    ? 'Map a purpose to a connector to enable automatic deletion on revocation.'
                    : ''}
                </td>
              </tr>
            ) : (
              mappings.map((m) => {
                const purpose = purposeById.get(m.purpose_definition_id)
                const connector = connectorById.get(m.connector_id)
                return (
                  <MappingRow
                    key={m.id}
                    mapping={m}
                    purposeLabel={
                      purpose?.purpose_code ?? `(missing purpose ${m.purpose_definition_id})`
                    }
                    connectorLabel={
                      connector?.display_name ?? `(missing connector ${m.connector_id})`
                    }
                    connectorStatus={connector?.status ?? 'unknown'}
                    isAdmin={isAdmin}
                  />
                )
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function MappingRow({
  mapping,
  purposeLabel,
  connectorLabel,
  connectorStatus,
  isAdmin,
}: {
  mapping: Mapping
  purposeLabel: string
  connectorLabel: string
  connectorStatus: string
  isAdmin: boolean
}) {
  const [isPending, startTransition] = useTransition()
  const router = useRouter()

  function handleDelete() {
    if (!confirm(`Remove mapping ${purposeLabel} → ${connectorLabel}?`)) return
    startTransition(async () => {
      const res = await deleteMapping(mapping.id)
      if (res.error) alert(res.error)
      else router.refresh()
    })
  }

  return (
    <tr>
      <td className="px-3 py-2 font-mono text-xs">{purposeLabel}</td>
      <td className="px-3 py-2">{connectorLabel}</td>
      <td className="px-3 py-2">
        <div className="flex flex-wrap gap-1">
          {mapping.data_categories.map((c) => (
            <span
              key={c}
              className="rounded bg-gray-100 px-1.5 py-0.5 font-mono text-xs text-gray-700"
            >
              {c}
            </span>
          ))}
        </div>
      </td>
      <td className="px-3 py-2 text-xs">
        <span
          className={`rounded px-2 py-0.5 ${
            connectorStatus === 'active'
              ? 'bg-green-50 text-green-700'
              : 'bg-amber-50 text-amber-700'
          }`}
        >
          {connectorStatus}
        </span>
      </td>
      <td className="px-3 py-2 text-right">
        {isAdmin ? (
          <button
            onClick={handleDelete}
            disabled={isPending}
            className="text-xs text-red-700 hover:text-red-900 disabled:opacity-50"
          >
            Remove
          </button>
        ) : null}
      </td>
    </tr>
  )
}

function CreateMappingForm({
  purposes,
  connectors,
  onDone,
}: {
  purposes: PurposeDef[]
  connectors: Connector[]
  onDone: () => void
}) {
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()
  const [purposeId, setPurposeId] = useState<string>(purposes[0]?.id ?? '')
  const router = useRouter()

  const selectedPurpose = purposes.find((p) => p.id === purposeId)

  function handleSubmit(formData: FormData) {
    startTransition(async () => {
      const res = await createMapping(formData)
      if (res.error) setError(res.error)
      else {
        setError(null)
        onDone()
        router.refresh()
      }
    })
  }

  if (purposes.length === 0) {
    return (
      <div className="rounded border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
        No active purposes. Create a purpose in the Catalogue tab first.
      </div>
    )
  }
  if (connectors.length === 0) {
    return (
      <div className="rounded border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
        No active connectors. Configure one under Integrations.
      </div>
    )
  }

  return (
    <form
      action={handleSubmit}
      className="grid grid-cols-1 gap-3 rounded border border-gray-200 bg-gray-50 p-4 md:grid-cols-2"
    >
      <label className="text-sm">
        <span className="text-xs text-gray-600">Purpose</span>
        <select
          name="purpose_definition_id"
          value={purposeId}
          onChange={(e) => setPurposeId(e.target.value)}
          className="mt-1 block w-full rounded border border-gray-300 px-2 py-1 text-sm"
        >
          {purposes.map((p) => (
            <option key={p.id} value={p.id}>
              {p.purpose_code} · {p.display_name}
            </option>
          ))}
        </select>
      </label>
      <label className="text-sm">
        <span className="text-xs text-gray-600">Connector</span>
        <select
          name="connector_id"
          className="mt-1 block w-full rounded border border-gray-300 px-2 py-1 text-sm"
        >
          {connectors.map((c) => (
            <option key={c.id} value={c.id}>
              {c.display_name} ({c.connector_type})
            </option>
          ))}
        </select>
      </label>
      <label className="text-sm md:col-span-2">
        <span className="text-xs text-gray-600">
          data_categories (subset of purpose&apos;s data_scope
          {selectedPurpose ? `: ${selectedPurpose.data_scope.join(', ') || '(none)'}` : ''})
        </span>
        <input
          name="data_categories"
          placeholder="email_address, name"
          required
          className="mt-1 block w-full rounded border border-gray-300 px-2 py-1 font-mono text-sm"
        />
      </label>
      {error ? (
        <p className="md:col-span-2 text-sm text-red-700">{error}</p>
      ) : null}
      <div className="md:col-span-2 flex justify-end gap-2">
        <button
          type="button"
          onClick={onDone}
          className="rounded border border-gray-300 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-100"
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={isPending}
          className="rounded bg-black px-3 py-1.5 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-50"
        >
          Create mapping
        </button>
      </div>
    </form>
  )
}
