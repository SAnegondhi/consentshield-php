// Supabase Edge Function: check-cron-health
// ADR-0038 V2-O3 — daily cron failure watchdog.
//
// Reads public.cron_health_snapshot(24) — a SECURITY DEFINER wrapper over
// cron.job_run_details. For any job with failed_runs >= FAILURE_THRESHOLD
// in the lookback window, emits a single aggregated email + audit_log
// entry. Deduped via a 20-hour guard in audit_log so repeat daily runs
// don't spam.
//
// Runs as cs_orchestrator. Deployed with --no-verify-jwt per ADR-0021.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const ORCHESTRATOR_KEY = Deno.env.get('CS_ORCHESTRATOR_ROLE_KEY')
if (!ORCHESTRATOR_KEY) {
  throw new Error('CS_ORCHESTRATOR_ROLE_KEY is required')
}

const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY') ?? ''
const RESEND_FROM = Deno.env.get('RESEND_FROM') || 'onboarding@resend.dev'
const OPERATOR_EMAIL = Deno.env.get('OPERATOR_ALERT_EMAIL') || RESEND_FROM

const FAILURE_THRESHOLD = 3
const DEDUP_HOURS = 20
const LOOKBACK_HOURS = 24
const ALERT_KEY = 'cron-health:daily'

interface SnapshotRow {
  jobname: string
  total_runs: number
  failed_runs: number
  last_failure_at: string | null
}

interface AlertPayload {
  alert_key: string
  lookback_hours: number
  failing_jobs: Array<{
    jobname: string
    total_runs: number
    failed_runs: number
    last_failure_at: string | null
  }>
  summary: string
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') {
    return json({ error: 'method_not_allowed' }, 405)
  }

  const supabase = createClient(SUPABASE_URL, ORCHESTRATOR_KEY)

  const { data: snapshot, error } = await supabase.rpc('cron_health_snapshot', {
    p_lookback_hours: LOOKBACK_HOURS,
  })
  if (error) {
    console.error('[check-cron-health] snapshot error', error)
    return json({ error: error.message }, 500)
  }

  const rows = (snapshot ?? []) as SnapshotRow[]
  const failing = rows.filter((r) => Number(r.failed_runs) >= FAILURE_THRESHOLD)

  if (failing.length === 0) {
    return json({ status: 'healthy', jobs_inspected: rows.length }, 200)
  }

  // Dedup: skip if an operational_alert_emitted row with this key already
  // landed in the last DEDUP_HOURS.
  const dedupAfter = new Date(Date.now() - DEDUP_HOURS * 3_600_000).toISOString()
  const { data: recent } = await supabase
    .from('audit_log')
    .select('id')
    .eq('event_type', 'operational_alert_emitted')
    .gte('created_at', dedupAfter)
    .contains('payload', { alert_key: ALERT_KEY })
    .limit(1)

  if (recent && recent.length > 0) {
    return json({ status: 'deduped', failing_jobs: failing.length }, 200)
  }

  const payload: AlertPayload = {
    alert_key: ALERT_KEY,
    lookback_hours: LOOKBACK_HOURS,
    failing_jobs: failing.map((r) => ({
      jobname: r.jobname,
      total_runs: Number(r.total_runs),
      failed_runs: Number(r.failed_runs),
      last_failure_at: r.last_failure_at,
    })),
    summary: `${failing.length} cron job(s) with ≥${FAILURE_THRESHOLD} failures in the last ${LOOKBACK_HOURS}h.`,
  }

  // Write audit_log row. org_id is null because this is platform-level, not
  // org-scoped. The audit_log RLS allows service-role / orchestrator writes.
  // We use the platform-ops org convention: the first organisations row is
  // Sudhindra's. If that assumption changes, this needs revisiting. For dev,
  // org_id is required; use the bootstrap org.
  const { data: bootstrapOrg } = await supabase
    .from('organisations')
    .select('id')
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle()

  const { error: auditError } = await supabase.from('audit_log').insert({
    org_id: bootstrapOrg?.id ?? null,
    event_type: 'operational_alert_emitted',
    entity_type: 'cron',
    payload: payload as unknown as Record<string, unknown>,
  })
  if (auditError) {
    console.error('[check-cron-health] audit insert error', auditError)
  }

  if (RESEND_API_KEY) {
    const body = buildEmail(payload)
    const resp = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: RESEND_FROM,
        to: OPERATOR_EMAIL,
        subject: `[ConsentShield ops] ${failing.length} cron job(s) failing`,
        html: body,
      }),
    })
    if (!resp.ok) {
      console.error('[check-cron-health] resend error', resp.status, await resp.text())
    }
  } else {
    console.warn('[check-cron-health] RESEND_API_KEY missing — skipping email')
  }

  return json({ status: 'alerted', failing_jobs: failing.length }, 200)
})

function buildEmail(p: AlertPayload): string {
  const rows = p.failing_jobs
    .map(
      (f) =>
        `<tr><td style="padding:4px 12px;font-family:monospace">${escape(f.jobname)}</td><td>${f.failed_runs}/${f.total_runs}</td><td>${f.last_failure_at ? new Date(f.last_failure_at).toISOString() : ''}</td></tr>`,
    )
    .join('')
  return `
    <p>${escape(p.summary)}</p>
    <table cellpadding="4" style="border-collapse:collapse;font-size:13px">
      <thead><tr><th align="left">job</th><th align="left">failed/total</th><th align="left">last failure</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
    <p style="color:#555;font-size:12px">Inspect <code>cron.job_run_details</code> in the Supabase dashboard for raw output. Alert key: <code>${escape(p.alert_key)}</code>. Next alert possible after ${DEDUP_HOURS}h.</p>
  `
}

function escape(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    c === '&' ? '&amp;' : c === '<' ? '&lt;' : c === '>' ? '&gt;' : c === '"' ? '&quot;' : '&#39;',
  )
}

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}
