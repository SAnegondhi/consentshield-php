import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { getAdminServiceClient, ServiceClientEnvError } from '@/lib/supabase/service'
import { sendAdminInviteEmail } from '@/lib/admin/invite-email'

// ADR-0045 Sprint 1.2 — POST /api/admin/users/invite
//
// Orchestrates:
//   1. service-role auth.admin.createUser with email_confirm=true and
//      app_metadata.is_admin=true + admin_role seeded.
//   2. admin.admin_invite_create RPC (platform_operator gate + audit).
//   3. Resend invite email.
//
// The RPC is called via the caller's JWT (authenticated server client),
// NOT the service-role client. That's the defence-in-depth layer —
// anyone who bypasses the proxy.ts Rule 21 gate still hits require_admin
// inside the RPC. If the RPC fails we roll back the auth.admin.createUser
// to avoid orphaned auth rows.

export const runtime = 'nodejs'

interface InviteBody {
  email?: string
  displayName?: string
  adminRole?: 'platform_operator' | 'support' | 'read_only'
  reason?: string
}

export async function POST(request: Request) {
  let body: InviteBody
  try {
    body = (await request.json()) as InviteBody
  } catch {
    return NextResponse.json({ error: 'invalid JSON body' }, { status: 400 })
  }

  const email = body.email?.trim().toLowerCase()
  const displayName = body.displayName?.trim()
  const adminRole = body.adminRole
  const reason = body.reason?.trim()

  if (!email || !/^\S+@\S+\.\S+$/.test(email)) {
    return NextResponse.json({ error: 'valid email required' }, { status: 400 })
  }
  if (!displayName || displayName.length < 1) {
    return NextResponse.json({ error: 'displayName required' }, { status: 400 })
  }
  if (adminRole !== 'platform_operator' && adminRole !== 'support' && adminRole !== 'read_only') {
    return NextResponse.json(
      { error: 'adminRole must be platform_operator, support, or read_only' },
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

  // Caller info — we want the inviter's display name for the email + a
  // defensive self-check (the RPC also refuses invalid callers).
  const authed = await createServerClient()
  const { data: callerRes } = await authed.auth.getUser()
  const callerId = callerRes.user?.id
  if (!callerId) {
    return NextResponse.json({ error: 'not signed in' }, { status: 401 })
  }
  const { data: inviterRow } = await service
    .schema('admin')
    .from('admin_users')
    .select('display_name')
    .eq('id', callerId)
    .maybeSingle()
  const inviterDisplayName = inviterRow?.display_name ?? 'A ConsentShield operator'

  // Step 1 — create the auth user with the admin claims seeded. If the
  // email already has an auth user, error out; the operator has to
  // disable the existing admin row first rather than silently hand
  // elevated access to an already-registered user.
  const { data: created, error: createErr } = await service.auth.admin.createUser({
    email,
    email_confirm: true,
    app_metadata: { is_admin: true, admin_role: adminRole },
  })
  if (createErr) {
    return NextResponse.json(
      { error: `auth.admin.createUser: ${createErr.message}` },
      { status: 400 },
    )
  }
  const newUserId = created.user.id

  // Step 2 — record the pending admin_users row under the caller's JWT
  // so require_admin('platform_operator') fires. Roll back the auth user
  // on any failure here; we don't want orphaned auth rows to elevate.
  const { data: adminId, error: rpcErr } = await authed
    .schema('admin')
    .rpc('admin_invite_create', {
      p_user_id: newUserId,
      p_display_name: displayName,
      p_admin_role: adminRole,
      p_reason: reason,
    })
  if (rpcErr) {
    await service.auth.admin.deleteUser(newUserId)
    return NextResponse.json(
      { error: `admin_invite_create: ${rpcErr.message}` },
      { status: 403 },
    )
  }

  // Step 3 — send the invite email. Failure is non-fatal; we return
  // the result so the operator can fall back to out-of-band credential
  // handoff. The admin_users row is still in place either way.
  const emailResult = await sendAdminInviteEmail({
    to: email,
    displayName,
    adminRole,
    invitedByDisplayName: inviterDisplayName,
  })

  return NextResponse.json(
    {
      adminId,
      userId: newUserId,
      emailDispatched: emailResult.dispatched,
      emailDispatchReason:
        emailResult.dispatched === false ? emailResult.reason : undefined,
    },
    { status: 201 },
  )
}
