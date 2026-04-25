// In-process rate limiter for /api/gate/request-otp. ADR-0502 Sprint 1.1.
//
// Best-effort only — Vercel's serverless runtime resets state between cold
// starts. Acceptable for a confidential preview audience; promote to
// Vercel KV when traffic justifies (V2 backlog item in ADR-0502).

interface Bucket {
  count: number
  resetAt: number
}

const buckets = new Map<string, Bucket>()

export interface RateLimitResult {
  ok: boolean
  retryAfterMs?: number
}

export function tryConsume(
  key: string,
  max: number,
  windowMs: number,
  now: number = Date.now(),
): RateLimitResult {
  const existing = buckets.get(key)
  if (!existing || existing.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs })
    return { ok: true }
  }
  if (existing.count >= max) {
    return { ok: false, retryAfterMs: Math.max(0, existing.resetAt - now) }
  }
  existing.count += 1
  return { ok: true }
}

/** Test-only — not exported through index. */
export function _resetForTests(): void {
  buckets.clear()
}
