import { createHmac, timingSafeEqual } from 'node:crypto'

// ADR-0044 Phase 2.6 — HMAC signing for /api/internal/invites.
//
// The marketing site signs each request with a shared secret. Payload:
//   sha256(rawBody + ':' + timestamp)
// sent as `x-cs-signature` + `x-cs-timestamp` headers. Timestamp is a
// Unix seconds string; the route rejects anything outside ±5 minutes
// to bound replay.

const WINDOW_SECONDS = 300

export interface SignResult {
  timestamp: string
  signature: string
}

export function signPayload(rawBody: string, secret: string, now = Date.now()): SignResult {
  const timestamp = Math.floor(now / 1000).toString()
  const signature = createHmac('sha256', secret)
    .update(`${rawBody}:${timestamp}`)
    .digest('hex')
  return { timestamp, signature }
}

export type VerifyOutcome =
  | { ok: true }
  | { ok: false; reason: 'missing_headers' | 'stale' | 'bad_signature' }

export function verifyPayload(
  rawBody: string,
  secret: string,
  headers: { timestamp: string | null; signature: string | null },
  now = Date.now(),
): VerifyOutcome {
  if (!headers.timestamp || !headers.signature) {
    return { ok: false, reason: 'missing_headers' }
  }

  const tsSeconds = Number.parseInt(headers.timestamp, 10)
  if (!Number.isFinite(tsSeconds)) {
    return { ok: false, reason: 'missing_headers' }
  }
  const nowSeconds = Math.floor(now / 1000)
  if (Math.abs(nowSeconds - tsSeconds) > WINDOW_SECONDS) {
    return { ok: false, reason: 'stale' }
  }

  const expected = createHmac('sha256', secret)
    .update(`${rawBody}:${headers.timestamp}`)
    .digest('hex')
  const provided = headers.signature

  if (expected.length !== provided.length) {
    return { ok: false, reason: 'bad_signature' }
  }
  const eq = timingSafeEqual(Buffer.from(expected), Buffer.from(provided))
  return eq ? { ok: true } : { ok: false, reason: 'bad_signature' }
}
