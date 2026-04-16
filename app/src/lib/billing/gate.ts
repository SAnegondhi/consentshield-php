import type { SupabaseClient } from '@supabase/supabase-js'
import { PLANS, type PlanId } from './plans'

type Resource = 'web_properties' | 'deletion_connectors'

/**
 * Check if the org is allowed to create one more of `resource`.
 * Caller passes an authenticated SupabaseClient (the user must be a member
 * of `orgId`); membership is enforced inside rpc_plan_limit_check.
 */
export async function checkPlanLimit(
  supabase: SupabaseClient,
  orgId: string,
  resource: Resource,
): Promise<{ allowed: true } | { allowed: false; limit: number; current: number; plan: string }> {
  const { data, error } = await supabase.rpc('rpc_plan_limit_check', {
    p_org_id: orgId,
    p_resource: resource,
  })
  if (error) throw new Error(`plan check failed: ${error.message}`)

  const envelope = data as { plan: string; current: number }
  const planId = (envelope.plan ?? 'trial') as PlanId
  const plan = PLANS[planId] ?? PLANS.trial
  const limit = plan.limits[resource]

  if (limit === null) return { allowed: true }
  if ((envelope.current ?? 0) >= limit) {
    return { allowed: false, limit, current: envelope.current ?? 0, plan: planId }
  }
  return { allowed: true }
}
