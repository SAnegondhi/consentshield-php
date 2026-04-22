'use client'

import { useState, useTransition } from 'react'
import {
  setSubsystemStateAction,
  postIncidentAction,
  updateIncidentAction,
  resolveIncidentAction,
} from '@/app/(operator)/status/actions'

// ADR-1018 Sprint 1.2 — admin status-page panel.

export type SubsystemState = 'operational' | 'degraded' | 'down' | 'maintenance'
export type IncidentSeverity = 'sev1' | 'sev2' | 'sev3'
export type IncidentStatus = 'investigating' | 'identified' | 'monitoring' | 'resolved'

export interface StatusSubsystem {
  id:                     string
  slug:                   string
  display_name:           string
  description:            string | null
  current_state:          SubsystemState
  last_state_change_at:   string
  last_state_change_note: string | null
  sort_order:             number
  is_public:              boolean
}

export interface StatusIncident {
  id:                  string
  title:               string
  description:         string
  severity:            IncidentSeverity
  status:              IncidentStatus
  affected_subsystems: string[]
  started_at:          string
  identified_at:       string | null
  monitoring_at:       string | null
  resolved_at:         string | null
  postmortem_url:      string | null
  last_update_note:    string | null
  created_at:          string
  updated_at:          string
}

type AdminRole = 'platform_owner' | 'platform_operator' | 'support' | 'read_only'

const STATE_CLASS: Record<SubsystemState, string> = {
  operational: 'border-emerald-400/40 bg-emerald-500/15 text-emerald-200',
  degraded:    'border-amber-400/40 bg-amber-500/15 text-amber-200',
  down:        'border-red-400/40 bg-red-500/15 text-red-200',
  maintenance: 'border-blue-400/40 bg-blue-500/15 text-blue-200',
}

const INCIDENT_STATUS_CLASS: Record<IncidentStatus, string> = {
  investigating: 'border-red-400/40 bg-red-500/15 text-red-200',
  identified:    'border-amber-400/40 bg-amber-500/15 text-amber-200',
  monitoring:    'border-blue-400/40 bg-blue-500/15 text-blue-200',
  resolved:      'border-emerald-400/40 bg-emerald-500/15 text-emerald-200',
}

const SEVERITY_CLASS: Record<IncidentSeverity, string> = {
  sev1: 'border-red-400/40 bg-red-500/15 text-red-200',
  sev2: 'border-amber-400/40 bg-amber-500/15 text-amber-200',
  sev3: 'border-zinc-400/30 bg-zinc-500/10 text-zinc-300',
}

