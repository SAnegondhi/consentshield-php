'use server'

import { revalidatePath } from 'next/cache'
import { createServerClient } from '@/lib/supabase/server'

export async function createApiKey(formData: FormData) {
  const supabase = await createServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { error: 'Unauthenticated' }

  const name = (formData.get('name') as string | null)?.trim()
  if (!name) return { error: 'Key name is required' }

  const scopes = formData.getAll('scopes') as string[]
  if (scopes.length === 0) return { error: 'Select at least one scope' }

  const accountId = formData.get('account_id') as string | null
  const orgId = (formData.get('org_id') as string | null) || null
  const rateTier = (formData.get('rate_tier') as string | null) ?? 'starter'

  if (!accountId) return { error: 'Missing account context' }

  const { data, error } = await supabase.rpc('rpc_api_key_create', {
    p_account_id: accountId,
    p_org_id: orgId,
    p_scopes: scopes,
    p_rate_tier: rateTier,
    p_name: name,
  })

  if (error) return { error: error.message }

  revalidatePath('/dashboard/settings/api-keys')
  return { data: data as { id: string; plaintext: string; prefix: string; scopes: string[]; rate_tier: string; created_at: string } }
}

export async function rotateApiKey(keyId: string) {
  const supabase = await createServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { error: 'Unauthenticated' }

  const { data, error } = await supabase.rpc('rpc_api_key_rotate', { p_key_id: keyId })
  if (error) return { error: error.message }

  revalidatePath('/dashboard/settings/api-keys')
  return { data: data as { id: string; plaintext: string; prefix: string; previous_key_expires_at: string; rotated_at: string } }
}

export async function revokeApiKey(keyId: string) {
  const supabase = await createServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { error: 'Unauthenticated' }

  const { error } = await supabase.rpc('rpc_api_key_revoke', { p_key_id: keyId })
  if (error) return { error: error.message }

  revalidatePath('/dashboard/settings/api-keys')
  return { data: null }
}
