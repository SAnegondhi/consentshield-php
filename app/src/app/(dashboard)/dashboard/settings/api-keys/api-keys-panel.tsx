'use client'

import { useState, useTransition } from 'react'
import { createApiKey, rotateApiKey, revokeApiKey } from './actions'

export interface ApiKey {
  id: string
  key_prefix: string
  name: string
  scopes: string[]
  rate_tier: string
  last_used_at: string | null
  created_at: string
  is_active: boolean
  revoked_at: string | null
  previous_key_expires_at: string | null
}

interface Props {
  keys: ApiKey[]
  accountId: string
  orgId: string | null
  rateTier: string
}

const ALL_SCOPES = [
  'read:consent',
  'write:consent',
  'read:rights',
  'write:rights',
  'read:audit',
  'read:tracker',
  'read:deletion',
  'write:deletion',
  'read:artefacts',
  'write:artefacts',
  'read:score',
  'read:security',
  'read:probes',
]

function formatRelative(iso: string | null) {
  if (!iso) return '—'
  const diff = Date.now() - new Date(iso).getTime()
  const mins = Math.floor(diff / 60_000)
  if (mins < 2) return 'just now'
  if (mins < 60) return `${mins} min ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  const days = Math.floor(hrs / 24)
  if (days < 30) return `${days} days ago`
  return new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })
}

function formatDate(iso: string | null) {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })
}

function formatDateTime(iso: string | null) {
  if (!iso) return '—'
  return new Date(iso).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
}

function Pill({ children, variant }: { children: React.ReactNode; variant: 'green' | 'red' | 'gray' | 'navy' | 'amber' }) {
  const cls = {
    green: 'bg-green-100 text-green-800 border border-green-200',
    red: 'bg-red-100 text-red-700 border border-red-200',
    gray: 'bg-gray-100 text-gray-600 border border-gray-200',
    navy: 'bg-blue-50 text-blue-800 border border-blue-200',
    amber: 'bg-amber-50 text-amber-800 border border-amber-200',
  }[variant]
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium ${cls}`}>
      {children}
    </span>
  )
}

function RevealModal({
  plaintext,
  onDismiss,
}: {
  plaintext: string
  onDismiss: () => void
}) {
  const [saved, setSaved] = useState(false)
  const [copied, setCopied] = useState(false)

  async function handleCopy() {
    await navigator.clipboard.writeText(plaintext)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="w-full max-w-md rounded-lg bg-white p-6 shadow-xl">
        <h2 className="mb-1 text-base font-semibold">Your new API key</h2>
        <p className="mb-4 text-sm text-gray-500">
          Copy this key now. <strong>It will not be shown again.</strong> If you lose it, revoke and create a new one.
        </p>

        <div className="mb-4">
          <div className="mb-1 text-xs font-medium text-gray-500">Key</div>
          <div className="rounded border border-gray-200 bg-gray-50 px-3 py-2 font-mono text-xs break-all select-all">
            {plaintext}
          </div>
          <button
            onClick={handleCopy}
            className="mt-2 w-full rounded border border-gray-300 bg-white py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50"
          >
            {copied ? 'Copied!' : 'Copy to clipboard'}
          </button>
        </div>

        <div className="mb-4 rounded border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          ⚠ This key is associated with your organisation. Treat it like a password — do not commit it to source control.
        </div>

        <label className="mb-4 flex cursor-pointer items-start gap-2">
          <input
            type="checkbox"
            className="mt-0.5"
            checked={saved}
            onChange={(e) => setSaved(e.target.checked)}
          />
          <span className="text-sm text-gray-700">
            I have securely saved this key and understand it cannot be retrieved again.
          </span>
        </label>

        <button
          disabled={!saved}
          onClick={onDismiss}
          className="w-full rounded bg-gray-900 py-2 text-sm font-medium text-white disabled:opacity-40"
        >
          Dismiss
        </button>
      </div>
    </div>
  )
}

