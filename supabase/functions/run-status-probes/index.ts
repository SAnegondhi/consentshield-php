// Supabase Edge Function: run-status-probes
// ADR-1018 Sprint 1.4 — iterates public.status_subsystems, probes each
// health_url, records one status_checks row, and auto-flips
// status_subsystems.current_state when 3 consecutive failures accumulate.
// Scheduled every 5 minutes via pg_cron (see 20260804000015_status_probes_cron.sql).
//
// Never auto-modifies subsystems whose current_state is 'maintenance' —
// maintenance is an explicit operator override and must not be stomped.
// Recovery is eager: a single 'operational' check flips a degraded / down
// subsystem back to operational (ops teams generally want fast recovery
// signals; the last-3-ok debounce applies only to the failure direction).

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const ORCHESTRATOR_KEY = Deno.env.get('CS_ORCHESTRATOR_ROLE_KEY')
if (!ORCHESTRATOR_KEY) {
  throw new Error('CS_ORCHESTRATOR_ROLE_KEY is required.')
}

const PROBE_TIMEOUT_MS = 8_000
const DEGRADED_LATENCY_MS = 2_000
const CONSECUTIVE_FAIL_THRESHOLD = 3

type CheckStatus = 'operational' | 'degraded' | 'down' | 'error'
type SubsystemState = 'operational' | 'degraded' | 'down' | 'maintenance'

interface Subsystem {
  id: string
  slug: string
  health_url: string | null
  current_state: SubsystemState
}

interface CheckResult {
  subsystem_id: string
  status: CheckStatus
  latency_ms: number | null
  error_message: string | null
}

Deno.serve(async () => {
  const supabase = createClient(SUPABASE_URL, ORCHESTRATOR_KEY)
  const startedAt = new Date().toISOString()

  const { data: subsystems, error } = await supabase
    .from('status_subsystems')
    .select('id, slug, health_url, current_state')

  if (error) {
    return json({ ok: false, error: error.message }, 500)
  }

  const targets = (subsystems ?? []) as Subsystem[]
  const probable = targets.filter((s) => !!s.health_url)
  const skipped = targets.length - probable.length

  const results: CheckResult[] = await Promise.all(probable.map(probe))

  if (results.length > 0) {
    const { error: insertErr } = await supabase.from('status_checks').insert(
      results.map((r) => ({
        subsystem_id: r.subsystem_id,
        checked_at: startedAt,
        status: r.status,
        latency_ms: r.latency_ms,
        error_message: r.error_message,
        source_region: Deno.env.get('SB_REGION') ?? null,
      })),
    )
    if (insertErr) return json({ ok: false, error: insertErr.message }, 500)
  }

  // Per-subsystem state reconciliation. We read the last N checks for each
  // subsystem with a single query, group client-side.
  let flipped = 0
  for (const sub of probable) {
    if (sub.current_state === 'maintenance') continue

    const latest = results.find((r) => r.subsystem_id === sub.id)
    if (!latest) continue

    const desiredState = await reconcileState(supabase, sub, latest)
    if (desiredState !== sub.current_state) {
      const note =
        desiredState === 'operational'
          ? 'auto-recovered by probe'
          : `auto-flipped by probe — ${CONSECUTIVE_FAIL_THRESHOLD} consecutive ${desiredState}`
      const { error: updErr } = await supabase
        .from('status_subsystems')
        .update({
          current_state: desiredState,
          last_state_change_at: startedAt,
          last_state_change_note: note,
        })
        .eq('id', sub.id)
      if (updErr) {
        return json({ ok: false, error: updErr.message }, 500)
      }
      flipped += 1
    }
  }

  return json({
    ok: true,
    at: startedAt,
    probed: probable.length,
    skipped,
    flipped,
  })
})

async function reconcileState(
  supabase: ReturnType<typeof createClient>,
  sub: Subsystem,
  latest: CheckResult,
): Promise<SubsystemState> {
  // Eager recovery: the latest probe says operational → go operational
  // regardless of history.
  if (latest.status === 'operational') return 'operational'

  // Failure path — require 3 consecutive non-operational checks before
  // flipping an operational subsystem down. Errors and explicit 'down'
  // count as 'down' for the worst-of calculation.
  const { data, error } = await supabase
    .from('status_checks')
    .select('status')
    .eq('subsystem_id', sub.id)
    .order('checked_at', { ascending: false })
    .limit(CONSECUTIVE_FAIL_THRESHOLD)

  if (error || !data || data.length < CONSECUTIVE_FAIL_THRESHOLD) {
    return sub.current_state
  }

  const lastN = data.map((row) => row.status as CheckStatus)
  const allNonOk = lastN.every((s) => s !== 'operational')
  if (!allNonOk) return sub.current_state

  const severest: SubsystemState = lastN.some((s) => s === 'down' || s === 'error')
    ? 'down'
    : 'degraded'
  return severest
}

async function probe(sub: Subsystem): Promise<CheckResult> {
  const url = sub.health_url!
  const t0 = Date.now()
  try {
    const response = await fetch(url, {
      method: 'GET',
      redirect: 'follow',
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    })
    const latency = Date.now() - t0

    if (response.status >= 500) {
      return {
        subsystem_id: sub.id,
        status: 'down',
        latency_ms: latency,
        error_message: `http_${response.status}`,
      }
    }
    if (response.status >= 400) {
      return {
        subsystem_id: sub.id,
        status: 'degraded',
        latency_ms: latency,
        error_message: `http_${response.status}`,
      }
    }
    if (latency > DEGRADED_LATENCY_MS) {
      return {
        subsystem_id: sub.id,
        status: 'degraded',
        latency_ms: latency,
        error_message: `slow_response_${latency}ms`,
      }
    }
    return {
      subsystem_id: sub.id,
      status: 'operational',
      latency_ms: latency,
      error_message: null,
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'unknown'
    return {
      subsystem_id: sub.id,
      status: 'error',
      latency_ms: Date.now() - t0,
      error_message: msg.slice(0, 500),
    }
  }
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}
