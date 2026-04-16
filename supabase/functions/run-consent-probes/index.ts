// Supabase Edge Function: run-consent-probes
// Hourly via pg_cron. See ADR-0016.
//
// Static HTML analysis v1: fetches each probe target, extracts script /
// img / iframe / link URLs, matches against tracker_signatures, flags
// violations against the probe's declared consent_state.

import { createClient, SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const ORCHESTRATOR_KEY = Deno.env.get('CS_ORCHESTRATOR_ROLE_KEY')
if (!ORCHESTRATOR_KEY) throw new Error('CS_ORCHESTRATOR_ROLE_KEY is required.')

const FETCH_TIMEOUT_MS = 10_000

interface Probe {
  id: string
  org_id: string
  property_id: string
  probe_type: string
  consent_state: Record<string, boolean>
  schedule: string
}

interface Signature {
  service_slug: string
  category: string
  is_functional: boolean
  detection_rules: Array<{ type: string; pattern: string; confidence: number }>
}

interface Detection {
  slug: string
  category: string
  functional: boolean
  url: string
  matched_pattern: string
}

interface Violation extends Detection {
  required_purpose: string
}

const CATEGORY_TO_PURPOSE: Record<string, string> = {
  analytics: 'analytics',
  marketing: 'marketing',
  personalisation: 'personalisation',
}

const SCHEDULE_NEXT_MS: Record<string, number> = {
  hourly: 60 * 60 * 1000,
  daily:  24 * 60 * 60 * 1000,
  weekly: 7 * 24 * 60 * 60 * 1000,
}

Deno.serve(async () => {
  const supabase = createClient(SUPABASE_URL, ORCHESTRATOR_KEY)
  const now = new Date()
  const nowIso = now.toISOString()

  const { data: probes, error: probeErr } = await supabase
    .from('consent_probes')
    .select('id, org_id, property_id, probe_type, consent_state, schedule')
    .eq('is_active', true)
    .or(`next_run_at.is.null,next_run_at.lte.${nowIso}`)

  if (probeErr) return json({ ok: false, error: probeErr.message }, 500)

  const probeRows = (probes ?? []) as Probe[]
  if (probeRows.length === 0) {
    return json({ ok: true, at: nowIso, scanned: 0, runs: 0 })
  }

  const { data: sigs } = await supabase
    .from('tracker_signatures')
    .select('service_slug, category, is_functional, detection_rules')

  const signatures = (sigs ?? []) as Signature[]

  const propIds = Array.from(new Set(probeRows.map((p) => p.property_id)))
  const { data: props } = await supabase
    .from('web_properties')
    .select('id, url')
    .in('id', propIds)
  const urlByProperty = new Map<string, string>(
    (props ?? []).map((p: { id: string; url: string }) => [p.id, p.url]),
  )

  let totalRuns = 0
  let totalViolations = 0
  for (const probe of probeRows) {
    const url = urlByProperty.get(probe.property_id)
    if (!url) continue
    const result = await runProbe(supabase, probe, url, signatures)
    totalRuns++
    totalViolations += result.violations
  }

  return json({ ok: true, at: nowIso, scanned: probeRows.length, runs: totalRuns, violations: totalViolations })
})

async function runProbe(
  supabase: SupabaseClient,
  probe: Probe,
  url: string,
  signatures: Signature[],
): Promise<{ violations: number }> {
  const started = Date.now()
  let html = ''
  let status: 'completed' | 'failed' = 'completed'
  let errorMessage: string | null = null

  try {
    const res = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) })
    if (!res.ok) {
      status = 'failed'
      errorMessage = `HTTP ${res.status}`
    } else {
      html = await res.text()
    }
  } catch (e) {
    status = 'failed'
    errorMessage = e instanceof Error ? e.message : 'fetch error'
  }

  const detections = status === 'completed' ? detect(html, signatures) : []
  const violations = detections
    .filter((d) => !d.functional)
    .map((d) => {
      const required = CATEGORY_TO_PURPOSE[d.category]
      if (required && probe.consent_state[required] === false) {
        return { ...d, required_purpose: required } as Violation
      }
      return null
    })
    .filter((v): v is Violation => v !== null)

  const duration = Date.now() - started
  const pageHtmlHash = await sha256Hex(html)
  const schedNextMs = SCHEDULE_NEXT_MS[probe.schedule] ?? SCHEDULE_NEXT_MS.daily

  await supabase.from('consent_probe_runs').insert({
    probe_id: probe.id,
    org_id: probe.org_id,
    consent_state: probe.consent_state,
    trackers_detected: detections,
    violations,
    page_html_hash: pageHtmlHash,
    duration_ms: duration,
    status,
    error_message: errorMessage,
  })

  await supabase
    .from('consent_probes')
    .update({
      last_run_at: new Date().toISOString(),
      last_result: {
        status,
        trackers: detections.length,
        violations: violations.length,
        url,
      },
      next_run_at: new Date(Date.now() + schedNextMs).toISOString(),
    })
    .eq('id', probe.id)

  return { violations: violations.length }
}

function detect(html: string, sigs: Signature[]): Detection[] {
  const urls = extractUrls(html)
  const seen = new Set<string>()
  const out: Detection[] = []

  // Pass 1: structured <script src="">, <img>, <iframe>, <link>, <source>
  for (const url of urls) {
    for (const sig of sigs) {
      for (const rule of sig.detection_rules) {
        if (rule.type !== 'script_src' && rule.type !== 'resource_url') continue
        if (url.includes(rule.pattern)) {
          const key = `${sig.service_slug}:${rule.pattern}`
          if (seen.has(key)) continue
          seen.add(key)
          out.push({
            slug: sig.service_slug,
            category: sig.category,
            functional: sig.is_functional,
            url,
            matched_pattern: rule.pattern,
          })
        }
      }
    }
  }

  // Pass 2: full-body substring scan — catches tracker URLs inside inline JS
  // blocks (the `/violator` demo injects GA4 / Meta Pixel this way). A pattern
  // anywhere in the HTML is a strong signal the page intends to load it even if
  // the actual DOM insertion happens at runtime.
  for (const sig of sigs) {
    for (const rule of sig.detection_rules) {
      if (rule.type !== 'script_src' && rule.type !== 'resource_url') continue
      const key = `${sig.service_slug}:${rule.pattern}`
      if (seen.has(key)) continue
      if (html.includes(rule.pattern)) {
        seen.add(key)
        out.push({
          slug: sig.service_slug,
          category: sig.category,
          functional: sig.is_functional,
          url: `inline:${rule.pattern}`,
          matched_pattern: rule.pattern,
        })
      }
    }
  }

  return out
}

function extractUrls(html: string): string[] {
  const out: string[] = []
  const patterns = [
    /<script[^>]+src\s*=\s*["']([^"']+)["']/gi,
    /<img[^>]+src\s*=\s*["']([^"']+)["']/gi,
    /<iframe[^>]+src\s*=\s*["']([^"']+)["']/gi,
    /<link[^>]+href\s*=\s*["']([^"']+)["']/gi,
    /<source[^>]+src\s*=\s*["']([^"']+)["']/gi,
  ]
  for (const re of patterns) {
    let m: RegExpExecArray | null
    while ((m = re.exec(html)) !== null) {
      out.push(m[1])
    }
  }
  return out
}

async function sha256Hex(input: string): Promise<string> {
  const bytes = new TextEncoder().encode(input)
  const hash = await crypto.subtle.digest('SHA-256', bytes)
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}
