import { createServerClient } from '@/lib/supabase/server'
import { MetricTile } from '@/components/ops-dashboard/metric-tile'
import { KillSwitchesCard } from '@/components/ops-dashboard/kill-switches-card'
import { CronStatusCard } from '@/components/ops-dashboard/cron-status-card'
import { RecentActivityCard } from '@/components/ops-dashboard/recent-activity-card'
import { RefreshButton } from '@/components/ops-dashboard/refresh-button'

// ADR-0028 Sprint 2.1 — Operations Dashboard.
//
// Server Component. Reads admin.platform_metrics_daily (latest),
// admin.kill_switches, the cron snapshot RPC, and the last 10
// admin.admin_audit_log rows. The whole page re-renders when the
// Server Action refreshPlatformMetrics() revalidates /.

export const dynamic = 'force-dynamic'

interface PlatformMetrics {
  metric_date: string
  total_orgs: number
  active_orgs: number
  total_consents: number
  total_artefacts_active: number
  total_artefacts_revoked: number
  total_rights_requests_open: number
  rights_requests_breached: number
  worker_errors_24h: number
  delivery_buffer_max_age_min: number
  refreshed_at: string
}

interface KillSwitch {
  switch_key: string
  display_name: string
  description: string
  enabled: boolean
  reason: string | null
  set_at: string | null
}

interface CronJobSnapshot {
  jobname: string
  schedule: string
  active: boolean
  last_run_at: string | null
  last_status: string | null
  last_run_ago_seconds: number | null
}

interface AuditRowRaw {
  id: number
  occurred_at: string
  action: string
  reason: string
  admin_user_id: string
  target_table: string | null
  org_id: string | null
}

export default async function OperationsDashboard() {
  const supabase = await createServerClient()

  const [metricsRes, switchesRes, cronRes, auditRes] = await Promise.all([
    supabase
      .schema('admin')
      .from('platform_metrics_daily')
      .select('*')
      .order('metric_date', { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase
      .schema('admin')
      .from('kill_switches')
      .select('switch_key, display_name, description, enabled, reason, set_at')
      .order('switch_key'),
    supabase.rpc('admin_cron_snapshot'),
    supabase
      .schema('admin')
      .from('admin_audit_log')
      .select('id, occurred_at, action, reason, admin_user_id, target_table, org_id')
      .order('occurred_at', { ascending: false })
      .limit(10),
  ])

  const metrics = metricsRes.data as PlatformMetrics | null
  const switches = (switchesRes.data ?? []) as KillSwitch[]
  const cronJobs = (cronRes.data ?? []) as CronJobSnapshot[]
  const auditRows = (auditRes.data ?? []) as AuditRowRaw[]

  // Resolve display_name per unique admin_user_id in the audit slice.
  const adminIds = Array.from(new Set(auditRows.map((r) => r.admin_user_id)))
  const { data: adminUsers } =
    adminIds.length > 0
      ? await supabase
          .schema('admin')
          .from('admin_users')
          .select('id, display_name')
          .in('id', adminIds)
      : { data: [] as Array<{ id: string; display_name: string | null }> }

  const nameById = new Map(
    (adminUsers ?? []).map((u) => [u.id, u.display_name ?? null]),
  )

  const rowsWithNames = auditRows.map((r) => ({
    ...r,
    display_name: nameById.get(r.admin_user_id) ?? null,
  }))

  return (
    <div className="space-y-6">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Operations Dashboard</h1>
          <p className="text-xs text-text-3">
            {metrics
              ? `Refreshed ${new Date(metrics.refreshed_at).toLocaleString('en-IN', {
                  dateStyle: 'short',
                  timeStyle: 'short',
                })} · metric_date ${metrics.metric_date}`
              : 'No metrics row yet — click Refresh to compute.'}
          </p>
        </div>
        <RefreshButton />
      </header>

      <section className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-6">
        <MetricTile label="Total orgs" value={metrics?.total_orgs ?? 0} />
        <MetricTile
          label="Active (7d)"
          value={metrics?.active_orgs ?? 0}
          caption={
            metrics && metrics.total_orgs > 0
              ? `${Math.round((metrics.active_orgs / metrics.total_orgs) * 100)}% of total`
              : undefined
          }
        />
        <MetricTile label="Consents 24h" value={metrics?.total_consents ?? 0} />
        <MetricTile
          label="Artefacts active"
          value={formatLarge(metrics?.total_artefacts_active ?? 0)}
          caption="DEPA model"
        />
        <MetricTile
          label="Rights open"
          value={metrics?.total_rights_requests_open ?? 0}
          caption={
            metrics && metrics.rights_requests_breached > 0
              ? `${metrics.rights_requests_breached} SLA-breached`
              : 'no SLA breaches'
          }
          tone={metrics && metrics.rights_requests_breached > 0 ? 'red' : 'default'}
        />
        <MetricTile
          label="Worker errors 24h"
          value={metrics?.worker_errors_24h ?? 0}
          tone={metrics && metrics.worker_errors_24h === 0 ? 'green' : 'amber'}
        />
      </section>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <CronStatusCard jobs={cronJobs} />
        </div>
        <div className="space-y-6">
          <KillSwitchesCard switches={switches} />
          <RecentActivityCard rows={rowsWithNames} />
        </div>
      </div>
    </div>
  )
}

function formatLarge(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`
  return String(n)
}
