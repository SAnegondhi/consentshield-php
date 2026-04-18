'use client'

import { useState } from 'react'
import {
  changeMembershipRole,
  removeMembership,
  type ChangeRoleInput,
} from './actions'

// ADR-0047 Sprint 1.2 — per-row role dropdown + Remove button.
//
// Disabled states:
//   * Self-row: every control disabled (belt-and-suspenders against the
//     server-side self-action refusal).
//   * lastAccountOwner: Remove + demote disabled for the only remaining
//     account_owner — last-account_owner guard already refuses on the
//     server, but we disable here to avoid a pointless round-trip.
//
// Reason is collected via prompt() to keep the v1 UI narrow. A richer
// modal can follow when the design system grows a confirm primitive.

type AccountRole = 'account_owner' | 'account_viewer'
type OrgRole = 'org_admin' | 'admin' | 'viewer'

export interface MemberRowActionsProps {
  userId: string
  scope: 'account' | 'org'
  orgId: string | null
  currentRole: string
  isSelf: boolean
  canManage: boolean
  isLastAccountOwner: boolean
}

const ACCOUNT_ROLES: AccountRole[] = ['account_owner', 'account_viewer']
const ORG_ROLES: OrgRole[] = ['org_admin', 'admin', 'viewer']

export function MemberRowActions(props: MemberRowActionsProps) {
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [selectedRole, setSelectedRole] = useState<string>(props.currentRole)

  const disabledBase = pending || props.isSelf || !props.canManage
  const roleChoices = props.scope === 'account' ? ACCOUNT_ROLES : ORG_ROLES
  const demoteBlocked =
    props.isLastAccountOwner &&
    props.scope === 'account' &&
    selectedRole !== 'account_owner'
  const removeBlocked = props.isLastAccountOwner && props.scope === 'account'

  async function onApplyRole() {
    if (selectedRole === props.currentRole) return
    const reason = promptReason('Change role')
    if (reason === null) return
    setPending(true)
    setError(null)
    const r = await changeMembershipRole({
      userId: props.userId,
      scope: props.scope,
      orgId: props.orgId,
      newRole: selectedRole as ChangeRoleInput['newRole'],
      reason,
    })
    setPending(false)
    if (!r.ok) {
      setError(r.error)
      setSelectedRole(props.currentRole)
    }
  }

  async function onRemove() {
    const reason = promptReason(
      props.scope === 'account'
        ? 'Remove from account (cascades org memberships)'
        : 'Remove from organisation',
    )
    if (reason === null) return
    setPending(true)
    setError(null)
    const r = await removeMembership({
      userId: props.userId,
      scope: props.scope,
      orgId: props.orgId,
      reason,
    })
    setPending(false)
    if (!r.ok) setError(r.error)
  }

  if (props.isSelf) {
    return <span className="text-[11px] text-gray-400">—</span>
  }

  if (!props.canManage) {
    return <span className="text-[11px] text-gray-400">—</span>
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex items-center gap-2">
        <select
          value={selectedRole}
          onChange={(e) => setSelectedRole(e.target.value)}
          disabled={disabledBase}
          className="rounded border border-gray-300 bg-white px-2 py-1 text-xs disabled:opacity-50"
        >
          {roleChoices.map((r) => (
            <option key={r} value={r} disabled={r !== 'account_owner' && demoteBlocked && props.scope === 'account'}>
              {r}
            </option>
          ))}
        </select>
        <button
          type="button"
          onClick={onApplyRole}
          disabled={disabledBase || selectedRole === props.currentRole}
          className="rounded border border-gray-300 bg-white px-2 py-1 text-xs hover:bg-gray-100 disabled:opacity-50"
          title={
            selectedRole === props.currentRole
              ? 'No change'
              : 'Apply role change'
          }
        >
          {pending ? 'Saving…' : 'Apply'}
        </button>
        <button
          type="button"
          onClick={onRemove}
          disabled={disabledBase || removeBlocked}
          className="rounded border border-red-300 bg-white px-2 py-1 text-xs text-red-700 hover:bg-red-50 disabled:opacity-50"
          title={
            removeBlocked
              ? 'Cannot remove the last account_owner'
              : 'Remove member'
          }
        >
          Remove
        </button>
      </div>
      {error ? <span className="text-[10px] text-red-700 max-w-xs text-right">{error}</span> : null}
    </div>
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
