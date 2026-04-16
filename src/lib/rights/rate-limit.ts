import { Redis } from '@upstash/redis'

interface LimitResult {
  allowed: boolean
  retryInSeconds: number
}

const restUrl = process.env.KV_REST_API_URL ?? process.env.UPSTASH_REDIS_REST_URL
const restToken = process.env.KV_REST_API_TOKEN ?? process.env.UPSTASH_REDIS_REST_TOKEN

const redis: Redis | null =
  restUrl && restToken ? new Redis({ url: restUrl, token: restToken }) : null

// Dev-only fallback. Safe for one Node.js instance; bypassable when Vercel
// routes across multiple instances, which is why Upstash is the primary path.
const localBuckets = new Map<string, { count: number; resetAt: number }>()

let fallbackWarned = false
function warnFallbackOnce() {
  if (fallbackWarned) return
  fallbackWarned = true
  console.warn(
    '[rate-limit] KV_REST_API_URL / KV_REST_API_TOKEN not set — using in-memory fallback. Not safe for multi-instance traffic.',
  )
}

export async function checkRateLimit(
  key: string,
  limit: number = 5,
  windowMinutes: number = 60,
): Promise<LimitResult> {
  const windowSeconds = windowMinutes * 60

  if (redis) {
    // Initialise bucket with the window TTL if it doesn't exist, then atomically
    // increment. PTTL gives an accurate Retry-After even mid-window.
    const p = redis.pipeline()
    p.set(key, 0, { nx: true, ex: windowSeconds })
    p.incr(key)
    p.pttl(key)
    const [, count, ttlMs] = (await p.exec()) as [unknown, number, number]

    if (count > limit) {
      const retry = ttlMs > 0 ? Math.ceil(ttlMs / 1000) : windowSeconds
      return { allowed: false, retryInSeconds: retry }
    }
    return { allowed: true, retryInSeconds: 0 }
  }

  warnFallbackOnce()
  const now = Date.now()
  const entry = localBuckets.get(key)
  if (!entry || now >= entry.resetAt) {
    localBuckets.set(key, { count: 1, resetAt: now + windowSeconds * 1000 })
    return { allowed: true, retryInSeconds: 0 }
  }
  if (entry.count >= limit) {
    return { allowed: false, retryInSeconds: Math.ceil((entry.resetAt - now) / 1000) }
  }
  entry.count++
  return { allowed: true, retryInSeconds: 0 }
}

if (typeof setInterval !== 'undefined' && !redis) {
  setInterval(
    () => {
      const now = Date.now()
      for (const [key, entry] of localBuckets) {
        if (now >= entry.resetAt) localBuckets.delete(key)
      }
    },
    10 * 60 * 1000,
  )
}
