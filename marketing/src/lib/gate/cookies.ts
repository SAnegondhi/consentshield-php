// Cookie names + serialise helpers for the gate flow. ADR-0502 Sprint 1.2.
//
// One place to keep cookie names, paths, lifetimes, and Set-Cookie strings
// consistent between the API routes and the middleware.

export const COOKIE_PENDING = 'cs_mkt_gate_pending'
export const COOKIE_SESSION = 'cs_mkt_gate_session'

export const PENDING_TTL_SECONDS = 10 * 60 // 10 minutes
export const SESSION_TTL_SECONDS = 30 * 24 * 60 * 60 // 30 days

export function buildCookie(
  name: string,
  value: string,
  maxAgeSeconds: number,
  options: { domain?: string } = {},
): string {
  const parts = [
    `${name}=${value}`,
    'Path=/',
    `Max-Age=${maxAgeSeconds}`,
    'HttpOnly',
    'Secure',
    'SameSite=Lax',
  ]
  if (options.domain) parts.push(`Domain=${options.domain}`)
  return parts.join('; ')
}

export function buildClearCookie(name: string, options: { domain?: string } = {}): string {
  return buildCookie(name, '', 0, options)
}

/** Marketing site is `consentshield.in` and `www.consentshield.in`; cookie domain `.consentshield.in` covers both. Returns undefined for preview deploys (vercel.app) so each preview enforces its own gate independently. */
export function gateCookieDomain(host: string | null | undefined): string | undefined {
  if (!host) return undefined
  if (host.endsWith('consentshield.in')) return '.consentshield.in'
  return undefined
}
