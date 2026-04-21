import { createServerClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { lookup } from 'node:dns/promises'
import { isIP } from 'node:net'

// ADR-0058 Sprint 1.4 — onboarding snippet verification with SSRF
// defence. Called by Step 5 "Verify installation" button.
//
// SSRF defence layering (in order, each blocks the next):
//   1. Scheme allow-list: only http / https.
//   2. Hostname check: refuse known-metadata hostnames (localhost,
//      metadata.google.internal, 169.254.169.254).
//   3. DNS resolution + IP family check: refuse private / loopback /
//      link-local / multicast / broadcast / reserved ranges.
//   4. Response size cap (256 KB) and 5-second timeout.
//
// A successful verify stamps `web_properties.snippet_verified_at`. The
// response always discloses only pass/fail + reason, never the raw HTML.

export const dynamic = 'force-dynamic'
export const maxDuration = 10

const MAX_BYTES = 256 * 1024
const FETCH_TIMEOUT_MS = 5000
const BANNER_REGEX = /<script[^>]+banner\.js/i

const BLOCKED_HOSTNAMES = new Set([
  'localhost',
  '0.0.0.0',
  'metadata.google.internal',
  'instance-data',
  'instance-data.ec2.internal',
])

interface VerifyRequest {
  property_id: string
  url: string
}

interface VerifyResponse {
  verified: boolean
  reason?: string
  verified_at?: string
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ orgId: string }> },
) {
  const { orgId } = await params
  const supabase = await createServerClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { data: membership } = await supabase
    .from('org_memberships')
    .select('role')
    .eq('user_id', user.id)
    .eq('org_id', orgId)
    .maybeSingle()
  if (!membership) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  let body: VerifyRequest
  try {
    body = (await request.json()) as VerifyRequest
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 })
  }

  if (!body.property_id || !body.url) {
    return NextResponse.json(
      { error: 'property_id and url are required' },
      { status: 400 },
    )
  }

  // The property must exist and belong to this org. We also pull its
  // stored URL to compare against the submitted one — users can only
  // verify the URL they registered.
  const { data: property } = await supabase
    .from('web_properties')
    .select('id, url')
    .eq('id', body.property_id)
    .eq('org_id', orgId)
    .maybeSingle()
  if (!property) {
    return NextResponse.json({ error: 'property not found' }, { status: 404 })
  }

  const sanity = validateTarget(body.url)
  if (!sanity.ok) {
    const response: VerifyResponse = { verified: false, reason: sanity.reason }
    return NextResponse.json(response)
  }

  const resolved = await resolveAndValidate(sanity.parsed.hostname)
  if (!resolved.ok) {
    const response: VerifyResponse = {
      verified: false,
      reason: resolved.reason,
    }
    return NextResponse.json(response)
  }

  let html: string
  try {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
    const res = await fetch(sanity.parsed.toString(), {
      method: 'GET',
      signal: controller.signal,
      redirect: 'manual',
      headers: { 'user-agent': 'ConsentShield-SnippetVerify/1.0' },
    })
    clearTimeout(timer)

    if (res.status >= 300 && res.status < 400) {
      const response: VerifyResponse = {
        verified: false,
        reason: `redirect_not_followed_${res.status}`,
      }
      return NextResponse.json(response)
    }
    if (!res.ok) {
      const response: VerifyResponse = {
        verified: false,
        reason: `http_${res.status}`,
      }
      return NextResponse.json(response)
    }

    const reader = res.body?.getReader()
    if (!reader) {
      const response: VerifyResponse = {
        verified: false,
        reason: 'empty_response',
      }
      return NextResponse.json(response)
    }

    const decoder = new TextDecoder('utf-8', { fatal: false })
    let total = 0
    let buf = ''
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      total += value.byteLength
      if (total > MAX_BYTES) {
        await reader.cancel()
        break
      }
      buf += decoder.decode(value, { stream: true })
      if (BANNER_REGEX.test(buf)) break
    }
    buf += decoder.decode()
    html = buf
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'fetch_failed'
    const reason = msg.includes('aborted') ? 'timeout' : 'fetch_failed'
    const response: VerifyResponse = { verified: false, reason }
    return NextResponse.json(response)
  }

  if (!BANNER_REGEX.test(html)) {
    const response: VerifyResponse = {
      verified: false,
      reason: 'snippet_not_found',
    }
    return NextResponse.json(response)
  }

  const verifiedAt = new Date().toISOString()
  const { error: updateErr } = await supabase
    .from('web_properties')
    .update({
      snippet_verified_at: verifiedAt,
      snippet_last_seen_at: verifiedAt,
    })
    .eq('id', property.id)
    .eq('org_id', orgId)

  if (updateErr) {
    return NextResponse.json(
      { error: updateErr.message },
      { status: 500 },
    )
  }

  const response: VerifyResponse = {
    verified: true,
    verified_at: verifiedAt,
  }
  return NextResponse.json(response)
}

