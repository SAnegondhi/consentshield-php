// ADR-1014 Sprint 5.3 — Published-run index.
//
// Append-only catalogue of every E2E run deemed worth publishing on
// testing.consentshield.in. Reviewers trust this file because (a) every
// entry is a reviewable git commit, (b) every entry carries a SHA-256
// sealRoot that can be recomputed against the downloaded archive via
// `bunx tsx scripts/e2e-verify-evidence.ts`, and (c) the partner
// bootstrap lets them re-run the same configuration against their own
// Supabase project and compare outcomes.
//
// How to add a run:
//   1. Ship the sealed archive to R2 (or equivalent public host).
//   2. Append a PublishedRun literal below. Keep entries reverse-chrono.
//   3. Commit. CI deploys testing.consentshield.in with the new entry.
//
// No dynamic fetches. No R2 SDK. No ambient cloud reads. The file IS the
// index.

import type { PublishedRun } from './types'

const PUBLISHED_RUNS: PublishedRun[] = [
  {
    runId: '06EW0J6DWR37XMF841KD0D183W',
    date: '2026-04-25T16:16:03Z',
    commitSha: '02c330b6c3c5',
    branch: 'main',
    mutationScore: null,
    tally: {
      total: 8,
      expected: 8,
      unexpected: 0,
      skipped: 0,
      flaky: 0
    },
    status: 'green',
    browsers: ['chromium'],
    verticals: [],
    sprints: ['5.4'],
    phases: [5],
    archiveUrl: null,
    archiveSealRoot: '708d3df842469684',
    partnerReproduction: false,
    notes:
      'Sprint 5.4 sacrificial-controls gate dry-run. 8 controls inverted via test.fail(); every control reports expectedStatus=failed + actualStatus=failed + ok=true. Run-time evidence for the controls page.'
  }
]

export function getAllRuns(): PublishedRun[] {
  // Stable reverse-chrono sort. Ties resolved by runId ascending so the
  // order is deterministic across builds.
  return [...PUBLISHED_RUNS].sort((a, b) => {
    if (a.date !== b.date) return a.date < b.date ? 1 : -1
    return a.runId < b.runId ? -1 : 1
  })
}

export function getRunById(runId: string): PublishedRun | undefined {
  return PUBLISHED_RUNS.find((r) => r.runId === runId)
}

export function getRunsByVertical(slug: string): PublishedRun[] {
  return getAllRuns().filter((r) => r.verticals.some((v) => v === slug))
}

export function getRunsBySprint(sprintId: string): PublishedRun[] {
  return getAllRuns().filter((r) => r.sprints.includes(sprintId))
}

export function getRunsByPhase(phase: number): PublishedRun[] {
  return getAllRuns().filter((r) => r.phases.includes(phase))
}

export function distinctVerticals(): string[] {
  const s = new Set<string>()
  for (const r of getAllRuns()) r.verticals.forEach((v) => s.add(v))
  return [...s].sort()
}

export function distinctSprints(): string[] {
  const s = new Set<string>()
  for (const r of getAllRuns()) r.sprints.forEach((x) => s.add(x))
  return [...s].sort((a, b) => {
    const [aMaj, aMin] = a.split('.').map((n) => parseInt(n, 10))
    const [bMaj, bMin] = b.split('.').map((n) => parseInt(n, 10))
    if (aMaj !== bMaj) return aMaj - bMaj
    return aMin - bMin
  })
}

export function distinctPhases(): number[] {
  const s = new Set<number>()
  for (const r of getAllRuns()) r.phases.forEach((p) => s.add(p))
  return [...s].sort((a, b) => a - b)
}
