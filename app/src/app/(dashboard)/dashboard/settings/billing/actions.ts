'use server'

import { createServerClient } from '@/lib/supabase/server'

interface BillingProfileInput {
  legal_name: string
  gstin: string | null
  state_code: string
  address: string
  email: string
}

export async function updateBillingProfile(
  input: BillingProfileInput,
): Promise<{ ok: true } | { error: string }> {
  const supabase = await createServerClient()
  const { data, error } = await supabase.rpc('update_account_billing_profile', {
    p_legal_name: input.legal_name,
    p_gstin: input.gstin,
    p_state_code: input.state_code,
    p_address: input.address,
    p_email: input.email,
  })

  if (error) {
    // Surface validation messages verbatim (they're already human-readable)
    return { error: error.message }
  }

  const result = data as { ok: boolean } | null
  if (!result?.ok) {
    return { error: 'Update failed' }
  }
  return { ok: true }
}
