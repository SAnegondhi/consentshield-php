import type { Env } from './index'

export interface TrackerSignature {
  service_name: string
  service_slug: string
  category: string // 'analytics' | 'marketing' | 'personalisation' | 'functional'
  detection_rules: Array<{
    type: 'script_src' | 'resource_url' | 'cookie_name' | 'global_var'
    pattern: string
    confidence: number
  }>
  is_functional: boolean
}

// Cache key in KV
const CACHE_KEY = 'tracker:signatures:v1'
const CACHE_TTL_SECONDS = 3600 // 1 hour

export async function getTrackerSignatures(env: Env): Promise<TrackerSignature[]> {
  const cached = await env.BANNER_KV.get(CACHE_KEY, 'json')
  if (cached) return cached as TrackerSignature[]

  const res = await fetch(
    `${env.SUPABASE_URL}/rest/v1/tracker_signatures?select=service_name,service_slug,category,detection_rules,is_functional`,
    {
      headers: {
        apikey: env.SUPABASE_WORKER_KEY,
        Authorization: `Bearer ${env.SUPABASE_WORKER_KEY}`,
      },
    },
  )

  if (!res.ok) return []

  const rows = (await res.json()) as TrackerSignature[]

  // Cache for 1 hour
  await env.BANNER_KV.put(CACHE_KEY, JSON.stringify(rows), { expirationTtl: CACHE_TTL_SECONDS })

  return rows
}

// Compact the signatures for embedding in the banner script (only script_src/resource_url rules,
// strip fields we don't need client-side)
export function compactSignatures(sigs: TrackerSignature[]): Array<{
  s: string // slug
  c: string // category (a/m/p/f shortform)
  f: number // is_functional (1/0)
  p: string[] // patterns
}> {
  const categoryMap: Record<string, string> = {
    analytics: 'a',
    marketing: 'm',
    personalisation: 'p',
    functional: 'f',
  }
  return sigs.map((sig) => ({
    s: sig.service_slug,
    c: categoryMap[sig.category] || 'a',
    f: sig.is_functional ? 1 : 0,
    p: sig.detection_rules
      .filter((r) => r.type === 'script_src' || r.type === 'resource_url')
      .map((r) => r.pattern),
  }))
}
