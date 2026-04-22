import { createClient } from '@supabase/supabase-js'

// ADR-1018 Sprint 1.3 — public read-only status page.
// Renders at https://app.consentshield.in/status (later aliased to
// https://status.consentshield.in via host-based rewrite per ADR-1018 Sprint 1.5).
//
// Reads public.status_subsystems + public.status_incidents via anon
// (both tables have anon-select RLS policies). No auth, no cookies, no
// analytics — intentionally minimal for public trust.

export const revalidate = 60 // ADR-1018 Sprint 1.3 — 60s edge cache.

type SubsystemState = 'operational' | 'degraded' | 'down' | 'maintenance'
type IncidentSeverity = 'sev1' | 'sev2' | 'sev3'
type IncidentStatus = 'investigating' | 'identified' | 'monitoring' | 'resolved'

interface SubsystemRow {
  slug:                   string
  display_name:           string
  description:            string | null
  current_state:          SubsystemState
  last_state_change_at:   string
  last_state_change_note: string | null
  sort_order:             number
}

interface IncidentRow {
  id:               string
  title:            string
  description:      string
  severity:         IncidentSeverity
  status:           IncidentStatus
  started_at:       string
  resolved_at:      string | null
  postmortem_url:   string | null
  last_update_note: string | null
}

async function fetchPublicStatus() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!url || !anon) {
    return { subsystems: [] as SubsystemRow[], incidents: [] as IncidentRow[], err: 'env_missing' }
  }
  const supabase = createClient(url, anon, { auth: { persistSession: false } })

  const [subsRes, incRes] = await Promise.all([
    supabase
      .from('status_subsystems')
      .select(
        'slug, display_name, description, current_state, last_state_change_at, last_state_change_note, sort_order',
      )
      .eq('is_public', true)
      .order('sort_order', { ascending: true }),
    supabase
      .from('status_incidents')
      .select(
        'id, title, description, severity, status, started_at, resolved_at, postmortem_url, last_update_note',
      )
      .gte('started_at', new Date(Date.now() - 90 * 24 * 3600 * 1000).toISOString())
      .order('started_at', { ascending: false })
      .limit(50),
  ])

  return {
    subsystems: (subsRes.data ?? []) as SubsystemRow[],
    incidents: (incRes.data ?? []) as IncidentRow[],
    err: subsRes.error?.message ?? incRes.error?.message ?? null,
  }
}

function overallState(subsystems: SubsystemRow[]): { label: string; tone: 'green' | 'amber' | 'red' | 'blue' } {
  if (subsystems.length === 0) return { label: 'No subsystems configured', tone: 'amber' }
  if (subsystems.some((s) => s.current_state === 'down')) return { label: 'Major outage', tone: 'red' }
  if (subsystems.some((s) => s.current_state === 'degraded')) return { label: 'Partial degradation', tone: 'amber' }
  if (subsystems.some((s) => s.current_state === 'maintenance')) return { label: 'Scheduled maintenance', tone: 'blue' }
  return { label: 'All systems operational', tone: 'green' }
}

const STATE_LABEL: Record<SubsystemState, string> = {
  operational: 'Operational',
  degraded:    'Degraded',
  down:        'Down',
  maintenance: 'Maintenance',
}

const STATE_DOT: Record<SubsystemState, string> = {
  operational: 'bg-emerald-500',
  degraded:    'bg-amber-500',
  down:        'bg-red-500',
  maintenance: 'bg-blue-500',
}

const BANNER_TONE = {
  green: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-900 dark:text-emerald-100',
  amber: 'border-amber-500/30 bg-amber-500/10 text-amber-900 dark:text-amber-100',
  red:   'border-red-500/30 bg-red-500/10 text-red-900 dark:text-red-100',
  blue:  'border-blue-500/30 bg-blue-500/10 text-blue-900 dark:text-blue-100',
}

