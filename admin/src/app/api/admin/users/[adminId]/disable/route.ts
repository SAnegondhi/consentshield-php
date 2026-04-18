import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { ServiceClientEnvError } from '@/lib/supabase/service'
import { disableAdmin, LifecycleError } from '@/lib/admin/lifecycle'

// ADR-0045 Sprint 1.2 — POST /api/admin/users/[adminId]/disable

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

  const authed = await createServerClient()

  try {
    const outcome = await disableAdmin({
      authedClient: authed,
      adminId,
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