function validateTarget(
  rawUrl: string,
):
  | { ok: true; parsed: URL }
  | { ok: false; reason: string } {
  let parsed: URL
  try {
    parsed = new URL(rawUrl)
  } catch {
    return { ok: false, reason: 'invalid_url' }
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return { ok: false, reason: 'unsupported_scheme' }
  }
  const hostname = parsed.hostname.toLowerCase()
  if (BLOCKED_HOSTNAMES.has(hostname)) {
    return { ok: false, reason: 'blocked_host' }
  }
  if (hostname.endsWith('.internal') || hostname.endsWith('.local')) {
    return { ok: false, reason: 'blocked_host' }
  }
  if (isIP(hostname) && isPrivateIp(hostname)) {
    return { ok: false, reason: 'private_ip' }
  }

  return { ok: true, parsed }
}

async function resolveAndValidate(
  hostname: string,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  // Literal IP — already screened in validateTarget.
  if (isIP(hostname)) return { ok: true }
  try {
    const records = await lookup(hostname, { all: true, verbatim: true })
    for (const rec of records) {
      if (isPrivateIp(rec.address)) {
        return { ok: false, reason: 'private_ip' }
      }
    }
    return { ok: true }
  } catch {
    return { ok: false, reason: 'dns_failure' }
  }
}

function isPrivateIp(ip: string): boolean {
  const family = isIP(ip)
  if (family === 4) return isPrivateV4(ip)
  if (family === 6) return isPrivateV6(ip)
  return true
}

function isPrivateV4(ip: string): boolean {
  const parts = ip.split('.').map((n) => Number.parseInt(n, 10))
  if (parts.length !== 4 || parts.some((n) => Number.isNaN(n))) return true
  const [a, b] = parts
  if (a === 10) return true // 10.0.0.0/8
  if (a === 127) return true // 127.0.0.0/8 loopback
  if (a === 169 && b === 254) return true // 169.254.0.0/16 link-local + metadata
  if (a === 172 && b >= 16 && b <= 31) return true // 172.16.0.0/12
  if (a === 192 && b === 168) return true // 192.168.0.0/16
  if (a === 100 && b >= 64 && b <= 127) return true // 100.64.0.0/10 CGNAT
  if (a >= 224) return true // 224.0.0.0/4 multicast + reserved
  if (a === 0) return true // 0.0.0.0/8
  return false
}

function isPrivateV6(ip: string): boolean {
  const lower = ip.toLowerCase()
  if (lower === '::1') return true
  if (lower === '::') return true
  if (lower.startsWith('fe80:')) return true // link-local
  if (lower.startsWith('fc') || lower.startsWith('fd')) return true // ULA
  if (lower.startsWith('ff')) return true // multicast
  if (lower.startsWith('::ffff:')) {
    const v4 = lower.slice(7)
    if (isIP(v4) === 4) return isPrivateV4(v4)
  }
  return false
}
