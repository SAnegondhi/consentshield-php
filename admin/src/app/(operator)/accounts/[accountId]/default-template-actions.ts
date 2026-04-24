'use server'

import { revalidatePath } from 'next/cache'
import { createServerClient } from '@/lib/supabase/server'

// ADR-1027 Sprint 3.3 — server action for account default template.

export async function setAccountDefaultTemplate(formData: FormData) {
  const accountId = String(formData.get('account_id') ?? '')
  const raw = String(formData.get('template_id') ?? '')
  const templateId = raw === '' ? null : raw
  const reason = 'set account default template via admin UI'

  if (!accountId) {
    return { error: 'account_id required' }
  }

  const supabase = await createServerClient()
  const { error } = await supabase
    .schema('admin')
    .rpc('set_account_default_template', {
      p_account_id: accountId,
      p_template_id: templateId,
      p_reason: reason,
    })

  if (error) return { error: error.message }

  revalidatePath(`/accounts/${accountId}`)
  return { ok: true }
}
