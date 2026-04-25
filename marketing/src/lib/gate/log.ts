// Structured logging for gate events. ADR-0502 Sprint 1.1.
//
// Single-line JSON to console.log; Vercel ingests these into the project
// log sink. Queryable via `vercel logs --no-follow ... | jq`.

export type GateEvent =
  | 'gate.middleware.redirect'
  | 'gate.otp.requested'
  | 'gate.otp.verified'
  | 'gate.session.minted'
  | 'gate.session.cleared'

export type GateOutcome =
  | 'redirect'
  | 'accepted'
  | 'rate_limited'
  | 'success'
  | 'expired'
  | 'mismatch'
  | 'attempts_exhausted'
  | 'created'
  | 'logout'
  | 'invalid_input'

export interface GateLogFields {
  event: GateEvent
  outcome: GateOutcome
  email?: string
  ip?: string | null
  userAgent?: string | null
  path?: string
  requestId?: string | null
  iat?: number
  attemptsUsed?: number
  retryAfterMs?: number
}

export function logGateEvent(fields: GateLogFields): void {
  const payload: Record<string, unknown> = {
    ts: new Date().toISOString(),
    event: fields.event,
    outcome: fields.outcome,
  }
  if (fields.email) payload.email = fields.email
  if (fields.ip !== undefined) payload.ip = truncateIp(fields.ip)
  if (fields.userAgent !== undefined) payload.ua = truncateUa(fields.userAgent)
  if (fields.path) payload.path = fields.path
  if (fields.requestId !== undefined) payload.request_id = fields.requestId
  if (fields.iat !== undefined) payload.iat = fields.iat
  if (fields.attemptsUsed !== undefined) payload.attempts_used = fields.attemptsUsed
  if (fields.retryAfterMs !== undefined) payload.retry_after_ms = fields.retryAfterMs
  // eslint-disable-next-line no-console
  console.log(JSON.stringify(payload))
}

/** Keep first three octets of v4, first 64 bits of v6 — `feedback_session_fingerprint_server_only`. */
export function truncateIp(ip: string | null | undefined): string | null {
  if (!ip) return null
  if (ip.includes(':')) {
    const parts = ip.split(':')
    return parts.slice(0, 4).join(':') + ':*'
  }
  const parts = ip.split('.')
  if (parts.length === 4) return parts.slice(0, 3).join('.') + '.*'
  return ip.slice(0, 16)
}

export function truncateUa(ua: string | null | undefined): string | null {
  if (!ua) return null
  return ua.length > 64 ? ua.slice(0, 64) : ua
}
