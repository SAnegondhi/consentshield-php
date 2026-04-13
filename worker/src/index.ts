import { handleBannerScript } from './banner'
import { handleConsentEvent } from './events'
import { handleObservation } from './observations'

export interface Env {
  BANNER_KV: KVNamespace
  SUPABASE_URL: string
  SUPABASE_WORKER_KEY: string
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url)
    const { pathname } = url

    // CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type',
          'Access-Control-Max-Age': '86400',
        },
      })
    }

    // Route dispatch
    if (pathname === '/v1/banner.js' && request.method === 'GET') {
      return handleBannerScript(request, env)
    }

    if (pathname === '/v1/events' && request.method === 'POST') {
      return handleConsentEvent(request, env, ctx)
    }

    if (pathname === '/v1/observations' && request.method === 'POST') {
      return handleObservation(request, env, ctx)
    }

    if (pathname === '/v1/health' && request.method === 'GET') {
      return new Response(JSON.stringify({ status: 'ok', ts: Date.now() }), {
        headers: { 'Content-Type': 'application/json' },
      })
    }

    return new Response('Not found', { status: 404 })
  },
}
