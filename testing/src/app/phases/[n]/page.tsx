import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { distinctPhases, getRunsByPhase } from '../../../data/runs'
import { RunCard } from '../../../components/run-card'

interface PageProps {
  params: Promise<{ n: string }>
}

export function generateStaticParams() {
  return distinctPhases().map((p) => ({ n: String(p) }))
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { n } = await params
  return {
    title: `Phase ${n} runs`,
    description: `All ConsentShield E2E runs that exercised ADR-1014 Phase ${n}.`
  }
}

export default async function PhasePage({ params }: PageProps) {
  const { n } = await params
  const phaseNum = parseInt(n, 10)
  if (!Number.isFinite(phaseNum) || !distinctPhases().includes(phaseNum)) notFound()
  const runs = getRunsByPhase(phaseNum)

  return (
    <>
      <p className="text-sm text-slate-500">
        <Link href="/" className="underline hover:text-ink">← All runs</Link>
      </p>
      <h1 className="mt-4 text-2xl font-bold text-navy">Phase {phaseNum}</h1>
      <p className="mt-3 text-slate-700 max-w-2xl">
        {runs.length === 0
          ? `No runs tagged Phase ${phaseNum} yet.`
          : `${runs.length} run${runs.length === 1 ? '' : 's'} exercised Phase ${phaseNum} deliverables.`}
      </p>
      <section className="mt-8 grid gap-4">
        {runs.map((run) => (
          <RunCard key={run.runId} run={run} />
        ))}
      </section>
    </>
  )
}
