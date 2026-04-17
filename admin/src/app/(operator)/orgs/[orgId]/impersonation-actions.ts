'use server'

import { revalidatePath } from 'next/cache'
import { createServerClient } from '@/lib/supabase/server'
import {
  clearImpersonationCookie,
  readImpersonationCookie,
  writeImpersonationCookie,
} from '@/lib/impersonation/cookie'

// ADR-0029 Sprint 3.1 — impersonation lifecycle Server Actions.
//
// startImpersonation: opens a session via admin.start_impersonation RPC
// (which inserts admin.impersonation_sessions row + emits pg_notify for
// the customer-notification Edge Function), then stashes the session
// summary in an httpOnly cookie so the admin shell can render the
// active-session banner.
//
// endImpersonation: closes the current session via admin.end_impersonation
// RPC and clears the cookie.
//
// forceEndImpersonation: platform_operator override; calls
// admin.force_end_impersonation (which permits closing a session owned
// by a different admin).

type ActionResult<T = undefined> =
  | ({ ok: true } & (T extends undefined ? unknown : { value: T }))
  | { ok: false; error: string }

const REASONS = [
  'bug_investigation',
  'data_correction',
  'compliance_query',
  'partner_demo',
  'other',
] as const
type Reason = (typeof REASONS)[number]

export async function startImpersonation(
  orgId: string,
  orgName: string,
  reason: string,
  reasonDetail: string,
  durationMinutes: number,
): Promise<ActionResult<{ session_id: string }>> {
  if (!REASONS.includes(reason as Reason)) {
    return { ok: false, error: 'Invalid reason code' }
  }
  if (reasonDetail.trim().length < 10) {
    return { ok: false, error: 'Reason detail must be at least 10 characters' }
  }
  if (durationMinutes < 1 || durationMinutes > 120) {
    return { ok: false, error: 'Duration must be between 1 and 120 minutes' }
  }

  // Refuse to overwrite an active session via another start call.
  const existing = await readImpersonationCookie()
  if (existing && new Date(existing.expires_at).getTime() > Date.now()) {
    return {
      ok: false,
      error:
        'Another impersonation session is active. End it first before starting a new one.',
    }
  }

  const supabase = await createServerClient()
  const { data: sessionId, error } = await supabase
    .schema('admin')
    .rpc('start_impersonation', {
      p_org_id: orgId,
      p_reason: reason,
      p_reason_detail: reasonDetail.trim(),
      p_duration_minutes: durationMinutes,
    })
  if (error) return { ok: false, error: error.message }
  if (typeof sessionId !== 'string') {
    return { ok: false, error: 'RPC returned no session id' }
  }

  const startedAt = new Date()
  const expiresAt = new Date(startedAt.getTime() + durationMinutes * 60_000)

  await writeImpersonationCookie({
    session_id: sessionId,
    target_org_id: orgId,
    target_org_name: orgName,
    reason,
    started_at: startedAt.toISOString(),
    expires_at: expiresAt.toISOString(),
  })

  revalidatePath('/', 'layout')
  return { ok: true, value: { session_id: sessionId } }
}

export async function endImpersonation(
  actionsSummary: Record<string, unknown> = {},
): Promise<ActionResult> {
  const cookie = await readImpersonationCookie()
  if (!cookie) {
    return { ok: false, error: 'No active impersonation session' }
  }

  const supabase = await createServerClient()
  const { error } = await supabase.schema('admin').rpc('end_impersonation', {
    p_session_id: cookie.session_id,
    p_actions_summary: actionsSummary,
  })
  // Clear the cookie unconditionally. If the RPC errored we still don't
  // want to leave the UI "stuck" — the session may have expired on the
  // DB side (auto-expiry cron), in which case the RPC returns early.
  await clearImpersonationCookie()

  if (error) return { ok: false, error: error.message }
  revalidatePath('/', 'layout')
  return { ok: true }
}

export async function forceEndImpersonation(
  sessionId: string,
  reason: string,
): Promise<ActionResult> {
  if (reason.trim().length < 10) {
    return { ok: false, error: 'Reason must be at least 10 characters' }
  }
  const supabase = await createServerClient()
  const { error } = await supabase
    .schema('admin')
    .rpc('force_end_impersonation', {
      p_session_id: sessionId,
      p_reason: reason.trim(),
    })
  if (error) return { ok: false, error: error.message }

  // If the forced-ended session is the caller's own, clear their cookie.
  const cookie = await readImpersonationCookie()
  if (cookie?.session_id === sessionId) await clearImpersonationCookie()

  revalidatePath('/', 'layout')
  return { ok: true }
}
