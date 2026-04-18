import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { ServiceClientEnvError } from '@/lib/supabase/service'
import { changeAdminRole, LifecycleError } from '@/lib/admin/lifecycle'

// ADR-0045 Sprint 1.2 — PATCH /api/admin/users/[adminId]/role

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

  const authed = await createServerClient()

  try {
    const outcome = await changeAdminRole({
      authedClient: authed,
      adminId,
      newRole,
      reason,
    })
    return NextResponse.json(outcome, { status: outcome.authSyncUpdated ? 200 : 207 })
  } catch (e) {
    if (e instanceof LifecycleError) {
      return NextResponse.json({ error: e.message, code: e.code }, { status: 403 })
    }
    if (e instanceof ServiceClientEnvError) {
      return NextResponse.json({ error: e.message }, { status: 500 })
    }
    throw e
  }
}
