'use server'

import { revalidatePath } from 'next/cache'
import { createServerClient } from '@/lib/supabase/server'

// ADR-0029 Sprint 2.1 — Org detail Server Actions.
//
// Each action wraps one ADR-0027 Sprint 3.1 RPC. The RPC layer is the
// authoritative gate (reason ≥ 10 chars, role check, audit insert in
// same txn). Actions validate reason length client-side too so the
// user gets a fast failure without a round-trip — the DB-side check
// is still the source of truth.

type ActionResult = { ok: true } | { ok: false; error: string }

export async function addOrgNote(
  orgId: string,
  body: string,
  pinned: boolean,
): Promise<ActionResult> {
  if (!body || body.trim().length === 0) {
    return { ok: false, error: 'Note body required' }
  }
  const supabase = await createServerClient()
  const { error } = await supabase.schema('admin').rpc('add_org_note', {
    p_org_id: orgId,
    p_body: body.trim(),
    p_pinned: pinned,
  })
  if (error) return { ok: false, error: error.message }
  revalidatePath(`/orgs/${orgId}`)
  return { ok: true }
}

export async function extendTrial(
  orgId: string,
  newTrialEnd: string,
  reason: string,
): Promise<ActionResult> {
  if (reason.trim().length < 10) {
    return { ok: false, error: 'Reason must be at least 10 characters' }
  }
  const trialTs = new Date(newTrialEnd)
  if (Number.isNaN(trialTs.getTime()) || trialTs.getTime() <= Date.now()) {
    return { ok: false, error: 'New trial end must be a future date' }
  }
  const supabase = await createServerClient()
  const { error } = await supabase.schema('admin').rpc('extend_trial', {
    p_org_id: orgId,
    p_new_trial_end: trialTs.toISOString(),
    p_reason: reason.trim(),
  })
  if (error) return { ok: false, error: error.message }
  revalidatePath(`/orgs/${orgId}`)
  return { ok: true }
}

export async function suspendOrg(
  orgId: string,
  reason: string,
): Promise<ActionResult> {
  if (reason.trim().length < 10) {
    return { ok: false, error: 'Reason must be at least 10 characters' }
  }
  const supabase = await createServerClient()
  const { error } = await supabase.schema('admin').rpc('suspend_org', {
    p_org_id: orgId,
    p_reason: reason.trim(),
  })
  if (error) return { ok: false, error: error.message }
  revalidatePath(`/orgs/${orgId}`)
  revalidatePath('/orgs')
  return { ok: true }
}

export async function restoreOrg(
  orgId: string,
  reason: string,
): Promise<ActionResult> {
  if (reason.trim().length < 10) {
    return { ok: false, error: 'Reason must be at least 10 characters' }
  }
  const supabase = await createServerClient()
  const { error } = await supabase.schema('admin').rpc('restore_org', {
    p_org_id: orgId,
    p_reason: reason.trim(),
  })
  if (error) return { ok: false, error: error.message }
  revalidatePath(`/orgs/${orgId}`)
  revalidatePath('/orgs')
  return { ok: true }
}
