import { createServerClient } from '@/lib/supabase/server'
import { ReadinessList, type ReadinessFlag } from '@/components/readiness/readiness-list'

// ADR-1017 Sprint 1.2 — Ops Readiness page.
//
// Surfaces pending external / organisational blockers (legal counsel,
// partner engagement, infra provisioning, contract drafts, hiring
// decisions) so operators can't forget them between ADR sprint
// handoffs. Reads admin.ops_readiness_flags via the
// admin.list_ops_readiness_flags() RPC.

export const dynamic = 'force-dynamic'

export default async function ReadinessPage() {
  const supabase = await createServerClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()

  const adminRole =
    (user?.app_metadata?.admin_role as
      | 'platform_owner'
      | 'platform_operator'
      | 'support'
      | 'read_only'
      | undefined) ?? 'read_only'

  const { data, error } = await supabase
    .schema('admin')
    .rpc('list_ops_readiness_flags')

  const flags: ReadinessFlag[] = (data as ReadinessFlag[] | null) ?? []

  const pendingCount = flags.filter(
    (f) => f.status === 'pending' || f.status === 'in_progress',
  ).length
  const criticalPending = flags.filter(
    (f) =>
      (f.status === 'pending' || f.status === 'in_progress') &&
      (f.severity === 'critical' || f.severity === 'high'),
  ).length

  return (
    <div className="mx-auto max-w-5xl space-y-4">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">Ops Readiness</h1>
          <p className="text-sm text-text-2">
            External / organisational blockers tracked from ADR sprint backlogs.
            Resolving requires platform_operator or platform_owner role.
          </p>
        </div>
        <div className="flex gap-2 text-[12px]">
          <span className="rounded-md border border-white/10 bg-white/[.04] px-2 py-1">
            {pendingCount} open
          </span>
          {criticalPending > 0 ? (
            <span className="rounded-md border border-red-400/30 bg-red-500/10 px-2 py-1 text-red-200">
              {criticalPending} high/critical
            </span>
          ) : null}
        </div>
      </header>

      {error ? (
        <div className="rounded-md border border-red-400/30 bg-red-500/10 p-3 text-[13px] text-red-200">
          Failed to load readiness flags: {error.message}
        </div>
      ) : null}

      <ReadinessList flags={flags} adminRole={adminRole} />
    </div>
  )
}
