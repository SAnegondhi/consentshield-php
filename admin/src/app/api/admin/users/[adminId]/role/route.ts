import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { getAdminServiceClient, ServiceClientEnvError } from '@/lib/supabase/service'

// ADR-0045 Sprint 1.2 — PATCH /api/admin/users/[adminId]/role
//
// Two-phase: (1) call admin.admin_change_role under the caller's JWT
// so require_admin + self-change + last-PO guards fire; (2) sync
// raw_app_meta_data.admin_role via service-role. If the Auth side
// fails, surface the drift explicitly so the operator can reconcile.

export const runtime = 'nodejs'

interface RoleBody {
  newRole?: 'platform_operator' | 'support' | 'read_only'
  reason?: string
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ adminId: string }> },
) {
  const { adminId } = await context.params

  let body: RoleBody
  try {
    body = (await request.json()) as RoleBody
  } catch {
    return NextResponse.json({ error: 'invalid JSON body' }, { status: 400 })
  }

  const newRole = body.newRole
  const reason = body.reason?.trim()
  if (newRole !== 'platform_operator' && newRole !== 'support' && newRole !== 'read_only') {
    return NextResponse.json(
      { error: 'newRole must be platform_operator, support, or read_only' },
      { status: 400 },
    )
  }
  if (!reason || reason.length < 10) {
    return NextResponse.json(
      { error: 'reason must be at least 10 characters' },
      { status: 400 },
    )
  }

  let service
  try {
    service = getAdminServiceClient()
  } catch (e) {
    if (e instanceof ServiceClientEnvError) {
      return NextResponse.json({ error: e.message }, { status: 500 })
    }
    throw e
  }

  const authed = await createServerClient()

  // Phase 1: postgres state.
  const { error: rpcErr } = await authed.schema('admin').rpc('admin_change_role', {
    p_admin_id: adminId,
    p_new_role: newRole,
    p_reason: reason,
  })
  if (rpcErr) {
    return NextResponse.json(
      { error: `admin_change_role: ${rpcErr.message}` },
      { status: 403 },
    )
  }

  // Phase 2: JWT side. Merge the new admin_role into existing app_metadata
  // so we don't stomp is_admin or other platform claims.
  const { data: existing } = await service.auth.admin.getUserById(adminId)
  const existingMeta = (existing.user?.app_metadata ?? {}) as Record<string, unknown>
  const { error: syncErr } = await service.auth.admin.updateUserById(adminId, {
    app_metadata: { ...existingMeta, admin_role: newRole },
  })
  if (syncErr) {
    return NextResponse.json(
      {
        adminId,
        newRole,
        dbUpdated: true,
        authSyncUpdated: false,
        syncError: syncErr.message,
        note:
          'Postgres state is authoritative and has been updated. Auth JWT metadata is out of sync; the affected admin will retain the old admin_role claim until this is retried. Manual remediation: hit the same endpoint again, or call auth.admin.updateUserById directly.',
      },
      { status: 207 },
    )
  }

  return NextResponse.json(
    {
      adminId,
      newRole,
      dbUpdated: true,
      authSyncUpdated: true,
      note:
        "The affected admin's existing JWT still carries the old admin_role claim. They must sign out and back in (or wait for their current session to refresh) for the new role to take effect.",
    },
    { status: 200 },
  )
}
