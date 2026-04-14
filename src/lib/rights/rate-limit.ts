// Simple in-memory rate limiter.
// Survives within a single Node.js instance only — sufficient for v1 traffic.
// For multi-instance production, upgrade to Redis or Cloudflare KV.

interface RateEntry {
  count: number
  resetAt: number
}

const buckets = new Map<string, RateEntry>()

export function checkRateLimit(
  key: string,
  limit: number = 5,
  windowMinutes: number = 60,
): { allowed: boolean; retryInSeconds: number } {
  const now = Date.now()
  const entry = buckets.get(key)

  if (!entry || now >= entry.resetAt) {
    buckets.set(key, { count: 1, resetAt: now + windowMinutes * 60 * 1000 })
    return { allowed: true, retryInSeconds: 0 }
  }

  if (entry.count >= limit) {
    return { allowed: false, retryInSeconds: Math.ceil((entry.resetAt - now) / 1000) }
  }

  entry.count++
  return { allowed: true, retryInSeconds: 0 }
}

// Periodic cleanup of expired buckets to prevent unbounded growth
if (typeof setInterval !== 'undefined') {
  setInterval(
    () => {
      const now = Date.now()
      for (const [key, entry] of buckets) {
        if (now >= entry.resetAt) buckets.delete(key)
      }
    },
    10 * 60 * 1000,
  )
}
