// Supabase Edge Function: check-stuck-buffers
// ADR-0038 V2-O1.a — hourly stuck-buffer alerting.
//
// Re-wires the orphaned stuck-buffer-detection-hourly cron that was
// scheduled originally in ADR-0011 and unscheduled in migration
// 20260416000004 because this Edge Function never existed.
//
// Calls detect_stuck_buffers() RPC (ADR-0011 / ADR-0020 Sprint 1.1
// extended for artefact_revocations). For any buffer table with
// stuck_count > 0, emits one aggregated email + audit_log row. Dedup
// guard caps alert frequency to once per 20 hours per alert class.
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

const DEDUP_HOURS = 20
const ALERT_KEY = 'stuck-buffers:hourly'

interface StuckRow {
  buffer_table: string
  stuck_count: number
  oldest_created: string | null
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') {
    return json({ error: 'method_not_allowed' }, 405)
  }

  const supabase = createClient(SUPABASE_URL, ORCHESTRATOR_KEY)

  const { data, error } = await supabase.rpc('detect_stuck_buffers')
  if (error) {
    console.error('[check-stuck-buffers] rpc error', error)
    return json({ error: error.message }, 500)
  }

  const rows = (data ?? []) as StuckRow[]
  const stuck = rows.filter((r) => Number(r.stuck_count) > 0)

  if (stuck.length === 0) {
    return json({ status: 'healthy', tables_inspected: rows.length }, 200)
  }

  // Dedup guard.
  const dedupAfter = new Date(Date.now() - DEDUP_HOURS * 3_600_000).toISOString()
  const { data: recent } = await supabase
    .from('audit_log')
    .select('id')
    .eq('event_type', 'operational_alert_emitted')
    .gte('created_at', dedupAfter)
    .contains('payload', { alert_key: ALERT_KEY })
    .limit(1)
  if (recent && recent.length > 0) {
    return json({ status: 'deduped', stuck_tables: stuck.length }, 200)
  }

  const summary = stuck
    .map((s) => `${s.buffer_table}: ${s.stuck_count}`)
    .join(', ')

  const { data: bootstrapOrg } = await supabase
    .from('organisations')
    .select('id')
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle()

  const { error: auditError } = await supabase.from('audit_log').insert({
    org_id: bootstrapOrg?.id ?? null,
    event_type: 'operational_alert_emitted',
    entity_type: 'buffer',
    payload: {
      alert_key: ALERT_KEY,
      stuck_tables: stuck.map((s) => ({
        table: s.buffer_table,
        stuck_count: Number(s.stuck_count),
        oldest_created: s.oldest_created,
      })),
      summary: `Stuck buffers: ${summary}`,
    },
  })
  if (auditError) {
    console.error('[check-stuck-buffers] audit insert error', auditError)
  }

  if (RESEND_API_KEY) {
    const body = buildEmail(stuck)
    const resp = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: RESEND_FROM,
        to: OPERATOR_EMAIL,
        subject: `[ConsentShield ops] ${stuck.length} buffer(s) stuck`,
        html: body,
      }),
    })
    if (!resp.ok) {
      console.error('[check-stuck-buffers] resend error', resp.status, await resp.text())
    }
  } else {
    console.warn('[check-stuck-buffers] RESEND_API_KEY missing — skipping email')
  }

  return json({ status: 'alerted', stuck_tables: stuck.length }, 200)
})

function buildEmail(stuck: StuckRow[]): string {
  const rows = stuck
    .map(
      (s) =>
        `<tr><td style="padding:4px 12px;font-family:monospace">${escape(s.buffer_table)}</td><td>${Number(s.stuck_count)}</td><td>${s.oldest_created ? new Date(s.oldest_created).toISOString() : ''}</td></tr>`,
    )
    .join('')
  return `
    <p>One or more buffer tables have rows older than 1 hour with <code>delivered_at IS NULL</code>. The delivery pipeline may be blocked.</p>
    <table cellpadding="4" style="border-collapse:collapse;font-size:13px">
      <thead><tr><th align="left">buffer</th><th align="left">stuck count</th><th align="left">oldest row</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
    <p style="color:#555;font-size:12px">Alert key: <code>${ALERT_KEY}</code>. Next alert possible after ${DEDUP_HOURS}h.</p>
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
