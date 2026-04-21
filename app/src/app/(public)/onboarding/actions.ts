'use server'

import { createServerClient } from '@/lib/supabase/server'

// ADR-0058 Sprint 1.3 — wizard server actions. Every action runs as
// the authed user's session (post-Step-1); RLS / RPC role-gates fail
// loudly if the caller isn't the account_owner of the org being
// configured.

export type ActionResult<T = unknown> =
  | { ok: true; data: T }
  | { ok: false; error: string }

export async function setOnboardingStep(
  orgId: string,
  step: number,
): Promise<ActionResult<null>> {
  const supabase = await createServerClient()
  const { error } = await supabase.rpc('set_onboarding_step', {
    p_org_id: orgId,
    p_step: step,
  })
  if (error) return { ok: false, error: error.message }
  return { ok: true, data: null }
}

export async function updateIndustry(
  orgId: string,
  industry: string,
): Promise<ActionResult<null>> {
  const supabase = await createServerClient()
  const { error } = await supabase.rpc('update_org_industry', {
    p_org_id: orgId,
    p_industry: industry,
  })
  if (error) return { ok: false, error: error.message }
  return { ok: true, data: null }
}

export async function seedDataInventory(
  orgId: string,
  flags: { email: boolean; payments: boolean; analytics: boolean },
): Promise<ActionResult<{ inserted: number }>> {
  const supabase = await createServerClient()
  const { data, error } = await supabase.rpc('seed_quick_data_inventory', {
    p_org_id: orgId,
    p_has_email: flags.email,
    p_has_payments: flags.payments,
    p_has_analytics: flags.analytics,
  })
  if (error) return { ok: false, error: error.message }
  return { ok: true, data: { inserted: (data as number) ?? 0 } }
}

export async function applyTemplate(
  templateCode: string,
): Promise<ActionResult<unknown>> {
  const supabase = await createServerClient()
  const { data, error } = await supabase.rpc('apply_sectoral_template', {
    p_template_code: templateCode,
  })
  if (error) return { ok: false, error: error.message }
  return { ok: true, data }
}

// ADR-0058 Sprint 1.5 — log step completion telemetry. Fire-and-forget:
// callers advance on set_onboarding_step success regardless of whether
// the telemetry write succeeds.
export async function logStepCompletion(
  orgId: string,
  step: number,
  elapsedMs: number,
): Promise<void> {
  const supabase = await createServerClient()
  await supabase.rpc('log_onboarding_step_event', {
    p_org_id: orgId,
    p_step: step,
    p_elapsed_ms: elapsedMs,
  })
}

// ADR-0058 Sprint 1.5 — in-wizard plan swap. Gated DB-side to
// self-serve tiers only + `onboarded_at is null`.
export async function swapPlan(
  orgId: string,
  newPlanCode: string,
): Promise<ActionResult<null>> {
  const supabase = await createServerClient()
  const { error } = await supabase.rpc('swap_intake_plan', {
    p_org_id: orgId,
    p_new_plan_code: newPlanCode,
  })
  if (error) return { ok: false, error: error.message }
  return { ok: true, data: null }
}

export async function listTemplatesForSector(
  sector: string,
): Promise<
  ActionResult<
    Array<{
      template_code: string
      display_name: string
      description: string
      version: number
      purpose_count: number
    }>
  >
> {
  const supabase = await createServerClient()
  const { data, error } = await supabase.rpc(
    'list_sectoral_templates_for_sector',
    { p_sector: sector },
  )
  if (error) return { ok: false, error: error.message }

  type Raw = {
    template_code: string
    display_name: string
    description: string
    version: number
    purpose_definitions: unknown
  }
  const normalised = ((data ?? []) as Raw[]).map((r) => ({
    template_code: r.template_code,
    display_name: r.display_name,
    description: r.description,
    version: r.version,
    purpose_count: Array.isArray(r.purpose_definitions)
      ? r.purpose_definitions.length
      : 0,
  }))
  return { ok: true, data: normalised }
}
