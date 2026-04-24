import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { distinctSprints, getRunsBySprint } from '../../../data/runs'
import { RunCard } from '../../../components/run-card'

interface PageProps {
  params: Promise<{ id: string }>
}

export function generateStaticParams() {
  return distinctSprints().map((id) => ({ id }))
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { id } = await params
  return {
    title: `Sprint ${id} runs`,
    description: `All ConsentShield E2E runs that exercised ADR-1014 Sprint ${id}.`
  }
}

export default async function SprintPage({ params }: PageProps) {
  const { id } = await params
  if (!distinctSprints().includes(id)) notFound()
  const runs = getRunsBySprint(id)

  return (
    <>
      <p className="text-sm text-slate-500">
        <Link href="/" className="underline hover:text-ink">← All runs</Link>
      </p>
      <h1 className="mt-4 text-2xl font-bold text-navy">Sprint {id}</h1>
      <p className="mt-3 text-slate-700 max-w-2xl">
        {runs.length === 0
          ? `No runs tagged Sprint ${id} yet.`
          : `${runs.length} run${runs.length === 1 ? '' : 's'} exercised the Sprint ${id} deliverables.`}
      </p>
      <section className="mt-8 grid gap-4">
        {runs.map((run) => (
          <RunCard key={run.runId} run={run} />
        ))}
      </section>
    </>
  )
}
