'use server'

import { revalidatePath } from 'next/cache'
import { createServerClient } from '@/lib/supabase/server'

// ADR-0044 Phase 2.4 — customer-side invite + revoke Server Actions.
// All gates live in the RPCs; this wrapper only sanitises input and
// surfaces errors to the UI.

export interface InviteMemberInput {
  email: string
  role: 'account_owner' | 'account_viewer' | 'org_admin' | 'admin' | 'viewer'
  accountId: string | null
  orgId: string | null
  expiresInDays: number
}

export type InviteResult =
  | { ok: true; invitationId: string; token: string; acceptUrl: string; expiresAt: string }
  | { ok: false; error: string }

function appBaseUrl(): string {
  return (
    process.env.NEXT_PUBLIC_APP_URL ??
    process.env.NEXT_PUBLIC_CUSTOMER_APP_URL ??
    'https://app.consentshield.in'
  )
}

export async function inviteMember(input: InviteMemberInput): Promise<InviteResult> {
  const email = input.email.trim().toLowerCase()
  if (email.length < 3 || !email.includes('@')) {
    return { ok: false, error: 'A valid email is required' }
  }
  if (
    input.expiresInDays < 1 ||
    input.expiresInDays > 90 ||
    !Number.isInteger(input.expiresInDays)
  ) {
    return { ok: false, error: 'Expiry must be an integer between 1 and 90 days' }
  }

  // Role-scope sanity. The RPC re-enforces these but we fail fast.
  if (input.role === 'account_owner' && input.accountId === null) {
    return { ok: false, error: 'account_owner invites to a new account are operator-only' }
  }
  if (input.role === 'account_viewer' && input.accountId === null) {
    return { ok: false, error: 'account_id required for account_viewer invites' }
  }
  if (
    (input.role === 'org_admin' || input.role === 'admin' || input.role === 'viewer') &&
    (input.orgId === null || input.accountId === null)
  ) {
    return { ok: false, error: 'account_id + org_id required for org-scoped invites' }
  }

  const supabase = await createServerClient()

  const { data, error } = await supabase.rpc('create_invitation', {
    p_email: email,
    p_role: input.role,
    p_account_id: input.accountId,
    p_org_id: input.orgId,
    p_plan_code: null,
    p_trial_days: null,
    p_default_org_name: null,
    p_expires_in_days: input.expiresInDays,
  })

  if (error) return { ok: false, error: error.message }

  const row = Array.isArray(data) ? data[0] : data
  if (!row?.token || !row?.id) {
    return { ok: false, error: 'RPC returned no invitation — verify your role' }
  }

  revalidatePath('/dashboard/settings/members')

  const expiresAt = new Date(
    Date.now() + input.expiresInDays * 24 * 60 * 60 * 1000,
  ).toISOString()

  return {
    ok: true,
    invitationId: row.id,
    token: row.token,
    acceptUrl: `${appBaseUrl()}/signup?invite=${row.token}`,
    expiresAt,
  }
}

export async function revokeInvitation(
  invitationId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const supabase = await createServerClient()
  const { error } = await supabase.rpc('revoke_invitation', {
    p_id: invitationId,
  })
  if (error) return { ok: false, error: error.message }
  revalidatePath('/dashboard/settings/members')
  return { ok: true }
}
