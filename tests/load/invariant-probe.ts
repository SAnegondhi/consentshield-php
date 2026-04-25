// ADR-1003 Sprint 3.2 — buffer-row invariant probe.
// (c) 2026 Sudhindra Anegondhi a.d.sudhindra@gmail.com
//
// Polls the five buffer tables every 5 seconds for a target org and
// records the maximum row count observed during the run. Pass
// criterion: max ≤ 5 (transient buffer rows during in-flight delivery
// are acceptable; sustained accumulation is a violation).
//
// Run alongside the k6 scenario:
//   ORG_ID=<uuid> bun run tests/load/invariant-probe.ts
//
// Outputs JSON to stdout every poll (machine-greppable). Final summary
// goes to stderr after SIGINT or DURATION_S env elapses.
//
// Reads SUPABASE_CS_ORCHESTRATOR_DATABASE_URL from the environment.
// cs_orchestrator has SELECT on all five tables (buffer-table grant
// from migration 20260413000010_scoped_roles.sql).

import postgres from 'postgres'

const ORG_ID = process.env.ORG_ID
if (!ORG_ID) {
  console.error('Missing ORG_ID env var')
  process.exit(1)
}

const DSN =
  process.env.SUPABASE_CS_ORCHESTRATOR_DATABASE_URL ||
  process.env.SUPABASE_CS_API_DATABASE_URL
if (!DSN) {
  console.error(
    'Missing SUPABASE_CS_ORCHESTRATOR_DATABASE_URL (or SUPABASE_CS_API_DATABASE_URL)',
  )
  process.exit(1)
}

const POLL_INTERVAL_MS = parseInt(process.env.POLL_INTERVAL_MS || '5000', 10)
const DURATION_S = parseInt(process.env.DURATION_S || '0', 10) // 0 = run forever
const PASS_THRESHOLD = parseInt(process.env.PASS_THRESHOLD || '5', 10)

const sql = postgres(DSN, {
  prepare: false,
  max: 2,
  idle_timeout: 5,
  connect_timeout: 10,
  ssl: 'require',
})

const BUFFER_TABLES = [
  'consent_events',
  'tracker_observations',
  'audit_log',
  'processing_log',
  'delivery_buffer',
] as const

interface Sample {
  ts: string
  org_id: string
  total: number
  per_table: Record<string, number>
}

let maxObserved = 0
let maxSample: Sample | null = null
let samples = 0

async function poll(): Promise<Sample> {
  const perTable: Record<string, number> = {}
  let total = 0

  for (const table of BUFFER_TABLES) {
    // Each table is queried separately rather than as a UNION ALL so
    // a missing-row-count from any individual table is still surfaced
    // (and the org_id index is per-table). Cost: 5 round-trips per
    // poll; at 5s interval that's 1 query/sec — negligible.
    const rows = (await sql.unsafe(
      `select count(*)::bigint as c from public.${table} where org_id = $1`,
      [ORG_ID!],
    )) as Array<{ c: string }>
    const c = parseInt(rows[0].c, 10)
    perTable[table] = c
    total += c
  }

  const sample: Sample = {
    ts: new Date().toISOString(),
    org_id: ORG_ID!,
    total,
    per_table: perTable,
  }

  if (total > maxObserved) {
    maxObserved = total
    maxSample = sample
  }
  samples += 1
  return sample
}

async function main() {
  console.error(
    `[invariant-probe] org=${ORG_ID} poll_ms=${POLL_INTERVAL_MS} threshold=${PASS_THRESHOLD} duration_s=${DURATION_S || 'unbounded'}`,
  )

  const start = Date.now()
  const stopAt = DURATION_S > 0 ? start + DURATION_S * 1000 : Infinity

  let stopped = false
  process.on('SIGINT', () => {
    stopped = true
  })
  process.on('SIGTERM', () => {
    stopped = true
  })

  while (!stopped && Date.now() < stopAt) {
    const sample = await poll()
    process.stdout.write(JSON.stringify(sample) + '\n')
    if (sample.total > PASS_THRESHOLD) {
      console.error(
        `[invariant-probe] WARN: total=${sample.total} > threshold=${PASS_THRESHOLD} at ${sample.ts}`,
      )
    }
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS))
  }

  // Summary on stderr.
  const verdict = maxObserved <= PASS_THRESHOLD ? 'PASS' : 'FAIL'
  console.error(
    `\n[invariant-probe] === SUMMARY ===\n` +
      `  org_id:        ${ORG_ID}\n` +
      `  samples:       ${samples}\n` +
      `  duration_s:    ${((Date.now() - start) / 1000).toFixed(1)}\n` +
      `  max_observed:  ${maxObserved}\n` +
      `  threshold:     ${PASS_THRESHOLD}\n` +
      `  verdict:       ${verdict}\n` +
      (maxSample
        ? `  worst_sample:  ${JSON.stringify(maxSample)}\n`
        : ''),
  )

  await sql.end()
  process.exit(verdict === 'PASS' ? 0 : 1)
}

main().catch((e) => {
  console.error('[invariant-probe] fatal:', e)
  process.exit(2)
})
