// Supabase Edge Function: run-security-scans
// Nightly via pg_cron (02:00 IST). See ADR-0015.
//
// For every web_properties row: fetch the URL over HTTPS, inspect
// response headers + TLS validity, and insert one row per finding
// into security_scans. All writes go through the cs_orchestrator role.

import { createClient, SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const ORCHESTRATOR_KEY = Deno.env.get('CS_ORCHESTRATOR_ROLE_KEY')
if (!ORCHESTRATOR_KEY) {
  throw new Error('CS_ORCHESTRATOR_ROLE_KEY is required.')
}

const SCAN_TIMEOUT_MS = 10_000
const BATCH_SIZE = 10
const HSTS_WEAK_THRESHOLD_SECONDS = 180 * 24 * 60 * 60

interface Property {
  id: string
  org_id: string
  url: string
}

interface Finding {
  property_id: string
  org_id: string
  scan_type: string
  severity: 'info' | 'low' | 'medium' | 'high' | 'critical'
  signal_key: string
  details: Record<string, unknown>
  remediation: string | null
}

Deno.serve(async () => {
  const supabase = createClient(SUPABASE_URL, ORCHESTRATOR_KEY)

  const { data: properties, error } = await supabase
    .from('web_properties')
    .select('id, org_id, url')

  if (error) {
    return json({ ok: false, error: error.message }, 500)
  }

  const props = (properties ?? []) as Property[]
  const all: Finding[] = []
  const scannedAt = new Date().toISOString()

  for (let i = 0; i < props.length; i += BATCH_SIZE) {
    const batch = props.slice(i, i + BATCH_SIZE)
    const results = await Promise.all(batch.map(scanProperty))
    for (const findings of results) all.push(...findings)
  }

  if (all.length > 0) {
    const rows = all.map((f) => ({ ...f, scanned_at: scannedAt }))
    const { error: insertErr } = await supabase.from('security_scans').insert(rows)
    if (insertErr) return json({ ok: false, error: insertErr.message }, 500)

    // One audit_log per non-info finding, per property.
    const violations = all.filter((f) => f.severity !== 'info')
    if (violations.length > 0) {
      await supabase.from('audit_log').insert(
        violations.map((v) => ({
          org_id: v.org_id,
          event_type: 'posture_finding',
          entity_type: 'web_property',
          entity_id: v.property_id,
          payload: { signal_key: v.signal_key, severity: v.severity, details: v.details },
        })),
      )
    }
  }

  return json({
    ok: true,
    at: scannedAt,
    scanned: props.length,
    findings: all.length,
    violations: all.filter((f) => f.severity !== 'info').length,
  })
})

async function scanProperty(p: Property): Promise<Finding[]> {
  const findings: Finding[] = []
  const url = normaliseUrl(p.url)

  let response: Response | null = null
  try {
    response = await fetch(url, {
      method: 'GET',
      redirect: 'follow',
      signal: AbortSignal.timeout(SCAN_TIMEOUT_MS),
    })
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'unknown'
    const isTls = /certificate|TLS|SSL|hostname/i.test(msg)
    findings.push({
      property_id: p.id,
      org_id: p.org_id,
      scan_type: isTls ? 'tls' : 'reachability',
      severity: 'critical',
      signal_key: isTls ? 'tls_invalid' : 'tls_unreachable',
      details: { url, error: msg },
      remediation: isTls
        ? 'Install a valid TLS certificate covering the hostname, not expired, from a public CA.'
        : 'Ensure the site is publicly reachable over HTTPS.',
    })
    return findings
  }

  const headers = response.headers
  const hsts = headers.get('strict-transport-security')
  const csp = headers.get('content-security-policy') || headers.get('content-security-policy-report-only')
  const xfo = headers.get('x-frame-options')
  const referrer = headers.get('referrer-policy')

  if (!hsts) {
    findings.push(finding(p, 'headers', 'medium', 'missing_hsts',
      { response_status: response.status },
      'Add a Strict-Transport-Security response header with max-age >= 15552000 (180 days) and includeSubDomains.'))
  } else {
    const maxAge = parseHstsMaxAge(hsts)
    if (maxAge !== null && maxAge < HSTS_WEAK_THRESHOLD_SECONDS) {
      findings.push(finding(p, 'headers', 'low', 'weak_hsts',
        { max_age_seconds: maxAge, value: hsts },
        `Increase HSTS max-age to at least ${HSTS_WEAK_THRESHOLD_SECONDS} seconds.`))
    }
  }

  if (!csp) {
    findings.push(finding(p, 'headers', 'medium', 'missing_csp',
      { response_status: response.status },
      'Add a Content-Security-Policy header. Start with report-only mode while you tune the directives.'))
  }

  const hasFrameAncestors = csp ? /frame-ancestors/i.test(csp) : false
  if (!xfo && !hasFrameAncestors) {
    findings.push(finding(p, 'headers', 'low', 'missing_xfo',
      { response_status: response.status },
      'Add X-Frame-Options: DENY (or SAMEORIGIN), or specify frame-ancestors in CSP.'))
  }

  if (!referrer) {
    findings.push(finding(p, 'headers', 'info', 'missing_referrer_policy',
      { response_status: response.status },
      'Add a Referrer-Policy header (strict-origin-when-cross-origin is a good default).'))
  }

  if (findings.length === 0) {
    findings.push(finding(p, 'headers', 'info', 'all_clean',
      { checked: ['hsts', 'csp', 'xfo', 'referrer_policy'] },
      null))
  }

  return findings
}

function finding(
  p: Property,
  scan_type: string,
  severity: Finding['severity'],
  signal_key: string,
  details: Record<string, unknown>,
  remediation: string | null,
): Finding {
  return { property_id: p.id, org_id: p.org_id, scan_type, severity, signal_key, details, remediation }
}

function parseHstsMaxAge(header: string): number | null {
  const m = header.match(/max-age\s*=\s*(\d+)/i)
  return m ? parseInt(m[1], 10) : null
}

function normaliseUrl(raw: string): string {
  const trimmed = raw.trim()
  if (/^https?:\/\//i.test(trimmed)) return trimmed
  return `https://${trimmed}`
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}
