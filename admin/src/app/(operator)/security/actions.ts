'use server'

import { revalidatePath } from 'next/cache'
import { createServerClient } from '@/lib/supabase/server'

// ADR-0033 Sprint 2.2 — Security Server Actions.
//
// Wraps 2 ADR-0033 Phase 2 RPCs:
//   admin.security_block_ip    — platform_operator
//   admin.security_unblock_ip  — platform_operator

type ActionResult<T = undefined> =
  | { ok: true; data?: T }
  | { ok: false; error: string }

// Permissive CIDR validator — Postgres cidr type will do the real parsing
// on insert; we just reject empty and obvious junk client-side.
function validateCidr(raw: string): string | null {
  if (!raw.trim()) return 'IP/CIDR required.'
  const s = raw.trim()
  if (!/^[0-9a-fA-F.:/]+$/.test(s)) return 'Only digits, colons, dots, and / allowed.'
  if (s.length > 43) return 'IP/CIDR too long.'
  return null
}

export async function blockIp(input: {
  ipCidr: string
  reason: string
  expiresAt: string
}): Promise<ActionResult<{ blockId: string }>> {
  const cidrErr = validateCidr(input.ipCidr)
  if (cidrErr) return { ok: false, error: cidrErr }
  if (input.reason.trim().length < 10) {
    return { ok: false, error: 'Reason must be at least 10 characters.' }
  }

  const supabase = await createServerClient()
  const { data, error } = await supabase.schema('admin').rpc('security_block_ip', {
    p_ip_cidr: input.ipCidr.trim(),
    p_reason: input.reason.trim(),
    p_expires_at: input.expiresAt ? new Date(input.expiresAt).toISOString() : null,
  })
  if (error) return { ok: false, error: error.message }

  revalidatePath('/security')
  return { ok: true, data: { blockId: data as string } }
}

export async function unblockIp(input: {
  blockId: string
  reason: string
}): Promise<ActionResult> {
  if (input.reason.trim().length < 10) {
    return { ok: false, error: 'Reason must be at least 10 characters.' }
  }

  const supabase = await createServerClient()
  const { error } = await supabase.schema('admin').rpc('security_unblock_ip', {
    p_block_id: input.blockId,
    p_reason: input.reason.trim(),
  })
  if (error) return { ok: false, error: error.message }

  revalidatePath('/security')
  return { ok: true }
}
