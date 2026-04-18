import { redirect } from 'next/navigation'
import { createServerClient } from '@/lib/supabase/server'
import { InviteForm, type OrgOption } from './invite-form'
import { RevokeButton } from './revoke-button'

// ADR-0044 Phase 2.4 — /dashboard/settings/members.
//
// Shows current members + pending invitations, plus an invite form
// whose role picker is scoped to the caller's permissions:
//   account_owner → all 5 roles
//   org_admin     → admin / viewer (own org only)
//   otherwise     → page returns a "no access" card
//
// All role gates live in the RPCs (list_members, list_pending_
// invitations, create_invitation, revoke_invitation); this page is
// presentational.

export const dynamic = 'force-dynamic'

type Role = 'account_owner' | 'account_viewer' | 'org_admin' | 'admin' | 'viewer'

interface MemberRow {
  scope: 'account' | 'org'
  account_id: string
  org_id: string | null
  user_id: string
  email: string
  role: string
  status: string
  joined_at: string
}

interface PendingRow {
  id: string
  invited_email: string
  role: string
  account_id: string | null
  org_id: string | null
  plan_code: string | null
  invited_by: string | null
  created_at: string
  expires_at: string
}

export default async function MembersPage() {
  const supabase = await createServerClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  // Resolve current org/account from the user's primary org_membership.
  const { data: membership } = await supabase
    .from('org_memberships')
    .select('org_id')
    .eq('user_id', user.id)
    .limit(1)
    .maybeSingle()

  if (!membership) {
    return (
      <main className="p-8">
        <h1 className="text-2xl font-bold">Team &amp; invites</h1>
        <p className="mt-2 text-sm text-gray-600">
          No organisation found for your account. Complete signup first.
        </p>
      </main>
    )
  }

  const { data: org } = await supabase
    .from('organisations')
    .select('id, name, account_id')
    .eq('id', membership.org_id)
    .single()

  if (!org) {
    return (
      <main className="p-8">
        <p className="text-sm text-gray-600">Organisation not found.</p>
      </main>
    )
  }

  // Effective role resolution — account_owner beats org_admin beats
  // direct org_memberships role.
  const [accountRoleRes, orgEffectiveRes, orgsRes, membersRes, pendingRes] =
    await Promise.all([
      supabase.rpc('current_account_role'),
      supabase.rpc('effective_org_role', { p_org_id: org.id }),
      supabase
        .from('organisations')
        .select('id, name')
        .eq('account_id', org.account_id)
        .order('name'),
      supabase.rpc('list_members'),
      supabase.rpc('list_pending_invitations'),
    ])

  const accountRole = (accountRoleRes.data as string | null) ?? null
  const orgEffective = (orgEffectiveRes.data as string | null) ?? null
  const orgs: OrgOption[] = (orgsRes.data ?? []) as OrgOption[]
  const members: MemberRow[] = (membersRes.data ?? []) as MemberRow[]
  const pending: PendingRow[] = (pendingRes.data ?? []) as PendingRow[]

  const allowedRoles = allowedRolesFor(accountRole, orgEffective)

  if (allowedRoles.length === 0) {
    return (
      <main className="p-8 space-y-4">
        <h1 className="text-2xl font-bold">Team &amp; invites</h1>
        <p className="text-sm text-gray-600">
          You don&apos;t have permission to manage members. Ask an account owner or
          org admin to invite someone on your behalf.
        </p>
      </main>
    )
  }

  const orgNameById = new Map(orgs.map((o) => [o.id, o.name]))

  return (
    <main className="p-8 space-y-8 max-w-5xl">
      <header>
        <h1 className="text-2xl font-bold">Team &amp; invites</h1>
        <p className="mt-1 text-sm text-gray-600">
          You are signed in as <strong>{user.email}</strong> —{' '}
          <span className="rounded-full bg-gray-900 px-2 py-0.5 text-[11px] font-medium text-white">
            {accountRole ?? orgEffective ?? 'member'}
          </span>
        </p>
      </header>

      <section>
        <h2 className="text-sm font-semibold text-gray-800">Current members</h2>
        {members.length === 0 ? (
          <p className="mt-2 text-xs text-gray-500">No members visible.</p>
        ) : (
          <table className="mt-2 w-full text-sm border border-gray-200 rounded">
            <thead className="bg-gray-50 text-left text-xs">
              <tr>
                <th className="px-3 py-2 font-medium">Member</th>
                <th className="px-3 py-2 font-medium">Role</th>
                <th className="px-3 py-2 font-medium">Scope</th>
                <th className="px-3 py-2 font-medium">Joined</th>
              </tr>
            </thead>
            <tbody>
              {members.map((m, i) => (
                <tr key={`${m.scope}-${m.user_id}-${m.org_id ?? 'acct'}-${i}`} className="border-t border-gray-100">
                  <td className="px-3 py-2">
                    <div className="text-sm">{m.email}</div>
                    {m.user_id === user.id ? (
                      <div className="text-[11px] text-gray-500">you</div>
                    ) : null}
                  </td>
                  <td className="px-3 py-2">
                    <RolePill role={m.role} />
                  </td>
                  <td className="px-3 py-2 text-xs text-gray-700">
                    {m.scope === 'account'
                      ? 'Account'
                      : (orgNameById.get(m.org_id ?? '') ?? m.org_id)}
                  </td>
                  <td className="px-3 py-2 text-xs text-gray-700">
                    {new Date(m.joined_at).toLocaleDateString('en-IN', {
                      day: 'numeric',
                      month: 'short',
                      year: 'numeric',
                    })}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section>
        <h2 className="text-sm font-semibold text-gray-800">Pending invitations</h2>
        {pending.length === 0 ? (
          <p className="mt-2 text-xs text-gray-500">No pending invites.</p>
        ) : (
          <table className="mt-2 w-full text-sm border border-gray-200 rounded">
            <thead className="bg-gray-50 text-left text-xs">
              <tr>
                <th className="px-3 py-2 font-medium">Invitee</th>
                <th className="px-3 py-2 font-medium">Role</th>
                <th className="px-3 py-2 font-medium">Scope</th>
                <th className="px-3 py-2 font-medium">Expires</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {pending.map((p) => {
                // eslint-disable-next-line react-hooks/purity -- Server Component: Date.now() is intentional.
                const expiresMs = new Date(p.expires_at).getTime() - Date.now()
                const daysLeft = Math.ceil(expiresMs / 86_400_000)
                const isSoon = daysLeft <= 3 && daysLeft > 0
                const isExpired = daysLeft <= 0
                return (
                  <tr key={p.id} className="border-t border-gray-100">
                    <td className="px-3 py-2 text-sm">{p.invited_email}</td>
                    <td className="px-3 py-2">
                      <RolePill role={p.role} />
                    </td>
                    <td className="px-3 py-2 text-xs text-gray-700">
                      {p.org_id
                        ? (orgNameById.get(p.org_id) ?? p.org_id)
                        : 'Account'}
                    </td>
                    <td
                      className={
                        'px-3 py-2 text-xs ' +
                        (isExpired
                          ? 'text-red-700'
                          : isSoon
                            ? 'text-amber-700'
                            : 'text-gray-700')
                      }
                    >
                      {isExpired ? 'expired' : `in ${daysLeft} day${daysLeft === 1 ? '' : 's'}`}
                    </td>
                    <td className="px-3 py-2 text-right">
                      <RevokeButton invitationId={p.id} />
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </section>

      <section>
        <InviteForm
          accountId={org.account_id}
          orgs={orgs}
          allowedRoles={allowedRoles}
          defaultOrgId={org.id}
        />
      </section>
    </main>
  )
}

function allowedRolesFor(
  accountRole: string | null,
  orgEffective: string | null,
): Role[] {
  if (accountRole === 'account_owner') {
    return ['account_owner', 'account_viewer', 'org_admin', 'admin', 'viewer']
  }
  if (orgEffective === 'org_admin') {
    return ['admin', 'viewer']
  }
  return []
}

function RolePill({ role }: { role: string }) {
  const isAccountTier = role === 'account_owner' || role === 'account_viewer'
  const cls = isAccountTier
    ? 'bg-gray-900 text-white'
    : role === 'org_admin'
      ? 'bg-gray-700 text-white'
      : 'bg-gray-200 text-gray-800'
  return (
    <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${cls}`}>
      {role}
    </span>
  )
}
