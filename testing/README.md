# `@consentshield/testing` — public run index (ADR-1014 Sprint 5.3)

**Deployed at:** `testing.consentshield.in`
**Purpose:** auditor-facing public index of every ConsentShield E2E run deemed worth publishing.

Dedicated Vercel project — isolated from `marketing` / `app` / `admin` — so outages here don't affect production integrations and vice versa.

## Local dev

```bash
cd testing
bun install   # picks up the workspace
bun run dev   # http://localhost:3003
```

## Publishing a run

Runs are author-committed to `src/data/runs.ts`. No dynamic data source, no ambient cloud reads, no R2 SDK — the file IS the index. Every entry is a reviewable git commit; the PR diff is the publication record.

```ts
// src/data/runs.ts
const PUBLISHED_RUNS: PublishedRun[] = [
  {
    runId: '06EW0J6DWR37XMF841KD0D183W',
    date: '2026-04-25T16:16:03Z',
    commitSha: '02c330b6c3c5',
    branch: 'main',
    mutationScore: null,     // null until Phase 4 ships
    tally: { total: 8, expected: 8, unexpected: 0, skipped: 0, flaky: 0 },
    status: 'green',
    browsers: ['chromium'],
    verticals: [],            // 'ecommerce' | 'healthcare' | 'bfsi'
    sprints: ['5.4'],
    phases: [5],
    archiveUrl: null,         // null until the sealed archive is uploaded
    archiveSealRoot: '708d3df842469684',
    partnerReproduction: false,
    notes: 'Sprint 5.4 sacrificial-controls gate dry-run.'
  },
  // prepend newer runs at the top (getAllRuns() sorts, but keeping the
  // file reverse-chrono is the review-friendly convention)
]
```

Entries stay visible even without an archive URL — reviewers see the run happened; the "Download sealed archive" button is disabled until upload.

## Routes

| Route | Rendered |
|---|---|
| `/` | Reverse-chrono list + filter chips (Phase / Sprint / Vertical) |
| `/runs/[runId]` | Full manifest summary + archive download + verify CLI + reproduce runbook link |
| `/verticals/[slug]` | Runs tagged with a specific vertical (`ecommerce` / `healthcare` / `bfsi`) |
| `/sprints/[id]` | Runs that exercised a specific ADR-1014 sprint |
| `/phases/[n]` | Runs that exercised a specific ADR-1014 phase (1..5) |
| `/feed.xml` | RSS 2.0 feed — one `<item>` per run |
| `/about` | What this site is + how to trust a published run |
| `/robots.txt` | Allow-all |

All routes prerender statically at build time. There is no server-side rendering, no API route, and no runtime data access. Deployments to Vercel are static-asset-only.

## Verifying an archive

```bash
bunx tsx scripts/e2e-verify-evidence.ts path/to/extracted/archive
```

Exit 0 = every file hash matches the ledger AND the root SHA-256 matches the seal (Sprint 1.4 evidence reporter). Exit 1 = tampered. Exit 2 = IO / usage error.

## Operator — first-time deployment

This workspace has never been deployed. Vercel project provisioning is an operator action:

1. `vercel login` (if not already).
2. `cd testing && vercel link` — create a new Vercel project named `consentshield-testing`. **Do NOT link to an existing project.**
3. Set the production domain to `testing.consentshield.in`. DNS CNAME to the Vercel-issued `<project>.vercel.app` host.
4. Environment variables: none required for v1. The site reads only the git-tracked `src/data/runs.ts`.
5. `vercel deploy --prebuilt` once `bun run build` locally produces a clean `.next/`.

The ADR-1014 Sprint 5.3 body tracks these as the operator-action checklist.

## Non-goals (explicitly)

- **No dynamic data source.** Partners should be able to trust what they see; a DB-backed index would require trusting the DB, which is a fresh attack surface.
- **No authentication.** The index is public by design. Archive URLs point at sealed, content-hashed zips whose integrity partners verify locally.
- **No search.** Filters (phase / sprint / vertical) cover the scopes reviewers care about. Full-text search would need either a dep or an API — both rejected.