function CreateModal({
  accountId,
  orgId,
  rateTier,
  onClose,
  onCreated,
}: {
  accountId: string
  orgId: string | null
  rateTier: string
  onClose: () => void
  onCreated: (plaintext: string) => void
}) {
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [selectedScopes, setSelectedScopes] = useState<Set<string>>(new Set(['read:consent']))

  function toggleScope(scope: string) {
    setSelectedScopes((prev) => {
      const next = new Set(prev)
      if (next.has(scope)) next.delete(scope)
      else next.add(scope)
      return next
    })
  }

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError(null)
    const fd = new FormData(e.currentTarget)
    fd.delete('scopes')
    selectedScopes.forEach((s) => fd.append('scopes', s))
    fd.set('account_id', accountId)
    if (orgId) fd.set('org_id', orgId)
    fd.set('rate_tier', rateTier)

    startTransition(async () => {
      const result = await createApiKey(fd)
      if (result.error) {
        setError(result.error)
      } else if (result.data) {
        onCreated(result.data.plaintext)
      }
    })
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="w-full max-w-md rounded-lg bg-white p-6 shadow-xl">
        <h2 className="mb-1 text-base font-semibold">Create API key</h2>
        <p className="mb-4 text-sm text-gray-500">
          The plaintext will be shown exactly once. Store it securely before closing.
        </p>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="mb-1 block text-xs font-medium">
              Key name <span className="text-red-500">*</span>
            </label>
            <input
              name="name"
              required
              placeholder="e.g. Production backend"
              className="w-full rounded border border-gray-300 px-3 py-1.5 text-sm outline-none focus:border-gray-500"
            />
            <p className="mt-1 text-[11px] text-gray-400">For your reference only — not sent with requests.</p>
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium">
              Scopes <span className="text-red-500">*</span>
            </label>
            <p className="mb-2 text-[11px] text-gray-500">Select the minimum scopes your integration needs.</p>
            <div className="grid grid-cols-2 gap-1.5">
              {ALL_SCOPES.map((scope) => (
                <label
                  key={scope}
                  className={`flex cursor-pointer items-center gap-1.5 rounded border px-2 py-1 text-xs ${
                    selectedScopes.has(scope)
                      ? 'border-blue-300 bg-blue-50 text-blue-800'
                      : 'border-gray-200 text-gray-600 hover:border-gray-300'
                  }`}
                >
                  <input
                    type="checkbox"
                    className="hidden"
                    checked={selectedScopes.has(scope)}
                    onChange={() => toggleScope(scope)}
                  />
                  {scope}
                </label>
              ))}
            </div>
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium">Rate tier</label>
            <div className="flex items-center gap-2">
              <Pill variant="gray">{rateTier}</Pill>
              <span className="text-[11px] text-gray-400">Inherited from your plan · upgrade to increase limits</span>
            </div>
          </div>

          {error && <p className="text-xs text-red-600">{error}</p>}

          <div className="flex justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={onClose}
              className="rounded border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={pending || selectedScopes.size === 0}
              className="rounded bg-gray-900 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50"
            >
              {pending ? 'Creating…' : 'Create key'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

function RotateModal({
  apiKey,
  onClose,
  onRotated,
}: {
  apiKey: ApiKey
  onClose: () => void
  onRotated: (plaintext: string) => void
}) {
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  function handleRotate() {
    setError(null)
    startTransition(async () => {
      const result = await rotateApiKey(apiKey.id)
      if (result.error) {
        setError(result.error)
      } else if (result.data) {
        onRotated(result.data.plaintext)
      }
    })
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="w-full max-w-md rounded-lg bg-white p-6 shadow-xl">
        <h2 className="mb-1 text-base font-semibold">Rotate key</h2>
        <p className="mb-4 text-sm text-gray-500">
          A new key will be issued. The current key stays valid for{' '}
          <strong>24 hours</strong> so you can update your integration without downtime.
        </p>
        <div className="mb-5 rounded border border-gray-100 bg-gray-50 px-3 py-2">
          <div className="mb-0.5 text-xs font-medium">{apiKey.name}</div>
          <span className="font-mono text-xs text-gray-500">{apiKey.key_prefix}</span>
        </div>
        {error && <p className="mb-3 text-xs text-red-600">{error}</p>}
        <div className="flex justify-end gap-2">
          <button
            onClick={onClose}
            className="rounded border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50"
          >
            Cancel
          </button>
          <button
            onClick={handleRotate}
            disabled={pending}
            className="rounded bg-gray-900 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50"
          >
            {pending ? 'Rotating…' : 'Rotate and show new key'}
          </button>
        </div>
      </div>
    </div>
  )
}

function RevokeModal({
  apiKey,
  onClose,
}: {
  apiKey: ApiKey
  onClose: () => void
}) {
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  function handleRevoke() {
    setError(null)
    startTransition(async () => {
      const result = await revokeApiKey(apiKey.id)
      if (result.error) {
        setError(result.error)
      } else {
        onClose()
      }
    })
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="w-full max-w-sm rounded-lg bg-white p-6 shadow-xl">
        <h2 className="mb-1 text-base font-semibold text-red-700">Revoke key</h2>
        <p className="mb-4 text-sm text-gray-600">
          <strong>{apiKey.name}</strong> (<span className="font-mono text-xs">{apiKey.key_prefix}</span>) will stop
          working immediately. This cannot be undone.
        </p>
        {error && <p className="mb-3 text-xs text-red-600">{error}</p>}
        <div className="flex justify-end gap-2">
          <button
            onClick={onClose}
            className="rounded border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50"
          >
            Cancel
          </button>
          <button
            onClick={handleRevoke}
            disabled={pending}
            className="rounded bg-red-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-red-700 disabled:opacity-50"
          >
            {pending ? 'Revoking…' : 'Revoke key'}
          </button>
        </div>
      </div>
    </div>
  )
}

export function ApiKeysPanel({ keys, accountId, orgId, rateTier }: Props) {
  const [showCreate, setShowCreate] = useState(false)
  const [revealPlaintext, setRevealPlaintext] = useState<string | null>(null)
  const [rotatingKey, setRotatingKey] = useState<ApiKey | null>(null)
  const [revokingKey, setRevokingKey] = useState<ApiKey | null>(null)

  const activeKeys = keys.filter((k) => k.is_active)
  const revokedKeys = keys.filter((k) => !k.is_active)

  return (
    <div>
      {/* Header */}
      <div className="mb-4 flex items-start justify-between">
        <div>
          <div className="text-sm font-semibold">API keys</div>
          <div className="mt-0.5 text-xs text-gray-500">
            Authenticate{' '}
            <code className="rounded bg-gray-100 px-1 py-0.5 font-mono text-[11px]">Bearer cs_live_*</code> requests
            to the{' '}
            <code className="rounded bg-gray-100 px-1 py-0.5 font-mono text-[11px]">/api/v1/*</code> compliance API.
            Plaintext is shown once — store it immediately.
          </div>
        </div>
        <button
          onClick={() => setShowCreate(true)}
          className="ml-4 shrink-0 rounded bg-gray-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-gray-700"
        >
          + New key
        </button>
      </div>

      {/* Empty state */}
      {keys.length === 0 && (
        <div className="rounded-lg border border-dashed border-gray-300 px-6 py-10 text-center">
          <div className="mb-2 text-3xl opacity-30">🔑</div>
          <div className="mb-1 text-sm font-medium">No API keys yet</div>
          <div className="mb-4 text-xs text-gray-500">
            Create a key to start calling the ConsentShield compliance API from your backend.
          </div>
          <button
            onClick={() => setShowCreate(true)}
            className="rounded bg-gray-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-gray-700"
          >
            Create your first key
          </button>
        </div>
      )}

      {/* Key table */}
      {keys.length > 0 && (
        <div className="overflow-x-auto rounded-lg border border-gray-200">
          <table className="min-w-full divide-y divide-gray-200 text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-4 py-2.5 text-left text-xs font-medium text-gray-500">Name / prefix</th>
                <th className="px-4 py-2.5 text-left text-xs font-medium text-gray-500">Scopes</th>
                <th className="px-4 py-2.5 text-left text-xs font-medium text-gray-500">Rate tier</th>
                <th className="px-4 py-2.5 text-left text-xs font-medium text-gray-500">Last used</th>
                <th className="px-4 py-2.5 text-left text-xs font-medium text-gray-500">Created</th>
                <th className="px-4 py-2.5 text-left text-xs font-medium text-gray-500">Status</th>
                <th className="px-4 py-2.5 text-right text-xs font-medium text-gray-500">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 bg-white">
              {/* Active keys */}
              {activeKeys.map((k) => {
                const dualWindow =
                  k.previous_key_expires_at && new Date(k.previous_key_expires_at) > new Date()
                return (
                  <tr key={k.id}>
                    <td className="px-4 py-3">
                      <div className="text-xs font-medium">{k.name}</div>
                      <span className="font-mono text-[11px] text-gray-500">{k.key_prefix}</span>
                      {dualWindow && (
                        <div className="mt-1.5 flex items-center gap-1 rounded border border-amber-200 bg-amber-50 px-2 py-1 text-[11px] text-amber-700">
                          <svg width="12" height="12" viewBox="0 0 16 16" fill="none">
                            <circle cx="8" cy="8" r="7" stroke="currentColor" strokeWidth="1.5" />
                            <path d="M8 5v3.5l2 2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                          </svg>
                          Previous key valid until{' '}
                          <strong className="mx-0.5">{formatDateTime(k.previous_key_expires_at)}</strong>
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap gap-1">
                        {k.scopes.map((s) => (
                          <Pill key={s} variant="navy">{s}</Pill>
                        ))}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <Pill variant="gray">{k.rate_tier}</Pill>
                    </td>
                    <td className="px-4 py-3 text-xs text-gray-500">{formatRelative(k.last_used_at)}</td>
                    <td className="px-4 py-3 text-xs text-gray-500">{formatDate(k.created_at)}</td>
                    <td className="px-4 py-3">
                      <Pill variant="green">
                        <span className="inline-block h-1.5 w-1.5 rounded-full bg-green-500" />
                        Active
                      </Pill>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex justify-end gap-1.5">
                        <button
                          onClick={() => setRotatingKey(k)}
                          className="rounded border border-gray-300 px-2.5 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50"
                        >
                          Rotate
                        </button>
                        <button
                          onClick={() => setRevokingKey(k)}
                          className="rounded border border-red-200 px-2.5 py-1 text-xs font-medium text-red-600 hover:bg-red-50"
                        >
                          Revoke
                        </button>
                      </div>
                    </td>
                  </tr>
                )
              })}

              {/* Revoked keys */}
              {revokedKeys.map((k) => (
                <tr key={k.id} className="opacity-50">
                  <td className="px-4 py-3">
                    <div className="text-xs font-medium text-gray-400 line-through">{k.name}</div>
                    <span className="font-mono text-[11px] text-gray-400">{k.key_prefix}</span>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap gap-1">
                      {k.scopes.map((s) => (
                        <Pill key={s} variant="gray">{s}</Pill>
                      ))}
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <Pill variant="gray">{k.rate_tier}</Pill>
                  </td>
                  <td className="px-4 py-3 text-xs text-gray-400">—</td>
                  <td className="px-4 py-3 text-xs text-gray-400">{formatDate(k.created_at)}</td>
                  <td className="px-4 py-3">
                    <Pill variant="red">
                      <span className="inline-block h-1.5 w-1.5 rounded-full bg-red-500" />
                      Revoked
                    </Pill>
                  </td>
                  <td className="px-4 py-3 text-right text-[11px] text-gray-400">
                    {k.revoked_at ? `Revoked ${formatDate(k.revoked_at)}` : ''}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Modals */}
      {showCreate && (
        <CreateModal
          accountId={accountId}
          orgId={orgId}
          rateTier={rateTier}
          onClose={() => setShowCreate(false)}
          onCreated={(plaintext) => {
            setShowCreate(false)
            setRevealPlaintext(plaintext)
          }}
        />
      )}

      {revealPlaintext && (
        <RevealModal
          plaintext={revealPlaintext}
          onDismiss={() => setRevealPlaintext(null)}
        />
      )}

      {rotatingKey && (
        <RotateModal
          apiKey={rotatingKey}
          onClose={() => setRotatingKey(null)}
          onRotated={(plaintext) => {
            setRotatingKey(null)
            setRevealPlaintext(plaintext)
          }}
        />
      )}

      {revokingKey && (
        <RevokeModal
          apiKey={revokingKey}
          onClose={() => setRevokingKey(null)}
        />
      )}
    </div>
  )
}
