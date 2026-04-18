'use server'

import { revalidatePath } from 'next/cache'
import { createServerClient } from '@/lib/supabase/server'

// ADR-0034 Sprint 2.1 — Billing Operations Server Actions.
//
// Wraps three non-Razorpay write RPCs:
//
//   admin.billing_create_refund            — support+
//   admin.billing_upsert_plan_adjustment   — platform_operator
//   admin.billing_revoke_plan_adjustment   — platform_operator
//
// Razorpay round-trip (actual refund issue + retry charge) ships in
// Sprint 2.2; createRefund today only inserts a pending DB row. An
// operator can audit the pending state and complete manually in the
// Razorpay dashboard until 2.2 lands.

type ActionResult<T = undefined> =
  | { ok: true; data?: T }
  | { ok: false; error: string }

export async function createRefund(input: {
  accountId: string
  razorpayPaymentId: string
  amountPaise: number
  reason: string
}): Promise<ActionResult<{ refundId: string }>> {
  if (!input.accountId) return { ok: false, error: 'Account id required.' }
  if (!Number.isInteger(input.amountPaise) || input.amountPaise <= 0) {
    return { ok: false, error: 'Amount must be a positive whole number of paise.' }
  }
  if (input.reason.trim().length < 10) {
    return { ok: false, error: 'Reason must be at least 10 characters.' }
  }

  const supabase = await createServerClient()
  const { data, error } = await supabase
    .schema('admin')
    .rpc('billing_create_refund', {
      p_account_id: input.accountId,
      p_razorpay_payment_id: input.razorpayPaymentId.trim() || null,
      p_amount_paise: input.amountPaise,
      p_reason: input.reason.trim(),
    })
  if (error) return { ok: false, error: error.message }

  revalidatePath('/billing')
  return { ok: true, data: { refundId: data as string } }
}

export async function upsertPlanAdjustment(input: {
  accountId: string
  kind: 'comp' | 'override'
  planCode: string
  expiresAt: string
  reason: string
}): Promise<ActionResult<{ adjustmentId: string }>> {
  if (!input.accountId) return { ok: false, error: 'Account id required.' }
  if (input.kind !== 'comp' && input.kind !== 'override') {
    return { ok: false, error: 'Kind must be comp or override.' }
  }
  if (input.reason.trim().length < 10) {
    return { ok: false, error: 'Reason must be at least 10 characters.' }
  }

  const supabase = await createServerClient()
  const { data, error } = await supabase
    .schema('admin')
    .rpc('billing_upsert_plan_adjustment', {
      p_account_id: input.accountId,
      p_kind: input.kind,
      p_plan: input.planCode,
      p_expires_at: input.expiresAt ? new Date(input.expiresAt).toISOString() : null,
      p_reason: input.reason.trim(),
    })
  if (error) return { ok: false, error: error.message }

  revalidatePath('/billing')
  return { ok: true, data: { adjustmentId: data as string } }
}

export async function revokePlanAdjustment(input: {
  adjustmentId: string
  reason: string
}): Promise<ActionResult> {
  if (!input.adjustmentId) return { ok: false, error: 'Adjustment id required.' }
  if (input.reason.trim().length < 10) {
    return { ok: false, error: 'Reason must be at least 10 characters.' }
  }

  const supabase = await createServerClient()
  const { error } = await supabase
    .schema('admin')
    .rpc('billing_revoke_plan_adjustment', {
      p_adjustment_id: input.adjustmentId,
      p_reason: input.reason.trim(),
    })
  if (error) return { ok: false, error: error.message }

  revalidatePath('/billing')
  return { ok: true }
}
