'use server'

import { revalidatePath } from 'next/cache'
import { createServerClient } from '@/lib/supabase/server'

// ADR-1018 Sprint 1.2 — server actions wrapping the admin status RPCs.

type Ok = { ok: true }
type Err = { ok: false; error: string }

export async function setSubsystemStateAction(input: {
  slug: string
  state: 'operational' | 'degraded' | 'down' | 'maintenance'
  note?: string
}): Promise<Ok | Err> {
  const supabase = await createServerClient()
  const { error } = await supabase.schema('admin').rpc('set_status_subsystem_state', {
    p_slug: input.slug,
    p_state: input.state,
    p_note: input.note ?? null,
  })
  if (error) return { ok: false, error: error.message }
  revalidatePath('/status')
  return { ok: true }
}

export async function postIncidentAction(input: {
  title: string
  description: string
  severity: 'sev1' | 'sev2' | 'sev3'
  affectedSubsystemIds: string[]
  initialStatus?: 'investigating' | 'identified' | 'monitoring'
}): Promise<Ok | Err> {
  const supabase = await createServerClient()
  const { error } = await supabase.schema('admin').rpc('post_status_incident', {
    p_title: input.title,
    p_description: input.description,
    p_severity: input.severity,
    p_affected_subsystems: input.affectedSubsystemIds,
    p_initial_status: input.initialStatus ?? 'investigating',
  })
  if (error) return { ok: false, error: error.message }
  revalidatePath('/status')
  return { ok: true }
}

export async function updateIncidentAction(input: {
  incidentId: string
  newStatus: 'investigating' | 'identified' | 'monitoring' | 'resolved'
  note?: string
}): Promise<Ok | Err> {
  const supabase = await createServerClient()
  const { error } = await supabase.schema('admin').rpc('update_status_incident', {
    p_incident_id: input.incidentId,
    p_new_status: input.newStatus,
    p_last_update_note: input.note ?? null,
  })
  if (error) return { ok: false, error: error.message }
  revalidatePath('/status')
  return { ok: true }
}

export async function resolveIncidentAction(input: {
  incidentId: string
  postmortemUrl?: string
  resolutionNote?: string
}): Promise<Ok | Err> {
  const supabase = await createServerClient()
  const { error } = await supabase.schema('admin').rpc('resolve_status_incident', {
    p_incident_id: input.incidentId,
    p_postmortem_url: input.postmortemUrl ?? null,
    p_resolution_note: input.resolutionNote ?? null,
  })
  if (error) return { ok: false, error: error.message }
  revalidatePath('/status')
  return { ok: true }
}
