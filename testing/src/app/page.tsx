import {
  distinctPhases,
  distinctSprints,
  distinctVerticals,
  getAllRuns
} from '../data/runs'
import { ChipRow } from '../components/filter-chips'
import { RunCard } from '../components/run-card'

export default function Home() {
  const runs = getAllRuns()
  const verticals = distinctVerticals()
  const sprints = distinctSprints()
  const phases = distinctPhases()

  return (
    <>
      <section className="mb-10">
        <h1 className="text-3xl font-bold tracking-tight text-navy">Published runs</h1>
        <p className="mt-3 text-slate-700 max-w-2xl">
          Every ConsentShield end-to-end run deemed worth publishing — sorted newest first.
          Each row links to the sealed evidence archive (content-hashed, independently verifiable)
          plus the run's full manifest. If a row says <span className="font-semibold">Unexpected = 0</span>,
          the suite's positives landed and every sacrificial control inverted cleanly.
        </p>
        <p className="mt-3 text-slate-700 max-w-2xl">
          To reproduce any run against your own Supabase project, follow{' '}
          <a
            className="underline hover:text-ink"
            href="https://consentshield.in/docs/test-verification"
            target="_blank"
            rel="noopener noreferrer"
          >
            /docs/test-verification
          </a>{' '}
          on the ConsentShield marketing site.
        </p>
      </section>

      <section className="mb-8 flex flex-col gap-3">
        <ChipRow
          label="Phase"
          items={phases.map((p) => String(p))}
          hrefForItem={(p) => `/phases/${p}`}
          renderItem={(p) => `Phase ${p}`}
        />
        <ChipRow
          label="Sprint"
          items={sprints}
          hrefForItem={(s) => `/sprints/${s}`}
          renderItem={(s) => `Sprint ${s}`}
        />
        <ChipRow
          label="Vertical"
          items={verticals}
          hrefForItem={(v) => `/verticals/${v}`}
        />
      </section>

      {runs.length === 0 ? (
        <EmptyState />
      ) : (
        <section className="grid gap-4">
          {runs.map((run) => (
            <RunCard key={run.runId} run={run} />
          ))}
        </section>
      )}
    </>
  )
}

function EmptyState() {
  return (
    <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50 p-8 text-center">
      <h2 className="font-semibold text-ink">No runs published yet.</h2>
      <p className="mt-2 text-sm text-slate-700 max-w-xl mx-auto">
        New entries are appended to{' '}
        <code className="text-slate-900 bg-white border border-slate-200 rounded px-1 py-0.5">
          testing/src/data/runs.ts
        </code>{' '}
        and deployed automatically. Check back after the next CI cycle, or follow the RSS feed.
      </p>
    </div>
  )
}
