'use server'

import { revalidatePath } from 'next/cache'
import { createServerClient } from '@/lib/supabase/server'

export type RegistrationCategory =
  | 'ca_firm'
  | 'sebi_registered'
  | 'iso_27001_certified_cb'
  | 'dpdp_empanelled'
  | 'rbi_empanelled'
  | 'other'

interface CreateInput {
  org_id: string
  auditor_name: string
  registration_category: RegistrationCategory
  registration_ref: string | null
  scope: string
  engagement_start: string
  attestation_ref: string | null
}

export async function createEngagement(
  input: CreateInput,
): Promise<{ id: string } | { error: string }> {
  const supabase = await createServerClient()
  const { data, error } = await supabase.rpc('create_auditor_engagement', {
    p_org_id: input.org_id,
    p_auditor_name: input.auditor_name,
    p_registration_category: input.registration_category,
    p_registration_ref: input.registration_ref,
    p_scope: input.scope,
    p_engagement_start: input.engagement_start,
    p_attestation_ref: input.attestation_ref,
  })
  if (error) return { error: error.message }
  revalidatePath('/dashboard/auditors')
  return { id: data as string }
}

export async function completeEngagement(
  id: string,
  engagementEnd: string,
  attestationRef: string | null,
): Promise<{ ok: true } | { error: string }> {
  const supabase = await createServerClient()
  const { error } = await supabase.rpc('complete_auditor_engagement', {
    p_id: id,
    p_engagement_end: engagementEnd,
    p_attestation_ref: attestationRef,
  })
  if (error) return { error: error.message }
  revalidatePath('/dashboard/auditors')
  revalidatePath(`/dashboard/auditors/${id}`)
  return { ok: true }
}

export async function terminateEngagement(
  id: string,
  engagementEnd: string,
  reason: string,
): Promise<{ ok: true } | { error: string }> {
  const supabase = await createServerClient()
  const { error } = await supabase.rpc('terminate_auditor_engagement', {
    p_id: id,
    p_engagement_end: engagementEnd,
    p_reason: reason,
  })
  if (error) return { error: error.message }
  revalidatePath('/dashboard/auditors')
  revalidatePath(`/dashboard/auditors/${id}`)
  return { ok: true }
}

export async function updateEngagement(
  id: string,
  scope: string | null,
  notes: string | null,
  attestationRef: string | null,
): Promise<{ ok: true } | { error: string }> {
  const supabase = await createServerClient()
  const { error } = await supabase.rpc('update_auditor_engagement', {
    p_id: id,
    p_scope: scope,
    p_notes: notes,
    p_attestation_ref: attestationRef,
  })
  if (error) return { error: error.message }
  revalidatePath(`/dashboard/auditors/${id}`)
  return { ok: true }
}
