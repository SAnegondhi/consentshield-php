'use server'

import { revalidatePath } from 'next/cache'
import { createServerClient } from '@/lib/supabase/server'

// ADR-1017 Sprint 1.2 — server action wrapping admin.set_ops_readiness_flag_status.

export interface SetFlagStatusInput {
  flagId: string
  status: 'pending' | 'in_progress' | 'resolved' | 'deferred'
  resolutionNotes?: string
}

export async function setFlagStatusAction(
  input: SetFlagStatusInput,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const supabase = await createServerClient()
  const { error } = await supabase.schema('admin').rpc('set_ops_readiness_flag_status', {
    p_flag_id: input.flagId,
    p_status: input.status,
    p_resolution_notes: input.resolutionNotes ?? null,
  })
  if (error) {
    return { ok: false, error: error.message }
  }
  revalidatePath('/readiness')
  return { ok: true }
}