export default async function PublicStatusPage() {
  const { subsystems, incidents, err } = await fetchPublicStatus()
  const open = incidents.filter((i) => i.status !== 'resolved')
  const resolved = incidents.filter((i) => i.status === 'resolved')
  const banner = overallState(subsystems)

  return (
    <main className="mx-auto max-w-3xl px-4 py-10 text-sm">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold">ConsentShield Status</h1>
        <p className="text-text-2">
          Public status surface for the ConsentShield platform. Operator-posted incidents + subsystem states. Refreshes every 60 seconds.
        </p>
      </header>

      {err ? (
        <div className="mb-4 rounded-md border border-red-500/30 bg-red-500/10 p-3 text-red-900 dark:text-red-100">
          Failed to load status: {err}
        </div>
      ) : null}

      <div
        aria-live="polite"
        className={`mb-6 rounded-md border p-4 text-base font-semibold ${BANNER_TONE[banner.tone]}`}
      >
        {banner.label}
      </div>

      <section className="mb-8">
        <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-text-2">Subsystems</h2>
        <ul className="divide-y divide-border rounded-md border border-border">
          {subsystems.map((s) => (
            <li key={s.slug} className="flex items-center gap-3 p-3">
              <span className={`inline-block h-2.5 w-2.5 flex-shrink-0 rounded-full ${STATE_DOT[s.current_state]}`} aria-hidden />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{s.display_name}</span>
                  <span className="text-xs text-text-2">{STATE_LABEL[s.current_state]}</span>
                </div>
                {s.description ? <p className="mt-0.5 text-xs text-text-2">{s.description}</p> : null}
              </div>
            </li>
          ))}
        </ul>
      </section>

      {open.length > 0 ? (
        <section className="mb-8">
          <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-text-2">Open incidents</h2>
          <ul className="space-y-2">
            {open.map((i) => (
              <li key={i.id} className="rounded-md border border-border p-3">
                <div className="mb-1 flex flex-wrap items-center gap-2">
                  <span className="font-medium">{i.title}</span>
                  <span className="rounded border border-border px-1.5 py-px text-[10px] uppercase tracking-wide">
                    {i.severity}
                  </span>
                  <span className="rounded border border-border px-1.5 py-px text-[10px] uppercase tracking-wide">
                    {i.status}
                  </span>
                </div>
                <p className="text-text-1">{i.description}</p>
                {i.last_update_note ? (
                  <p className="mt-1 text-xs text-text-2">
                    <span className="text-text-2">Latest update: </span>
                    {i.last_update_note}
                  </p>
                ) : null}
                <p className="mt-1 text-xs text-text-2">
                  Started {new Date(i.started_at).toLocaleString()}
                </p>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {resolved.length > 0 ? (
        <details className="mb-8 rounded-md border border-border p-3">
          <summary className="cursor-pointer text-xs font-semibold uppercase tracking-wide text-text-2">
            Recent history ({resolved.length} resolved in the last 90 days)
          </summary>
          <ul className="mt-3 space-y-2">
            {resolved.map((i) => (
              <li key={i.id} className="rounded border border-border p-2">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{i.title}</span>
                  <span className="rounded border border-border px-1.5 py-px text-[10px] uppercase tracking-wide">
                    {i.severity}
                  </span>
                </div>
                <p className="text-xs text-text-2">
                  Started {new Date(i.started_at).toLocaleString()} · resolved{' '}
                  {i.resolved_at ? new Date(i.resolved_at).toLocaleString() : '—'}
                  {i.postmortem_url ? (
                    <>
                      {' '}
                      ·{' '}
                      <a
                        href={i.postmortem_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="underline hover:text-text-1"
                      >
                        Postmortem
                      </a>
                    </>
                  ) : null}
                </p>
              </li>
            ))}
          </ul>
        </details>
      ) : null}

      <footer className="border-t border-border pt-4 text-xs text-text-2">
        Self-hosted status surface (ADR-1018). Read-only. For incident reports contact
        <a className="ml-1 underline hover:text-text-1" href="mailto:support@consentshield.in">
          support@consentshield.in
        </a>
        .
      </footer>
    </main>
  )
}
