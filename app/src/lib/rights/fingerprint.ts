// ADR-0037 V2-D2 — session fingerprint derivation at rights-request submit time.
//
// Formula MUST match worker/src/events.ts:118 exactly:
//   fingerprint = sha256(`${userAgent}:${ipTruncated}:${org_id}`)
// where ipTruncated is the first three octets of the IPv4 address + '.0'.
//
// Caveats:
//   - IPv6 addresses produce a degenerate truncation but consistently so
//     on both sides (the Worker uses the same split-on-dot formula).
//   - Behind proxies Next.js reads x-forwarded-for; we take the first IP
//     in the list (per RFC 7239 §5.2 client-ip convention).
//   - If the requestor used a different browser / network at consent time
//     vs rights-request time, the fingerprint will NOT match any artefacts.
//     The Rights Centre UI falls back to the org-wide informational view
//     in that case.

import { createHash } from 'node:crypto'

export function extractClientIp(request: Request): string {
  const forwarded = request.headers.get('x-forwarded-for')
  if (forwarded) {
    const first = forwarded.split(',')[0]?.trim()
    if (first) return first
  }
  return (
    request.headers.get('x-real-ip') ??
    request.headers.get('cf-connecting-ip') ??
    ''
  )
}

export function truncateIp(ip: string): string {
  // Matches worker/src/events.ts: ip.split('.').slice(0,3).join('.') + '.0'
  // IPv4: '1.2.3.4' → '1.2.3.0'
  // IPv6: split on '.' yields 1 element → '.0' appended (degenerate but consistent)
  return ip.split('.').slice(0, 3).join('.') + '.0'
}

export async function deriveRequestFingerprint(
  request: Request,
  orgId: string,
): Promise<string> {
  const userAgent = request.headers.get('user-agent') ?? ''
  const ipTruncated = truncateIp(extractClientIp(request))
  const input = `${userAgent}:${ipTruncated}:${orgId}`
  return createHash('sha256').update(input).digest('hex')
}
