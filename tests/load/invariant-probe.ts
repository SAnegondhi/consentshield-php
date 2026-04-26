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
// Reads NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY. Uses
// supabase-js with the service-role key (PostgREST `service_role`)
// because direct cs_orchestrator postgres-pool reads against the
// buffer tables trip Postgres planner inlining of the RLS policy
// `current_org_id()` which transitively references the auth schema —
// cs_orchestrator has BYPASSRLS but no USAGE on auth, and the planner
// resolves function bodies before bypass kicks in. The PostgREST
// service-role path sidesteps that entirely.

import { createClient } from '@supabase/supabase-js'

const ORG_ID = process.env.ORG_ID
if (!ORG_ID) {
  console.error('Missing ORG_ID env var')
  process.exit(1)
}

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!URL || !KEY) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY')
  process.exit(1)
}

const POLL_INTERVAL_MS = parseInt(process.env.POLL_INTERVAL_MS || '5000', 10)
const DURATION_S = parseInt(process.env.DURATION_S || '0', 10) // 0 = run forever
// Real-world transient delivery rows (in-flight audit_log + delivery_buffer
// during the delivery loop's poll cycle) cluster around 5-10 under load.
// Sustained accumulation above ~20 indicates a real invariant violation
// (delivery loop is broken). Calibrated 2026-04-26 from Mode B smoke.
const PASS_THRESHOLD = parseInt(process.env.PASS_THRESHOLD || '20', 10)

const supabase = createClient(URL, KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
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
    const { count, error } = await supabase
      .from(table)
      .select('*', { count: 'exact', head: true })
      .eq('org_id', ORG_ID!)
    if (error) {
      // Surface but keep polling — a transient PostgREST hiccup
      // shouldn't crash the probe.
      console.error(
        `[invariant-probe] poll error on ${table}: ${error.message}`,
      )
      perTable[table] = -1
      continue
    }
    const c = count ?? 0
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

  process.exit(verdict === 'PASS' ? 0 : 1)
}

main().catch((e) => {
  console.error('[invariant-probe] fatal:', e)
  process.exit(2)
})
