import { createHash } from 'crypto'

// ADR-0049 Phase 1.1 — fire-and-forget rate-limit event logger.
//
// Called by route handlers AFTER checkRateLimit returns allowed=false.
// Writes to public.rate_limit_events via the Supabase REST API using
// the anon key. RLS permits anon INSERT on this table (no SELECT — the
// admin Security panel reads via SECURITY DEFINER RPC).
//
// Never await this in a response path. Errors are swallowed — a
// logging outage must not convert into a user-facing failure.

interface LogRateLimitHitInput {
  endpoint: string
  key: string
  ipAddress: string
  orgId?: string | null
  hitCount: number
  windowSeconds: number
}

export function logRateLimitHit(input: LogRateLimitHitInput): void {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!url || !anon) return

  // sha256 the bucket key so repeat IDs group cleanly without leaking
  // the raw key (which can contain PII-shaped content like the IP).
  const keyHash = createHash('sha256').update(input.key).digest('hex')

  // Fire-and-forget. Node's fetch returns a Promise that we deliberately
  // do not await or catch-await. The .catch suppresses unhandled-rejection
  // warnings without blocking the caller.
  fetch(`${url}/rest/v1/rate_limit_events`, {
    method: 'POST',
    headers: {
      apikey: anon,
      Authorization: `Bearer ${anon}`,
      'Content-Type': 'application/json',
      Prefer: 'return=minimal',
    },
    body: JSON.stringify({
      endpoint: input.endpoint,
      ip_address: input.ipAddress.slice(0, 100),
      org_id: input.orgId ?? null,
      hit_count: input.hitCount,
      window_seconds: input.windowSeconds,
      key_hash: keyHash,
    }),
  }).catch((e) => {
    console.warn('[rate-limit-log] write failed:', e)
  })
}
