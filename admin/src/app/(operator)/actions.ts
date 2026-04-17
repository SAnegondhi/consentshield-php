'use server'

import { revalidatePath } from 'next/cache'
import { createServerClient } from '@/lib/supabase/server'

// ADR-0028 Sprint 2.1 — Operations Dashboard Server Actions.

export async function refreshPlatformMetrics() {
  const supabase = await createServerClient()
  const today = new Date().toISOString().slice(0, 10)

  const { error } = await supabase.schema('admin').rpc('refresh_platform_metrics', {
    p_date: today,
  })
  if (error) {
    return { ok: false as const, error: error.message }
  }
  revalidatePath('/')
  return { ok: true as const, date: today }
}
