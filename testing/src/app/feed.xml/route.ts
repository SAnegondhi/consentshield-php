import { getAllRuns } from '../../data/runs'
import { formatDateTime, type PublishedRun } from '../../data/types'

// ADR-1014 Sprint 5.3 — RSS 2.0 feed.
//
// Hand-rolled XML (Rule 15 — no new deps). Every published run is one
// <item>. Link goes to the run's full page; enclosure points at the
// sealed archive when available.

export const dynamic = 'force-static'
export const revalidate = false

const SITE = 'https://testing.consentshield.in'

function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

function itemFor(run: PublishedRun): string {
  const link = `${SITE}/runs/${run.runId}`
  const title = `${run.branch} · ${run.commitSha} · ${run.status.toUpperCase()}`
  const pubDate = new Date(run.date).toUTCString()
  const descriptionLines = [
    `Run ${run.runId} against commit ${run.commitSha}.`,
    `Tally: total=${run.tally.total}, expected=${run.tally.expected}, unexpected=${run.tally.unexpected}, flaky=${run.tally.flaky}.`,
    run.mutationScore === null
      ? 'Mutation score: not yet measured (Phase 4 pending).'
      : `Mutation score: ${run.mutationScore}%.`,
    run.notes ?? ''
  ]
    .filter((l) => l.length > 0)
    .join(' ')

  const enclosure =
    run.archiveUrl !== null
      ? `<enclosure url="${escapeXml(run.archiveUrl)}" type="application/zip" />`
      : ''

  return [
    '    <item>',
    `      <title>${escapeXml(title)}</title>`,
    `      <link>${escapeXml(link)}</link>`,
    `      <guid isPermaLink="true">${escapeXml(link)}</guid>`,
    `      <pubDate>${pubDate}</pubDate>`,
    `      <description>${escapeXml(descriptionLines)}</description>`,
    enclosure.length > 0 ? `      ${enclosure}` : null,
    '    </item>'
  ]
    .filter((l): l is string => l !== null)
    .join('\n')
}

export function GET(): Response {
  const runs = getAllRuns()
  const lastBuildDate = runs.length > 0 ? new Date(runs[0].date).toUTCString() : new Date().toUTCString()

  const xml = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<rss version="2.0">',
    '  <channel>',
    '    <title>ConsentShield — Published test runs</title>',
    `    <link>${SITE}</link>`,
    '    <description>Every ConsentShield end-to-end test run deemed worth publishing — date, commit, pass/fail counts, mutation score, sealed-evidence archives.</description>',
    '    <language>en-US</language>',
    `    <lastBuildDate>${lastBuildDate}</lastBuildDate>`,
    `    <atom:link xmlns:atom="http://www.w3.org/2005/Atom" href="${SITE}/feed.xml" rel="self" type="application/rss+xml" />`,
    ...runs.map(itemFor),
    '  </channel>',
    '</rss>'
  ].join('\n')

  return new Response(xml, {
    headers: {
      'Content-Type': 'application/rss+xml; charset=utf-8',
      'Cache-Control': 'public, max-age=600'
    }
  })
}
