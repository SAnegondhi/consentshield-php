import type { SupabaseClient } from '@supabase/supabase-js'
import { getAdminServiceClient } from '@/lib/supabase/service'
import { sendAdminInviteEmail } from '@/lib/admin/invite-email'

// ADR-0045 Sprint 1.2/2.1 — shared orchestration for the three admin
// lifecycle actions. Route Handlers and Server Actions both delegate
// here so the ordering + rollback invariants live in exactly one place.

export type AdminRole = 'platform_operator' | 'support' | 'read_only'

export interface InviteOutcome {
  adminId: string
  userId: string
  emailDispatched: boolean
  emailDispatchReason?: string
}

export interface RoleChangeOutcome {
  adminId: string
  newRole: AdminRole
  authSyncUpdated: boolean
  syncError?: string
}

export interface DisableOutcome {
  adminId: string
  authSyncUpdated: boolean
  syncError?: string
}

// Thin error shape; helpers throw with enough context to return either
// a 403 (RPC refused) or a 500 (Auth API blew up) from the caller.
export class LifecycleError extends Error {
  readonly code: 'rpc_refused' | 'auth_api_failed' | 'create_user_failed'
  constructor(code: LifecycleError['code'], message: string) {
    super(message)
    this.code = code
    this.name = 'LifecycleError'
  }
}

export async function inviteAdmin(params: {
  authedClient: SupabaseClient
  email: string
  displayName: string
  adminRole: AdminRole
  reason: string
  inviterDisplayName: string
}): Promise<InviteOutcome> {
  const service = getAdminServiceClient()

  const { data: created, error: createErr } = await service.auth.admin.createUser({
    email: params.email,
    email_confirm: true,
    app_metadata: { is_admin: true, admin_role: params.adminRole },
  })
  if (createErr) {
    throw new LifecycleError(
      'create_user_failed',
      `auth.admin.createUser: ${createErr.message}`,
    )
  }
  const newUserId = created.user.id

  const { data: adminId, error: rpcErr } = await params.authedClient
    .schema('admin')
    .rpc('admin_invite_create', {
      p_user_id: newUserId,
      p_display_name: params.displayName,
      p_admin_role: params.adminRole,
      p_reason: params.reason,
    })
  if (rpcErr) {
    // Roll back to avoid orphaned elevated auth user.
    await service.auth.admin.deleteUser(newUserId)
    throw new LifecycleError('rpc_refused', `admin_invite_create: ${rpcErr.message}`)
  }

  const emailResult = await sendAdminInviteEmail({
    to: params.email,
    displayName: params.displayName,
    adminRole: params.adminRole,
    invitedByDisplayName: params.inviterDisplayName,
  })

  return {
    adminId: adminId as string,
    userId: newUserId,
    emailDispatched: emailResult.dispatched,
    emailDispatchReason:
      emailResult.dispatched === false ? emailResult.reason : undefined,
  }
}

export async function changeAdminRole(params: {
  authedClient: SupabaseClient
  adminId: string
  newRole: AdminRole
  reason: string
}): Promise<RoleChangeOutcome> {
  const service = getAdminServiceClient()

  const { error: rpcErr } = await params.authedClient
    .schema('admin')
    .rpc('admin_change_role', {
      p_admin_id: params.adminId,
      p_new_role: params.newRole,
      p_reason: params.reason,
    })
  if (rpcErr) {
    throw new LifecycleError('rpc_refused', `admin_change_role: ${rpcErr.message}`)
  }

  const { data: existing } = await service.auth.admin.getUserById(params.adminId)
  const existingMeta = (existing.user?.app_metadata ?? {}) as Record<string, unknown>
  const { error: syncErr } = await service.auth.admin.updateUserById(params.adminId, {
    app_metadata: { ...existingMeta, admin_role: params.newRole },
  })

  return {
    adminId: params.adminId,
    newRole: params.newRole,
    authSyncUpdated: !syncErr,
    syncError: syncErr?.message,
  }
}

export async function disableAdmin(params: {
  authedClient: SupabaseClient
  adminId: string
  reason: string
}): Promise<DisableOutcome> {
  const service = getAdminServiceClient()

  const { error: rpcErr } = await params.authedClient
    .schema('admin')
    .rpc('admin_disable', {
      p_admin_id: params.adminId,
      p_reason: params.reason,
    })
  if (rpcErr) {
    throw new LifecycleError('rpc_refused', `admin_disable: ${rpcErr.message}`)
  }

  const { data: existing } = await service.auth.admin.getUserById(params.adminId)
  const existingMeta = (existing.user?.app_metadata ?? {}) as Record<string, unknown>
  const { error: syncErr } = await service.auth.admin.updateUserById(params.adminId, {
    app_metadata: { ...existingMeta, is_admin: false },
  })

  return {
    adminId: params.adminId,
    authSyncUpdated: !syncErr,
    syncError: syncErr?.message,
  }
}
