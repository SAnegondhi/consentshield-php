'use server'

import { revalidatePath } from 'next/cache'
import { createServerClient } from '@/lib/supabase/server'

// ADR-1027 Sprint 3.2 — server actions for account notes.

export async function addAccountNote(formData: FormData) {
  const accountId = String(formData.get('account_id') ?? '')
  const body = String(formData.get('body') ?? '').trim()
  const pinned = formData.get('pinned') === 'on'
  const reason = String(formData.get('reason') ?? '').trim() || 'operator account note added'

  if (!accountId || !body) {
    return { error: 'account_id and body required' }
  }

  const supabase = await createServerClient()
  const { error } = await supabase
    .schema('admin')
    .rpc('account_note_add', {
      p_account_id: accountId,
      p_body: body,
      p_pinned: pinned,
      p_reason: reason,
    })

  if (error) return { error: error.message }

  revalidatePath(`/accounts/${accountId}`)
  return { ok: true }
}

export async function updateAccountNote(formData: FormData) {
  const accountId = String(formData.get('account_id') ?? '')
  const noteId = String(formData.get('note_id') ?? '')
  const body = String(formData.get('body') ?? '').trim()
  const pinned = formData.get('pinned') === 'on'
  const reason = String(formData.get('reason') ?? '').trim() || 'operator account note updated'

  if (!noteId || !body) {
    return { error: 'note_id and body required' }
  }

  const supabase = await createServerClient()
  const { error } = await supabase
    .schema('admin')
    .rpc('account_note_update', {
      p_note_id: noteId,
      p_body: body,
      p_pinned: pinned,
      p_reason: reason,
    })

  if (error) return { error: error.message }

  revalidatePath(`/accounts/${accountId}`)
  return { ok: true }
}

export async function deleteAccountNote(formData: FormData) {
  const accountId = String(formData.get('account_id') ?? '')
  const noteId = String(formData.get('note_id') ?? '')
  const reason = String(formData.get('reason') ?? '').trim() || 'operator account note deleted'

  if (!noteId) {
    return { error: 'note_id required' }
  }

  const supabase = await createServerClient()
  const { error } = await supabase
    .schema('admin')
    .rpc('account_note_delete', {
      p_note_id: noteId,
      p_reason: reason,
    })

  if (error) return { error: error.message }

  revalidatePath(`/accounts/${accountId}`)
  return { ok: true }
}
