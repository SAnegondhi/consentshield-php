'use client'

import { useState } from 'react'
import { changeMembershipRole, removeMembership } from './actions'
import { canOperate, type AdminRole } from '@/lib/admin/role-tiers'

// ADR-0047 Sprint 1.2 — admin mirror of the customer members panel.
// Lists org_memberships for the current org and exposes per-row role
// change + remove controls backed by the public.* RPCs (admin-JWT
// bypass fires inside the RPC, so the operator doesn't need to be a
// member of the account).
//
// Platform_operator only: support / read_only admins can view the list
// but the controls are disabled. The RPC is still the authoritative
// gate (platform_operator check lives there via is_admin JWT).

export interface MemberRow {
  userId: string
  email: string
  role: string
}

export interface AdminMembersSectionProps {
  orgId: string
  members: MemberRow[]
  adminRole: AdminRole
}

const ORG_ROLES = ['org_admin', 'admin', 'viewer'] as const

export function AdminMembersSection(props: AdminMembersSectionProps) {
  const canManage = canOperate(props.adminRole)

  return (
    <section className="rounded-md border border-[color:var(--border)] bg-white shadow-sm">
      <header className="flex items-center justify-between border-b border-[color:var(--border)] px-4 py-2">
        <h3 className="text-sm font-semibold">Org members</h3>
        <span className="text-xs text-text-3">{props.members.length} members</span>
      </header>
      <div className="p-4">
        {props.members.length === 0 ? (
          <p className="text-xs text-text-3">No org members.</p>
        ) : (
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-text-3">
              <tr>
                <th className="py-2 font-medium">Member</th>
                <th className="py-2 font-medium">Role</th>
                <th className="py-2 text-right font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {props.members.map((m) => (
                <MemberRowUi
                  key={m.userId}
                  orgId={props.orgId}
                  row={m}
                  canManage={canManage}
                />
              ))}
            </tbody>
          </table>
        )}
        {!canManage ? (
          <p className="mt-3 text-[11px] text-text-3">
            Role-change + remove are restricted to platform_operator.
          </p>
        ) : null}
      </div>
    </section>
  )
}

function MemberRowUi({
  orgId,
  row,
  canManage,
}: {
  orgId: string
  row: MemberRow
  canManage: boolean
}) {
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [selectedRole, setSelectedRole] = useState<string>(row.role)

  async function onApply() {
    if (selectedRole === row.role) return
    const reason = promptReason('Change role')
    if (reason === null) return
    setPending(true)
    setError(null)
    const r = await changeMembershipRole(
      orgId,
      row.userId,
      'org',
      orgId,
      selectedRole,
      reason,
    )
    setPending(false)
    if (!r.ok) {
      setError(r.error)
      setSelectedRole(row.role)
    }
  }

  async function onRemove() {
    const reason = promptReason('Remove from organisation')
    if (reason === null) return
    setPending(true)
    setError(null)
    const r = await removeMembership(orgId, row.userId, 'org', orgId, reason)
    setPending(false)
    if (!r.ok) setError(r.error)
  }

  return (
    <tr className="border-t border-[color:var(--border)]">
      <td className="py-2">
        <div className="text-sm">{row.email}</div>
        <code className="text-[10px] text-text-3">{row.userId.slice(0, 8)}</code>
      </td>
      <td className="py-2">
        {canManage ? (
          <select
            value={selectedRole}
            onChange={(e) => setSelectedRole(e.target.value)}
            disabled={pending}
            className="rounded border border-[color:var(--border)] bg-white px-2 py-1 text-xs disabled:opacity-50"
          >
            {ORG_ROLES.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
        ) : (
          <span className="rounded-full bg-bg px-2 py-0.5 text-[11px]">{row.role}</span>
        )}
      </td>
      <td className="py-2 text-right">
        {canManage ? (
          <div className="flex flex-col items-end gap-1">
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={onApply}
                disabled={pending || selectedRole === row.role}
                className="rounded border border-[color:var(--border)] bg-white px-2 py-1 text-xs hover:bg-bg disabled:opacity-50"
              >
                {pending ? 'Saving…' : 'Apply'}
              </button>
              <button
                type="button"
                onClick={onRemove}
                disabled={pending}
                className="rounded border border-red-300 bg-white px-2 py-1 text-xs text-red-700 hover:bg-red-50 disabled:opacity-50"
              >
                Remove
              </button>
            </div>
            {error ? (
              <span className="max-w-xs text-right text-[10px] text-red-700">
                {error}
              </span>
            ) : null}
          </div>
        ) : (
          <span className="text-[11px] text-text-3">—</span>
        )}
      </td>
    </tr>
  )
}

function promptReason(actionLabel: string): string | null {
  const raw = window.prompt(
    `${actionLabel}\n\nReason (required, min 10 characters — recorded in the audit log):`,
  )
  if (raw === null) return null
  const trimmed = raw.trim()
  if (trimmed.length < 10) {
    window.alert('Reason must be at least 10 characters.')
    return null
  }
  return trimmed
}
