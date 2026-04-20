'use server'

import { revalidatePath } from 'next/cache'
import { createServerClient } from '@/lib/supabase/server'

interface CreateDpiaInput {
  org_id: string
  title: string
  processing_description: string
  data_categories: string[]
  risk_level: 'low' | 'medium' | 'high'
  mitigations: Record<string, unknown>
  auditor_attestation_ref: string | null
  auditor_name: string | null
  conducted_at: string
  next_review_at: string | null
}

export async function createDpia(
  input: CreateDpiaInput,
): Promise<{ id: string } | { error: string }> {
  const supabase = await createServerClient()
  const { data, error } = await supabase.rpc('create_dpia_record', {
    p_org_id: input.org_id,
    p_title: input.title,
    p_processing_description: input.processing_description,
    p_data_categories: input.data_categories,
    p_risk_level: input.risk_level,
    p_mitigations: input.mitigations,
    p_auditor_attestation_ref: input.auditor_attestation_ref,
    p_auditor_name: input.auditor_name,
    p_conducted_at: input.conducted_at,
    p_next_review_at: input.next_review_at,
  })
  if (error) return { error: error.message }
  revalidatePath('/dashboard/dpia')
  return { id: data as string }
}

export async function publishDpia(
  dpiaId: string,
): Promise<{ ok: true } | { error: string }> {
  const supabase = await createServerClient()
  const { error } = await supabase.rpc('publish_dpia_record', { p_dpia_id: dpiaId })
  if (error) return { error: error.message }
  revalidatePath('/dashboard/dpia')
  revalidatePath(`/dashboard/dpia/${dpiaId}`)
  return { ok: true }
}

export async function supersedeDpia(
  oldId: string,
  replacementId: string,
): Promise<{ ok: true } | { error: string }> {
  const supabase = await createServerClient()
  const { error } = await supabase.rpc('supersede_dpia_record', {
    p_old_id: oldId,
    p_replacement_id: replacementId,
  })
  if (error) return { error: error.message }
  revalidatePath('/dashboard/dpia')
  return { ok: true }
}
