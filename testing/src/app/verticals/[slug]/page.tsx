import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { distinctVerticals, getRunsByVertical } from '../../../data/runs'
import { RunCard } from '../../../components/run-card'

interface PageProps {
  params: Promise<{ slug: string }>
}

export function generateStaticParams() {
  return distinctVerticals().map((slug) => ({ slug }))
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug } = await params
  return {
    title: `${slug} runs`,
    description: `All ConsentShield E2E runs that exercised the ${slug} vertical demo.`
  }
}

export default async function VerticalPage({ params }: PageProps) {
  const { slug } = await params
  if (!distinctVerticals().includes(slug)) notFound()
  const runs = getRunsByVertical(slug)

  return (
    <>
      <p className="text-sm text-slate-500">
        <Link href="/" className="underline hover:text-ink">← All runs</Link>
      </p>
      <h1 className="mt-4 text-2xl font-bold text-navy">Vertical: {slug}</h1>
      <p className="mt-3 text-slate-700 max-w-2xl">
        {runs.length === 0
          ? `No runs tagged ${slug} yet.`
          : `${runs.length} run${runs.length === 1 ? '' : 's'} exercised the ${slug} demo site.`}
      </p>
      <section className="mt-8 grid gap-4">
        {runs.map((run) => (
          <RunCard key={run.runId} run={run} />
        ))}
      </section>
    </>
  )
}
