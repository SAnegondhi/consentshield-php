// ADR-0033 Sprint 2.3 — Worker-side enforcement of the operator-managed
// blocked-IP list.
//
// The blocked_ips table (ADR-0033 Sprint 2.1) flows through
// public.admin_config_snapshot() → KV key `admin:config:v1` (Sprint 2.3
// patch migration 20260427000002) → Worker on every request. A blocked
// caller sees 403 ip_blocked before any routing happens.
//
// Scope for v1: IPv4 CIDR matching. IPv6 CIDRs in the list are tolerated
// but never match — operators block v4 ranges today; v6 support can come
// as a follow-up when the list grows one. Non-CIDR strings (plain IP)
// are treated as /32. Invalid entries are silently skipped to keep the
// hot path fail-open on bad data (Rule 11's spirit: operator error
// must never DoS the customer).
//
// Zero npm dependencies — Rule 15.

const CLIENT_IP_HEADER = 'CF-Connecting-IP'

/**
 * Convert a dotted-quad IPv4 string ("198.51.100.0") to a 32-bit
 * unsigned integer. Returns null for any parse failure — IPv6 strings
 * ("2001:db8::1") also return null and are treated as never-matching.
 */
export function ipv4ToInt(ip: string): number | null {
  if (!ip || typeof ip !== 'string') return null
  const parts = ip.split('.')
  if (parts.length !== 4) return null
  let n = 0
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null
    const v = Number(part)
    if (v < 0 || v > 255) return null
    n = (n << 8) | v
  }
  // Coerce back to unsigned; JS bitwise ops return signed 32-bit.
  return n >>> 0
}

/**
 * Does `ip` fall inside the CIDR range `cidr`? Supports:
 *   - "1.2.3.4"       → treated as "1.2.3.4/32"
 *   - "1.2.3.4/32"    → single IPv4
 *   - "10.0.0.0/8"    → IPv4 range
 *   - "10.0.0.0/0"    → matches any IPv4 (legal but odd)
 *
 * Returns false for malformed input, IPv6 CIDRs, or prefix lengths
 * outside [0, 32].
 */
export function isIpInCidr(ip: string, cidr: string): boolean {
  if (!ip || !cidr) return false
  const slashIdx = cidr.indexOf('/')
  const base = slashIdx === -1 ? cidr : cidr.slice(0, slashIdx)
  const bitsStr = slashIdx === -1 ? '32' : cidr.slice(slashIdx + 1)
  const bits = Number(bitsStr)
  if (!Number.isInteger(bits) || bits < 0 || bits > 32) return false

  const baseNum = ipv4ToInt(base)
  const ipNum = ipv4ToInt(ip)
  if (baseNum === null || ipNum === null) return false

  if (bits === 0) return true
  if (bits === 32) return baseNum === ipNum

  // Mask the low (32 - bits) bits off both sides and compare.
  const mask = (0xffffffff << (32 - bits)) >>> 0
  return (baseNum & mask) === (ipNum & mask)
}

/**
 * True if `ip` matches any CIDR in `blockedList`. An empty/missing list
 * always returns false (fail-open on absent data — see module header).
 */
export function isIpBlocked(ip: string | null, blockedList: string[] | undefined): boolean {
  if (!ip) return false
  if (!blockedList || blockedList.length === 0) return false
  for (const cidr of blockedList) {
    if (isIpInCidr(ip, cidr)) return true
  }
  return false
}

/**
 * Extract the caller IP from a Cloudflare request. Falls back to the
 * first IP in X-Forwarded-For for local dev / Miniflare.
 */
export function getClientIp(request: Request): string | null {
  const cf = request.headers.get(CLIENT_IP_HEADER)
  if (cf) return cf.trim()
  const xff = request.headers.get('X-Forwarded-For')
  if (xff) return xff.split(',')[0]!.trim()
  return null
}

/**
 * Drop-in 403 response when an IP is blocked. JSON body matches the
 * Worker's other error shapes (`{ error: '...' }`).
 */
export function ipBlockedResponse(): Response {
  return new Response(JSON.stringify({ error: 'ip_blocked' }), {
    status: 403,
    headers: { 'Content-Type': 'application/json' },
  })
}
