import Link from 'next/link'
import { StatusPill } from './status-pill'
import { formatDate, type PublishedRun } from '../data/types'

export function RunCard({ run }: { run: PublishedRun }) {
  return (
    <Link
      href={`/runs/${run.runId}`}
      className="block rounded-lg border border-slate-200 bg-white p-5 hover:border-slate-400 transition-colors"
    >
      <div className="flex items-start justify-between gap-4 mb-3">
        <div>
          <div className="font-mono text-sm text-slate-500">{formatDate(run.date)}</div>
          <div className="font-semibold text-ink mt-1">
            {run.branch} · <span className="font-mono">{run.commitSha}</span>
          </div>
        </div>
        <div className="flex flex-col items-end gap-2">
          <StatusPill status={run.status} />
          {run.partnerReproduction ? (
            <span className="inline-flex items-center rounded border border-slate-300 bg-slate-50 px-2 py-0.5 text-xs text-slate-700">
              Partner reproduction
            </span>
          ) : null}
        </div>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
        <Tally label="Total" value={run.tally.total} />
        <Tally label="Expected" value={run.tally.expected} accent="text-emerald-700" />
        <Tally label="Unexpected" value={run.tally.unexpected} accent={run.tally.unexpected > 0 ? 'text-red-700' : 'text-slate-500'} />
        <Tally label="Mutation" value={run.mutationScore === null ? '—' : `${run.mutationScore}%`} />
      </div>
      {run.sprints.length > 0 || run.verticals.length > 0 ? (
        <div className="mt-4 flex flex-wrap gap-1.5 text-xs">
          {run.sprints.map((s) => (
            <span key={`s-${s}`} className="inline-flex items-center rounded border border-slate-200 bg-slate-50 px-1.5 py-0.5 text-slate-700">
              Sprint {s}
            </span>
          ))}
          {run.verticals.map((v) => (
            <span key={`v-${v}`} className="inline-flex items-center rounded border border-teal/30 bg-teal-light px-1.5 py-0.5 text-teal">
              {v}
            </span>
          ))}
        </div>
      ) : null}
      {run.notes ? <p className="mt-4 text-sm text-slate-700 line-clamp-2">{run.notes}</p> : null}
    </Link>
  )
}

function Tally({ label, value, accent }: { label: string; value: number | string; accent?: string }) {
  return (
    <div>
      <div className="text-xs text-slate-500 uppercase tracking-wider">{label}</div>
      <div className={`font-mono font-semibold ${accent ?? 'text-ink'}`}>{value}</div>
    </div>
  )
}
