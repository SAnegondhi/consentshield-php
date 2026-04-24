// ADR-1003 Sprint 1.1 — storage-mode KV sync.
//
// Bearer-authed POST. Triggered two ways:
//   · AFTER UPDATE OF storage_mode on public.organisations fires
//     public.dispatch_storage_mode_sync() → this route. Near-instant
//     KV refresh for Worker pickup.
//   · pg_cron 'storage-mode-kv-sync' every 60 s as a safety-net for
//     any missed dispatch (Vault-unconfigured window, net.http_post
//     transient failure, etc.).
//
// The route always rewrites the WHOLE KV bundle at key
// 'storage_modes:v1'. Single bundled key — one KV read per Worker
// instance warmup serves every distinct org seen in that instance.
// Scales to ≥ 10k orgs (< 200KB JSON, well under KV's 25MB value
// limit) and mode changes are rare ("managed migration" per v2
// whitepaper §2.2).
//
// Runs under cs_orchestrator via csOrchestrator() — matches the
// ADR-1025 internal-storage-route convention. The
// org_storage_modes_snapshot() RPC is SECURITY DEFINER + granted to
// cs_orchestrator so this route can call it.

import { NextResponse } from 'next/server'
import { csOrchestrator } from '@/lib/api/cs-orchestrator-client'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
// Mode sync is a small payload + one CF API call; 60 s is plenty.
export const maxDuration = 60

const SECRET = process.env.STORAGE_PROVISION_SECRET ?? ''
const CF_ACCOUNT_ID = process.env.CLOUDFLARE_ACCOUNT_ID ?? ''
const CF_API_TOKEN = process.env.CLOUDFLARE_API_TOKEN ?? ''
const CF_KV_NAMESPACE_ID = process.env.CLOUDFLARE_KV_NAMESPACE_ID ?? ''

const KV_KEY = 'storage_modes:v1'

export async function POST(request: Request) {
  if (!SECRET) {
    return NextResponse.json(
      { error: 'STORAGE_PROVISION_SECRET not configured' },
      { status: 500 },
    )
  }
  const auth = request.headers.get('authorization') ?? ''
  if (!auth.startsWith('Bearer ') || auth.slice(7).trim() !== SECRET) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  if (!CF_ACCOUNT_ID || !CF_API_TOKEN || !CF_KV_NAMESPACE_ID) {
    return NextResponse.json(
      {
        error: 'cf_kv_not_configured',
        missing: [
          !CF_ACCOUNT_ID && 'CLOUDFLARE_ACCOUNT_ID',
          !CF_API_TOKEN && 'CLOUDFLARE_API_TOKEN',
          !CF_KV_NAMESPACE_ID && 'CLOUDFLARE_KV_NAMESPACE_ID',
        ].filter(Boolean),
      },
      { status: 500 },
    )
  }

  const started = Date.now()

  const pg = csOrchestrator()
  const rows = (await pg`
    select public.org_storage_modes_snapshot() as snapshot
  `) as unknown as Array<{ snapshot: Record<string, string> | null }>

  const snapshot = rows[0]?.snapshot ?? {}
  const orgCount = Object.keys(snapshot).length
  const body = JSON.stringify(snapshot)

  // Cloudflare KV REST API — single-key PUT (bulk-write is overkill
  // for one ~200KB value, and the single-key endpoint has the
  // simplest error shape to reason about).
  const kvUrl =
    `https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}` +
    `/storage/kv/namespaces/${CF_KV_NAMESPACE_ID}/values/${encodeURIComponent(KV_KEY)}`
  const resp = await fetch(kvUrl, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${CF_API_TOKEN}`,
      'Content-Type': 'text/plain',
    },
    body,
  })

  if (!resp.ok) {
    const text = await resp.text().catch(() => '')
    return NextResponse.json(
      {
        error: 'cf_kv_put_failed',
        status: resp.status,
        detail: text.slice(0, 400),
      },
      { status: 502 },
    )
  }

  return NextResponse.json({
    ok: true,
    kv_key: KV_KEY,
    org_count: orgCount,
    payload_bytes: Buffer.byteLength(body, 'utf8'),
    duration_ms: Date.now() - started,
  })
}
