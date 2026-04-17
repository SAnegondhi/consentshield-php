'use server'

import { revalidatePath } from 'next/cache'
import { createServerClient } from '@/lib/supabase/server'

// ADR-0031 Sprint 2.2 — Tracker Signature Server Actions.
//
// Wraps four ADR-0027 RPCs:
//   admin.add_tracker_signature       — support
//   admin.update_tracker_signature    — support
//   admin.deprecate_tracker_signature — support
//   admin.import_tracker_signature_pack — platform_operator

const SIGNATURE_TYPES = new Set([
  'script_src',
  'resource_url',
  'cookie_name',
  'localstorage_key',
  'dom_attribute',
])
const CATEGORIES = new Set([
  'analytics',
  'marketing',
  'functional',
  'social',
  'advertising',
  'other',
])
const SEVERITIES = new Set(['info', 'warn', 'critical'])

type ActionResult<T = undefined> =
  | { ok: true; data?: T }
  | { ok: false; error: string }

function validateCode(code: string): string | null {
  if (!/^[a-z0-9_]+$/.test(code)) {
    return 'Signature code must be snake_case (a-z, 0-9, underscore).'
  }
  return null
}

function validatePattern(pattern: string): string | null {
  if (pattern.trim().length === 0) return 'Pattern required.'
  try {
    // Accept JS-style /foo/flags or raw body. Try raw first.
    new RegExp(pattern)
  } catch {
    try {
      const slashMatch = pattern.match(/^\/(.+)\/([a-z]*)$/)
      if (slashMatch) {
        new RegExp(slashMatch[1]!, slashMatch[2])
      } else {
        return 'Pattern is not a valid regex.'
      }
    } catch (e) {
      return `Pattern is not a valid regex: ${(e as Error).message}`
    }
  }
  return null
}

export async function createSignature(input: {
  signatureCode: string
  displayName: string
  vendor: string
  signatureType: string
  pattern: string
  category: string
  severity: string
  notes: string
  reason: string
}): Promise<ActionResult<{ signatureId: string }>> {
  const codeErr = validateCode(input.signatureCode)
  if (codeErr) return { ok: false, error: codeErr }
  if (input.displayName.trim().length === 0) return { ok: false, error: 'Display name required.' }
  if (input.vendor.trim().length === 0) return { ok: false, error: 'Vendor required.' }
  if (!SIGNATURE_TYPES.has(input.signatureType)) return { ok: false, error: 'Invalid signature type.' }
  if (!CATEGORIES.has(input.category)) return { ok: false, error: 'Invalid category.' }
  if (!SEVERITIES.has(input.severity)) return { ok: false, error: 'Invalid severity.' }
  const patErr = validatePattern(input.pattern)
  if (patErr) return { ok: false, error: patErr }
  if (input.reason.trim().length < 10) return { ok: false, error: 'Reason must be at least 10 characters.' }

  const supabase = await createServerClient()
  const { data, error } = await supabase.schema('admin').rpc('add_tracker_signature', {
    p_signature_code: input.signatureCode.trim(),
    p_display_name: input.displayName.trim(),
    p_vendor: input.vendor.trim(),
    p_signature_type: input.signatureType,
    p_pattern: input.pattern.trim(),
    p_category: input.category,
    p_severity: input.severity,
    p_notes: input.notes.trim() || null,
    p_reason: input.reason.trim(),
  })
  if (error) return { ok: false, error: error.message }

  revalidatePath('/signatures')
  return { ok: true, data: { signatureId: data as string } }
}

export async function updateSignature(input: {
  signatureId: string
  displayName: string
  pattern: string
  category: string
  severity: string
  notes: string
  reason: string
}): Promise<ActionResult> {
  if (input.displayName.trim().length === 0) return { ok: false, error: 'Display name required.' }
  if (!CATEGORIES.has(input.category)) return { ok: false, error: 'Invalid category.' }
  if (!SEVERITIES.has(input.severity)) return { ok: false, error: 'Invalid severity.' }
  const patErr = validatePattern(input.pattern)
  if (patErr) return { ok: false, error: patErr }
  if (input.reason.trim().length < 10) return { ok: false, error: 'Reason must be at least 10 characters.' }

  const supabase = await createServerClient()
  const { error } = await supabase.schema('admin').rpc('update_tracker_signature', {
    p_signature_id: input.signatureId,
    p_display_name: input.displayName.trim(),
    p_pattern: input.pattern.trim(),
    p_category: input.category,
    p_severity: input.severity,
    p_notes: input.notes.trim() || null,
    p_reason: input.reason.trim(),
  })
  if (error) return { ok: false, error: error.message }

  revalidatePath(`/signatures/${input.signatureId}`)
  revalidatePath('/signatures')
  return { ok: true }
}

export async function deprecateSignature(
  signatureId: string,
  reason: string,
): Promise<ActionResult> {
  if (reason.trim().length < 10) return { ok: false, error: 'Reason must be at least 10 characters.' }

  const supabase = await createServerClient()
  const { error } = await supabase.schema('admin').rpc('deprecate_tracker_signature', {
    p_signature_id: signatureId,
    p_reason: reason.trim(),
  })
  if (error) return { ok: false, error: error.message }

  revalidatePath(`/signatures/${signatureId}`)
  revalidatePath('/signatures')
  return { ok: true }
}

export async function importPack(input: {
  packJson: string
  reason: string
}): Promise<ActionResult<{ count: number }>> {
  if (input.reason.trim().length < 10) return { ok: false, error: 'Reason must be at least 10 characters.' }

  let parsed: unknown
  try {
    parsed = JSON.parse(input.packJson)
  } catch (e) {
    return { ok: false, error: `Invalid JSON: ${(e as Error).message}` }
  }
  if (!Array.isArray(parsed)) {
    return { ok: false, error: 'Pack must be a JSON array of signature objects.' }
  }

  const supabase = await createServerClient()
  const { data, error } = await supabase
    .schema('admin')
    .rpc('import_tracker_signature_pack', {
      p_pack: parsed,
      p_reason: input.reason.trim(),
    })
  if (error) return { ok: false, error: error.message }

  revalidatePath('/signatures')
  return { ok: true, data: { count: Number(data ?? 0) } }
}
