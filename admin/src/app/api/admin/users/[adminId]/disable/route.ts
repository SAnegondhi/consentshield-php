import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { getAdminServiceClient, ServiceClientEnvError } from '@/lib/supabase/service'

// ADR-0045 Sprint 1.2 — POST /api/admin/users/[adminId]/disable
//
// Two-phase: (1) admin.admin_disable under the caller's JWT so the
// require_admin + self-disable + last-PO guards fire; (2) flip
// raw_app_meta_data.is_admin=false via service-role so the JWT check
// at proxy.ts Rule 21 fails on the next request refresh.

export const runtime = 'nodejs'

interface DisableBody {
  reason?: string
}

export async function POST(
  request: Request,
  context: { params: Promise<{ adminId: string }> },
) {
  const { adminId } = await context.params

  let body: DisableBody
  try {
    body = (await request.json()) as DisableBody
  } catch {
    return NextResponse.json({ error: 'invalid JSON body' }, { status: 400 })
  }

  const reason = body.reason?.trim()
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

  // Phase 1.
  const { error: rpcErr } = await authed.schema('admin').rpc('admin_disable', {
    p_admin_id: adminId,
    p_reason: reason,
  })
  if (rpcErr) {
    return NextResponse.json(
      { error: `admin_disable: ${rpcErr.message}` },
      { status: 403 },
    )
  }

  // Phase 2: flip is_admin off. Keep admin_role for audit/forensics
  // purposes — the is_admin check at proxy.ts Rule 21 is what gates
  // all admin surfaces, so flipping that is sufficient.
  const { data: existing } = await service.auth.admin.getUserById(adminId)
  const existingMeta = (existing.user?.app_metadata ?? {}) as Record<string, unknown>
  const { error: syncErr } = await service.auth.admin.updateUserById(adminId, {
    app_metadata: { ...existingMeta, is_admin: false },
  })
  if (syncErr) {
    return NextResponse.json(
      {
        adminId,
        dbUpdated: true,
        authSyncUpdated: false,
        syncError: syncErr.message,
        note:
          'Postgres state shows status=disabled. The JWT is_admin claim was NOT cleared; the disabled admin can still act from an existing session until it refreshes. Retry this endpoint to reconcile.',
      },
      { status: 207 },
    )
  }

  return NextResponse.json(
    {
      adminId,
      dbUpdated: true,
      authSyncUpdated: true,
      note:
        "Admin disabled. Any existing session carrying is_admin=true is_now stale; the next token refresh will reveal is_admin=false and proxy.ts Rule 21 will block further operator requests.",
    },
    { status: 200 },
  )
}
