import { createServerClient } from '@/lib/supabase/server'
import {
  StatusPagePanel,
  type StatusSubsystem,
  type StatusIncident,
} from '@/components/status/status-panel'

// ADR-1018 Sprint 1.2 — self-hosted status page admin panel.
// Reads public.status_subsystems + public.status_incidents and lets
// operators flip subsystem state + post/update/resolve incidents via the
// admin RPCs.

export const dynamic = 'force-dynamic'

export default async function StatusAdminPage() {
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

  const [subsRes, incRes] = await Promise.all([
    supabase
      .from('status_subsystems')
      .select('id, slug, display_name, description, current_state, last_state_change_at, last_state_change_note, sort_order, is_public')
      .order('sort_order', { ascending: true }),
    supabase
      .from('status_incidents')
      .select('id, title, description, severity, status, affected_subsystems, started_at, identified_at, monitoring_at, resolved_at, postmortem_url, last_update_note, created_at, updated_at')
      .order('started_at', { ascending: false })
      .limit(50),
  ])

  const subsystems: StatusSubsystem[] = (subsRes.data ?? []) as StatusSubsystem[]
  const incidents: StatusIncident[] = (incRes.data ?? []) as StatusIncident[]

  return (
    <div className="mx-auto max-w-5xl space-y-4">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">Status Page</h1>
          <p className="text-sm text-text-2">
            Self-hosted status surface (ADR-1018). Subsystem states flip manually here
            or automatically via the probe cron (Sprint 1.4 — not yet live).
          </p>
        </div>
      </header>
      {subsRes.error ? (
        <div className="rounded-md border border-red-400/30 bg-red-500/10 p-3 text-[13px] text-red-200">
          Failed to load subsystems: {subsRes.error.message}
        </div>
      ) : null}
      <StatusPagePanel subsystems={subsystems} incidents={incidents} adminRole={adminRole} />
    </div>
  )
}
