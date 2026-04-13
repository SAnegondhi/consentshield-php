import type { Env } from './index'

export async function handleBannerScript(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url)
  const propertyId = url.searchParams.get('prop')
  const orgId = url.searchParams.get('org')

  if (!propertyId || !orgId) {
    return new Response('Missing required parameters: org, prop', { status: 400 })
  }

  // Try KV cache first
  const cacheKey = `banner:config:${propertyId}`
  const cached = await env.BANNER_KV.get(cacheKey, 'json')

  let config = cached as Record<string, unknown> | null

  // On cache miss, fetch from Supabase via cs_worker role
  if (!config) {
    const res = await fetch(
      `${env.SUPABASE_URL}/rest/v1/consent_banners?property_id=eq.${propertyId}&is_active=eq.true&select=*`,
      {
        headers: {
          apikey: env.SUPABASE_WORKER_KEY,
          Authorization: `Bearer ${env.SUPABASE_WORKER_KEY}`,
        },
      },
    )

    if (!res.ok) {
      return new Response('Banner not found', { status: 404 })
    }

    const banners = (await res.json()) as Record<string, unknown>[]
    config = banners[0] ?? null

    if (config) {
      await env.BANNER_KV.put(cacheKey, JSON.stringify(config), { expirationTtl: 300 })
    }
  }

  if (!config) {
    return new Response('Banner not found', { status: 404 })
  }

  // Stub banner script — full implementation in a later ADR
  const script = `(function(){console.log("ConsentShield banner stub",${JSON.stringify(orgId)},${JSON.stringify(propertyId)})})();`

  return new Response(script, {
    headers: {
      'Content-Type': 'application/javascript; charset=utf-8',
      'Cache-Control': 'public, max-age=60, stale-while-revalidate=300',
      'Access-Control-Allow-Origin': '*',
    },
  })
}