export function StatusPagePanel({
  subsystems,
  incidents,
  adminRole,
}: {
  subsystems: StatusSubsystem[]
  incidents: StatusIncident[]
  adminRole: AdminRole
}) {
  const canWrite =
    adminRole === 'platform_owner' ||
    adminRole === 'platform_operator' ||
    adminRole === 'support'

  const openIncidents = incidents.filter((i) => i.status !== 'resolved')
  const resolvedIncidents = incidents.filter((i) => i.status === 'resolved')

  return (
    <div className="space-y-6">
      <section>
        <h2 className="mb-2 text-[13px] font-semibold uppercase tracking-wide text-text-2">
          Subsystems
        </h2>
        <ul className="grid gap-2 md:grid-cols-2">
          {subsystems.map((s) => (
            <SubsystemCard key={s.id} subsystem={s} canWrite={canWrite} />
          ))}
        </ul>
      </section>

      <section>
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-[13px] font-semibold uppercase tracking-wide text-text-2">
            Open Incidents
          </h2>
          {canWrite ? <PostIncidentTrigger subsystems={subsystems} /> : null}
        </div>
        {openIncidents.length === 0 ? (
          <div className="rounded-md border border-white/10 bg-white/[.02] p-4 text-[13px] text-text-2">
            No open incidents.
          </div>
        ) : (
          <ul className="space-y-2">
            {openIncidents.map((i) => (
              <li key={i.id}>
                <IncidentCard incident={i} canWrite={canWrite} open />
              </li>
            ))}
          </ul>
        )}
      </section>

      {resolvedIncidents.length > 0 ? (
        <section>
          <h2 className="mb-2 text-[13px] font-semibold uppercase tracking-wide text-text-2">
            Recent History (resolved)
          </h2>
          <ul className="space-y-2">
            {resolvedIncidents.slice(0, 20).map((i) => (
              <li key={i.id}>
                <IncidentCard incident={i} canWrite={false} open={false} />
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  )
}

function SubsystemCard({
  subsystem,
  canWrite,
}: {
  subsystem: StatusSubsystem
  canWrite: boolean
}) {
  const [note, setNote] = useState('')
  const [err, setErr] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  function flip(state: SubsystemState) {
    setErr(null)
    startTransition(async () => {
      const r = await setSubsystemStateAction({
        slug: subsystem.slug,
        state,
        note: note.trim() || undefined,
      })
      if (!r.ok) setErr(r.error)
      else setNote('')
    })
  }

  return (
    <article className="rounded-md border border-white/[.08] bg-white/[.02] p-3">
      <div className="mb-1 flex items-center gap-2">
        <span className="mr-auto text-[13px] font-semibold text-white/90">
          {subsystem.display_name}
        </span>
        <span className={chip(STATE_CLASS[subsystem.current_state])}>
          {subsystem.current_state}
        </span>
      </div>
      {subsystem.description ? (
        <p className="mb-2 text-[11px] text-white/55">{subsystem.description}</p>
      ) : null}
      <p className="text-[11px] text-white/40">
        Last change {new Date(subsystem.last_state_change_at).toLocaleString()}
        {subsystem.last_state_change_note ? ` · ${subsystem.last_state_change_note}` : ''}
      </p>

      {canWrite ? (
        <div className="mt-2 border-t border-white/[.06] pt-2">
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Optional note"
            className="mb-1 w-full rounded border border-white/10 bg-white/[.03] px-2 py-1 text-[11px] text-white/90 placeholder:text-white/30 focus:border-white/25 focus:outline-none"
          />
          <div className="flex flex-wrap gap-1">
            {(['operational', 'degraded', 'down', 'maintenance'] as SubsystemState[]).map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => flip(s)}
                disabled={isPending || s === subsystem.current_state}
                className="rounded border border-white/10 bg-white/[.04] px-2 py-0.5 text-[10px] text-white/70 hover:bg-white/10 hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
              >
                {s}
              </button>
            ))}
          </div>
          {err ? <p className="mt-1 text-[11px] text-red-300">{err}</p> : null}
        </div>
      ) : null}
    </article>
  )
}

function PostIncidentTrigger({ subsystems }: { subsystems: StatusSubsystem[] }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded-md border border-white/10 bg-white/[.04] px-3 py-1.5 text-[12px] text-white/80 hover:bg-white/10 hover:text-white"
      >
        Post incident
      </button>
      {open ? <PostIncidentForm subsystems={subsystems} onClose={() => setOpen(false)} /> : null}
    </>
  )
}

function PostIncidentForm({
  subsystems,
  onClose,
}: {
  subsystems: StatusSubsystem[]
  onClose: () => void
}) {
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [severity, setSeverity] = useState<IncidentSeverity>('sev2')
  const [affected, setAffected] = useState<Set<string>>(new Set())
  const [err, setErr] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  function submit() {
    setErr(null)
    startTransition(async () => {
      const r = await postIncidentAction({
        title,
        description,
        severity,
        affectedSubsystemIds: Array.from(affected),
      })
      if (!r.ok) setErr(r.error)
      else onClose()
    })
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="w-full max-w-lg rounded-md border border-white/10 bg-navy-dark p-4">
        <h3 className="mb-3 text-[14px] font-semibold text-white/90">Post incident</h3>
        <label className="mb-2 block text-[11px] text-white/60">
          Title
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="mt-0.5 w-full rounded border border-white/10 bg-white/[.03] px-2 py-1 text-[12px] text-white/90 focus:border-white/25 focus:outline-none"
          />
        </label>
        <label className="mb-2 block text-[11px] text-white/60">
          Customer-facing description
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={3}
            className="mt-0.5 w-full rounded border border-white/10 bg-white/[.03] px-2 py-1 text-[12px] text-white/90 focus:border-white/25 focus:outline-none"
          />
        </label>
        <div className="mb-2 grid gap-2 sm:grid-cols-2">
          <label className="block text-[11px] text-white/60">
            Severity
            <select
              value={severity}
              onChange={(e) => setSeverity(e.target.value as IncidentSeverity)}
              className="mt-0.5 w-full rounded border border-white/10 bg-white/[.03] px-2 py-1 text-[12px] text-white/90 focus:border-white/25 focus:outline-none"
            >
              <option value="sev1">sev1 (customer-impacting outage)</option>
              <option value="sev2">sev2 (degraded or partial)</option>
              <option value="sev3">sev3 (informational / scheduled)</option>
            </select>
          </label>
        </div>
        <fieldset className="mb-3 rounded border border-white/10 bg-white/[.02] p-2">
          <legend className="px-1 text-[11px] text-white/60">Affected subsystems</legend>
          <div className="grid gap-1 sm:grid-cols-2">
            {subsystems.map((s) => (
              <label key={s.id} className="flex items-center gap-1 text-[12px] text-white/80">
                <input
                  type="checkbox"
                  checked={affected.has(s.id)}
                  onChange={(e) => {
                    const next = new Set(affected)
                    if (e.target.checked) next.add(s.id)
                    else next.delete(s.id)
                    setAffected(next)
                  }}
                />
                {s.display_name}
              </label>
            ))}
          </div>
        </fieldset>
        {err ? <p className="mb-2 text-[12px] text-red-300">{err}</p> : null}
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-white/10 bg-white/[.04] px-3 py-1.5 text-[12px] text-white/70 hover:bg-white/10 hover:text-white"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={isPending || !title.trim() || !description.trim()}
            className="rounded-md border border-white/10 bg-admin-accent/30 px-3 py-1.5 text-[12px] text-white hover:bg-admin-accent/50 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isPending ? 'Posting…' : 'Post'}
          </button>
        </div>
      </div>
    </div>
  )
}

function IncidentCard({
  incident,
  canWrite,
  open,
}: {
  incident: StatusIncident
  canWrite: boolean
  open: boolean
}) {
  const [note, setNote] = useState('')
  const [postmortemUrl, setPostmortemUrl] = useState(incident.postmortem_url ?? '')
  const [err, setErr] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  function progress(status: IncidentStatus) {
    setErr(null)
    startTransition(async () => {
      const r = await updateIncidentAction({
        incidentId: incident.id,
        newStatus: status,
        note: note.trim() || undefined,
      })
      if (!r.ok) setErr(r.error)
      else setNote('')
    })
  }

  function resolve() {
    setErr(null)
    startTransition(async () => {
      const r = await resolveIncidentAction({
        incidentId: incident.id,
        postmortemUrl: postmortemUrl.trim() || undefined,
        resolutionNote: note.trim() || undefined,
      })
      if (!r.ok) setErr(r.error)
      else setNote('')
    })
  }

  return (
    <article className="rounded-md border border-white/[.08] bg-white/[.02] p-3">
      <header className="mb-1 flex flex-wrap items-center gap-2">
        <span className="mr-auto text-[13px] font-semibold text-white/90">
          {incident.title}
        </span>
        <span className={chip(SEVERITY_CLASS[incident.severity])}>{incident.severity}</span>
        <span className={chip(INCIDENT_STATUS_CLASS[incident.status])}>
          {incident.status}
        </span>
      </header>
      <p className="mb-1 text-[12px] text-white/70">{incident.description}</p>
      <p className="text-[11px] text-white/45">
        Started {new Date(incident.started_at).toLocaleString()}
        {incident.resolved_at
          ? ` · resolved ${new Date(incident.resolved_at).toLocaleString()}`
          : ''}
      </p>
      {incident.last_update_note ? (
        <p className="mt-1 text-[11px] text-white/60">
          <span className="text-white/40">Latest note: </span>
          {incident.last_update_note}
        </p>
      ) : null}
      {incident.postmortem_url ? (
        <p className="mt-1 text-[11px]">
          <a
            className="text-teal-300 hover:text-teal-200"
            href={incident.postmortem_url}
            target="_blank"
            rel="noopener noreferrer"
          >
            Postmortem →
          </a>
        </p>
      ) : null}

      {canWrite && open ? (
        <div className="mt-2 border-t border-white/[.06] pt-2">
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Update note"
            rows={2}
            className="mb-1 w-full rounded border border-white/10 bg-white/[.03] px-2 py-1 text-[11px] text-white/90 placeholder:text-white/30 focus:border-white/25 focus:outline-none"
          />
          <input
            value={postmortemUrl}
            onChange={(e) => setPostmortemUrl(e.target.value)}
            placeholder="Postmortem URL (for resolve)"
            className="mb-2 w-full rounded border border-white/10 bg-white/[.03] px-2 py-1 text-[11px] text-white/90 placeholder:text-white/30 focus:border-white/25 focus:outline-none"
          />
          <div className="flex flex-wrap gap-1">
            {(['investigating', 'identified', 'monitoring'] as IncidentStatus[]).map(
              (s) =>
                s !== incident.status ? (
                  <button
                    key={s}
                    type="button"
                    onClick={() => progress(s)}
                    disabled={isPending}
                    className="rounded border border-white/10 bg-white/[.04] px-2 py-0.5 text-[10px] text-white/70 hover:bg-white/10 hover:text-white disabled:opacity-40"
                  >
                    {s}
                  </button>
                ) : null,
            )}
            <button
              type="button"
              onClick={resolve}
              disabled={isPending}
              className="rounded border border-emerald-400/30 bg-emerald-500/10 px-2 py-0.5 text-[10px] text-emerald-200 hover:bg-emerald-500/20 disabled:opacity-40"
            >
              Resolve
            </button>
          </div>
          {err ? <p className="mt-1 text-[11px] text-red-300">{err}</p> : null}
        </div>
      ) : null}
    </article>
  )
}

function chip(cls: string): string {
  return `rounded-[10px] border px-2 py-[1px] text-[10px] font-semibold uppercase tracking-wide ${cls}`
}
