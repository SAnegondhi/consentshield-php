'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  Field,
  FormFooter,
  ModalShell,
  ReasonField,
} from '@/components/common/modal-form'
import {
  changeAdminRoleAction,
  disableAdminAction,
  inviteAdminAction,
} from './actions'

// ADR-0045 Sprint 2.1 — Admin Users panel (client).

export interface AdminRow {
  id: string
  display_name: string
  admin_role: 'platform_operator' | 'support' | 'read_only'
  status: 'active' | 'invited' | 'disabled' | 'suspended'
  bootstrap_admin: boolean
  created_at: string
  disabled_at: string | null
  disabled_reason: string | null
}

type Modal =
  | { kind: 'invite' }
  | { kind: 'role'; row: AdminRow }
  | { kind: 'disable'; row: AdminRow }

const ROLE_LABEL: Record<AdminRow['admin_role'], string> = {
  platform_operator: 'Platform Operator',
  support: 'Support',
  read_only: 'Read-only',
}

export function AdminListPanel({
  rows,
  canWrite,
  currentAdminId,
}: {
  rows: AdminRow[]
  canWrite: boolean
  currentAdminId: string | null
}) {
  const [modal, setModal] = useState<Modal | null>(null)

  return (
    <section className="rounded-md border border-[color:var(--border)] bg-white shadow-sm">
      <header className="flex items-center justify-between border-b border-[color:var(--border)] px-4 py-2.5">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-semibold">All operators</h2>
          <Pill tone="gray">{rows.length} total</Pill>
        </div>
        <button
          type="button"
          onClick={() => setModal({ kind: 'invite' })}
          disabled={!canWrite}
          title={canWrite ? undefined : 'platform_operator role required'}
          className="rounded bg-teal px-3 py-1.5 text-xs font-medium text-white hover:bg-teal-dark disabled:cursor-not-allowed disabled:opacity-50"
        >
          + Invite admin
        </button>
      </header>

      {rows.length === 0 ? (
        <p className="p-8 text-center text-sm text-text-3">
          No admin users yet. This shouldn&rsquo;t happen — the bootstrap admin
          should exist. Check <code>scripts/bootstrap-admin.ts</code>.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-bg text-left text-xs uppercase tracking-wider text-text-3">
              <tr>
                <th className="px-4 py-2">Display name</th>
                <th className="px-4 py-2">Role</th>
                <th className="px-4 py-2">Status</th>
                <th className="px-4 py-2">Created</th>
                <th className="px-4 py-2">Disabled</th>
                <th className="px-4 py-2 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const isSelf = currentAdminId === r.id
                const canAct = canWrite && !isSelf && r.status !== 'disabled'
                return (
                  <tr key={r.id} className="border-t border-[color:var(--border)]">
                    <td className="px-4 py-2">
                      <div className="text-sm font-medium">{r.display_name}</div>
                      <div className="font-mono text-[11px] text-text-3">
                        {r.id.slice(0, 8)}
                        {r.bootstrap_admin ? (
                          <span className="ml-2 rounded bg-bg px-1.5 py-0.5 text-[10px] text-text-3">
                            bootstrap
                          </span>
                        ) : null}
                        {isSelf ? (
                          <span className="ml-2 rounded bg-teal/10 px-1.5 py-0.5 text-[10px] text-teal">
                            you
                          </span>
                        ) : null}
                      </div>
                    </td>
                    <td className="px-4 py-2 text-xs">
                      {ROLE_LABEL[r.admin_role]}
                    </td>
                    <td className="px-4 py-2">
                      <StatusPill status={r.status} />
                    </td>
                    <td className="px-4 py-2 font-mono text-[11px] text-text-3">
                      {new Date(r.created_at).toLocaleDateString()}
                    </td>
                    <td className="px-4 py-2 text-[11px] text-text-2">
                      {r.disabled_at
                        ? `${new Date(r.disabled_at).toLocaleDateString()} · ${r.disabled_reason ?? ''}`
                        : '—'}
                    </td>
                    <td className="px-4 py-2">
                      <div className="flex items-center justify-end gap-2">
                        <button
                          type="button"
                          onClick={() => setModal({ kind: 'role', row: r })}
                          disabled={!canAct}
                          title={
                            isSelf
                              ? 'Cannot change your own role'
                              : r.status === 'disabled'
                                ? 'Admin is disabled'
                                : canWrite
                                  ? 'Change role'
                                  : 'platform_operator required'
                          }
                          className="rounded border border-[color:var(--border-mid)] bg-white px-2.5 py-1 text-[11px] hover:bg-bg disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          Change role
                        </button>
                        <button
                          type="button"
                          onClick={() => setModal({ kind: 'disable', row: r })}
                          disabled={!canAct}
                          title={
                            isSelf
                              ? 'Cannot disable yourself'
                              : r.status === 'disabled'
                                ? 'Already disabled'
                                : canWrite
                                  ? 'Disable admin'
                                  : 'platform_operator required'
                          }
                          className="rounded border border-red-200 bg-white px-2.5 py-1 text-[11px] text-red-700 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          Disable
                        </button>
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {modal?.kind === 'invite' ? (
        <InviteModal onClose={() => setModal(null)} />
      ) : null}
      {modal?.kind === 'role' ? (
        <RoleModal row={modal.row} onClose={() => setModal(null)} />
      ) : null}
      {modal?.kind === 'disable' ? (
        <DisableModal row={modal.row} onClose={() => setModal(null)} />
      ) : null}
    </section>
  )
}

function Pill({
  tone,
  children,
}: {
  tone: 'green' | 'amber' | 'red' | 'gray'
  children: React.ReactNode
}) {
  const classes =
    tone === 'green'
      ? 'rounded-full bg-green-100 px-2 py-0.5 text-[11px] font-medium text-green-700'
      : tone === 'amber'
        ? 'rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-800'
        : tone === 'red'
          ? 'rounded-full bg-red-100 px-2 py-0.5 text-[11px] font-medium text-red-700'
          : 'rounded-full bg-bg px-2 py-0.5 text-[11px] font-medium text-text-3'
  return <span className={classes}>{children}</span>
}

function StatusPill({ status }: { status: AdminRow['status'] }) {
  return (
    <Pill
      tone={
        status === 'active'
          ? 'green'
          : status === 'invited'
            ? 'amber'
            : status === 'suspended'
              ? 'amber'
              : 'red'
      }
    >
      {status}
    </Pill>
  )
}

// ---------------- Modals ----------------

function InviteModal({ onClose }: { onClose: () => void }) {
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [adminRole, setAdminRole] = useState<AdminRow['admin_role']>('support')
  const [reason, setReason] = useState('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<
    | null
    | { adminId: string; emailDispatched: boolean; emailDispatchReason?: string }
  >(null)

  const ok =
    /^\S+@\S+\.\S+$/.test(email.trim()) &&
    displayName.trim().length > 0 &&
    reason.trim().length >= 10

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setPending(true)
    setError(null)
    const r = await inviteAdminAction({
      email,
      displayName,
      adminRole,
      reason,
    })
    setPending(false)
    if (!r.ok) {
      setError(r.error)
      return
    }
    setResult(r.data!)
    router.refresh()
  }

  if (result) {
    return (
      <ModalShell title="Invite sent" onClose={onClose}>
        <div className="space-y-3 p-4 text-sm">
          <div className="rounded border border-green-200 bg-green-50 p-3 text-green-900">
            <p className="font-medium">Admin row created · id {result.adminId.slice(0, 8)}</p>
            {result.emailDispatched ? (
              <p className="mt-1 text-xs">
                Invitation email dispatched via Resend. They should receive it
                within a minute.
              </p>
            ) : (
              <p className="mt-1 text-xs text-amber-800">
                Email NOT sent — {result.emailDispatchReason}. The admin row is
                in place; hand over credentials out-of-band (they sign in at{' '}
                <code>admin.consentshield.in/login</code> with the invited
                email).
              </p>
            )}
          </div>
          <FormFooter pending={false} onClose={onClose} submit="Close" disabled={false} />
        </div>
      </ModalShell>
    )
  }

  return (
    <ModalShell
      title="Invite admin"
      subtitle="Creates the auth user + admin_users row, sends an OTP-based sign-in email. The new admin lands on the operator dashboard after their first OTP round-trip."
      onClose={onClose}
    >
      <form onSubmit={onSubmit} className="space-y-4 p-4">
        <Field label="Email">
          <input
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            type="email"
            placeholder="operator@example.in"
            className="rounded border border-[color:var(--border-mid)] px-3 py-1.5 font-mono text-sm"
          />
        </Field>
        <Field label="Display name">
          <input
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            placeholder="Full name"
            className="rounded border border-[color:var(--border-mid)] px-3 py-1.5 text-sm"
          />
        </Field>
        <Field label="Role">
          <select
            value={adminRole}
            onChange={(e) => setAdminRole(e.target.value as AdminRow['admin_role'])}
            className="rounded border border-[color:var(--border-mid)] bg-white px-3 py-1.5 text-sm"
          >
            <option value="support">Support</option>
            <option value="platform_operator">Platform Operator</option>
            <option value="read_only">Read-only</option>
          </select>
        </Field>
        <ReasonField reason={reason} onChange={setReason} />
        {error ? <p className="text-sm text-red-700">{error}</p> : null}
        <FormFooter
          pending={pending}
          onClose={onClose}
          submit="Send invite"
          disabled={!ok}
        />
      </form>
    </ModalShell>
  )
}

function RoleModal({ row, onClose }: { row: AdminRow; onClose: () => void }) {
  const router = useRouter()
  const [newRole, setNewRole] = useState<AdminRow['admin_role']>(
    row.admin_role === 'platform_operator' ? 'support' : 'platform_operator',
  )
  const [reason, setReason] = useState('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [warn, setWarn] = useState<string | null>(null)

  const ok = reason.trim().length >= 10 && newRole !== row.admin_role

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setPending(true)
    setError(null)
    setWarn(null)
    const r = await changeAdminRoleAction({
      adminId: row.id,
      newRole,
      reason,
    })
    setPending(false)
    if (!r.ok) {
      setError(r.error)
      return
    }
    if (!r.data?.authSyncUpdated) {
      setWarn(`Postgres updated, but JWT sync failed: ${r.data?.syncError}`)
      router.refresh()
      return
    }
    onClose()
    router.refresh()
  }

  return (
    <ModalShell
      title={`Change role — ${row.display_name}`}
      subtitle={`Current role: ${ROLE_LABEL[row.admin_role]}. The affected admin must sign out + back in for the new role to take effect.`}
      onClose={onClose}
    >
      <form onSubmit={onSubmit} className="space-y-4 p-4">
        <Field label="New role">
          <select
            value={newRole}
            onChange={(e) => setNewRole(e.target.value as AdminRow['admin_role'])}
            className="rounded border border-[color:var(--border-mid)] bg-white px-3 py-1.5 text-sm"
          >
            <option value="support">Support</option>
            <option value="platform_operator">Platform Operator</option>
            <option value="read_only">Read-only</option>
          </select>
        </Field>
        <ReasonField reason={reason} onChange={setReason} />
        {error ? <p className="text-sm text-red-700">{error}</p> : null}
        {warn ? (
          <div className="rounded border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
            {warn}
          </div>
        ) : null}
        <FormFooter
          pending={pending}
          onClose={onClose}
          submit="Change role"
          disabled={!ok}
        />
      </form>
    </ModalShell>
  )
}

function DisableModal({ row, onClose }: { row: AdminRow; onClose: () => void }) {
  const router = useRouter()
  const [reason, setReason] = useState('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [warn, setWarn] = useState<string | null>(null)
  const ok = reason.trim().length >= 10

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setPending(true)
    setError(null)
    setWarn(null)
    const r = await disableAdminAction({ adminId: row.id, reason })
    setPending(false)
    if (!r.ok) {
      setError(r.error)
      return
    }
    if (!r.data?.authSyncUpdated) {
      setWarn(
        `Postgres updated (status=disabled), but JWT sync failed: ${r.data?.syncError}. The admin may still act from their current session until it refreshes.`,
      )
      router.refresh()
      return
    }
    onClose()
    router.refresh()
  }

  return (
    <ModalShell
      title={`Disable — ${row.display_name}`}
      subtitle="Sets status=disabled + flips is_admin=false on the JWT. Existing sessions stop working at the next token refresh."
      onClose={onClose}
    >
      <form onSubmit={onSubmit} className="space-y-4 p-4">
        <ReasonField reason={reason} onChange={setReason} />
        {error ? <p className="text-sm text-red-700">{error}</p> : null}
        {warn ? (
          <div className="rounded border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
            {warn}
          </div>
        ) : null}
        <FormFooter
          pending={pending}
          onClose={onClose}
          submit="Disable"
          submitDanger
          disabled={!ok}
        />
      </form>
    </ModalShell>
  )
}
