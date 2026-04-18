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

// ADR-0046 Phase 1 Sprint 1.2 — SDF status on org detail.
// Wraps admin.set_sdf_status. platform_operator only (RPC enforces).
// Customer dashboard picks the change up on its next server-render
// via the organisations RLS path.

export async function setSdfStatus(
  orgId: string,
  input: {
    sdfStatus: 'not_designated' | 'self_declared' | 'notified' | 'exempt'
    notificationRef: string
    notifiedAt: string
    reason: string
  },
): Promise<ActionResult> {
  if (input.reason.trim().length < 10) {
    return { ok: false, error: 'Reason must be at least 10 characters' }
  }
  if (
    input.sdfStatus !== 'not_designated' &&
    input.sdfStatus !== 'self_declared' &&
    input.sdfStatus !== 'notified' &&
    input.sdfStatus !== 'exempt'
  ) {
    return { ok: false, error: 'Unknown sdf_status' }
  }
  const supabase = await createServerClient()
  const { error } = await supabase.schema('admin').rpc('set_sdf_status', {
    p_org_id: orgId,
    p_sdf_status: input.sdfStatus,
    p_sdf_notification_ref: input.notificationRef.trim() || null,
    p_sdf_notified_at: input.notifiedAt
      ? new Date(input.notifiedAt).toISOString()
      : null,
    p_reason: input.reason.trim(),
  })
  if (error) return { ok: false, error: error.message }
  revalidatePath(`/orgs/${orgId}`)
  revalidatePath('/orgs')
  return { ok: true }
}

// ADR-0047 Sprint 1.2 — admin mirror for customer membership lifecycle.
//
// These actions target public.change_membership_role / remove_membership.
// The admin-JWT bypass branch inside those RPCs lets platform_operators
// act on any account/org without being a member themselves. The RPC
// writes to public.membership_audit_log with actor_user_id = the
// admin's auth.uid(); a companion admin.admin_audit_log write can be
// layered on if operator-forensics demands it.

export async function changeMembershipRole(
  orgId: string,
  userId: string,
  scope: 'account' | 'org',
  scopeOrgId: string | null,
  newRole: string,
  reason: string,
): Promise<ActionResult> {
  if (reason.trim().length < 10) {
    return { ok: false, error: 'Reason must be at least 10 characters' }
  }
  const supabase = await createServerClient()
  const { error } = await supabase.rpc('change_membership_role', {
    p_user_id: userId,
    p_scope: scope,
    p_org_id: scopeOrgId,
    p_new_role: newRole,
    p_reason: reason.trim(),
  })
  if (error) return { ok: false, error: error.message }
  revalidatePath(`/orgs/${orgId}`)
  return { ok: true }
}

export async function removeMembership(
  orgId: string,
  userId: string,
  scope: 'account' | 'org',
  scopeOrgId: string | null,
  reason: string,
): Promise<ActionResult> {
  if (reason.trim().length < 10) {
    return { ok: false, error: 'Reason must be at least 10 characters' }
  }
  const supabase = await createServerClient()
  const { error } = await supabase.rpc('remove_membership', {
    p_user_id: userId,
    p_scope: scope,
    p_org_id: scopeOrgId,
    p_reason: reason.trim(),
  })
  if (error) return { ok: false, error: error.message }
  revalidatePath(`/orgs/${orgId}`)
  return { ok: true }
}
