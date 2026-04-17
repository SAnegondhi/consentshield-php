// Supabase Edge Function: sync-admin-config-to-kv
//
// Scheduled every 2 minutes via pg_cron (admin-sync-config-to-kv).
// Reads the consolidated admin config via public.admin_config_snapshot()
// and materialises it into Cloudflare KV so the Cloudflare Worker can
// read the current state without touching Postgres on every banner
// request.
//
// KV layout (all keys on the BANNER_KV namespace, prefixed `admin:`):
//
//   admin:config:v1          → full JSON blob (kill_switches + active
//                              tracker signatures + published sectoral
//                              templates + refreshed_at). The Worker
//                              reads this one key.
//
// Why a single key: KV reads in the Worker hot path are cheap but
// non-zero. Bundling the three slices avoids 3 lookups per banner
// request. The snapshot is small (≈5KB even at 100 signatures +
// 10 templates).
//
// ADR-0027 Sprint 3.2.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const ORCHESTRATOR_KEY = Deno.env.get('CS_ORCHESTRATOR_ROLE_KEY')
if (!ORCHESTRATOR_KEY) {
  throw new Error(
    'CS_ORCHESTRATOR_ROLE_KEY is required. Set it via `supabase secrets set CS_ORCHESTRATOR_ROLE_KEY=<value>`.',
  )
}

const CF_ACCOUNT_ID = Deno.env.get('CF_ACCOUNT_ID')
const CF_API_TOKEN = Deno.env.get('CF_API_TOKEN')
const CF_KV_NAMESPACE_ID = Deno.env.get('CF_KV_NAMESPACE_ID')

Deno.serve(async () => {
  // 1) Pull the snapshot from Postgres via the SECURITY DEFINER RPC.
  const supabase = createClient(SUPABASE_URL, ORCHESTRATOR_KEY)
  const { data: snapshot, error } = await supabase.rpc('admin_config_snapshot')

  if (error) {
    return new Response(
      JSON.stringify({ error: 'snapshot_failed', detail: error.message }),
      { status: 500, headers: { 'Content-Type': 'application/json' } },
    )
  }

  // 2) Dry-run mode: if any Cloudflare credential is missing, return
  //    the snapshot so operators can inspect it without writing to KV.
  //    The admin app can call this endpoint to preview what the next
  //    sync would push.
  if (!CF_ACCOUNT_ID || !CF_API_TOKEN || !CF_KV_NAMESPACE_ID) {
    return new Response(
      JSON.stringify({
        mode: 'dry_run',
        reason: 'Cloudflare KV credentials missing (CF_ACCOUNT_ID / CF_API_TOKEN / CF_KV_NAMESPACE_ID)',
        snapshot,
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    )
  }

  // 3) Push the snapshot to Cloudflare KV. Single key per spec comment
  //    above — the Worker reads admin:config:v1 and parses the blob.
  const kvKey = 'admin:config:v1'
  const kvValue = JSON.stringify(snapshot)
  const kvUrl = `https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/storage/kv/namespaces/${CF_KV_NAMESPACE_ID}/values/${encodeURIComponent(kvKey)}`

  const putRes = await fetch(kvUrl, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${CF_API_TOKEN}`,
      'Content-Type': 'text/plain',
    },
    body: kvValue,
  })

  if (!putRes.ok) {
    const detail = await putRes.text()
    return new Response(
      JSON.stringify({ error: 'kv_put_failed', status: putRes.status, detail }),
      { status: 502, headers: { 'Content-Type': 'application/json' } },
    )
  }

  return new Response(
    JSON.stringify({
      mode: 'wrote',
      key: kvKey,
      bytes: kvValue.length,
      kill_switch_count: Object.keys((snapshot as { kill_switches: Record<string, boolean> }).kill_switches).length,
      tracker_signature_count: (snapshot as { active_tracker_signatures: unknown[] }).active_tracker_signatures.length,
      sectoral_template_count: (snapshot as { published_sectoral_templates: unknown[] }).published_sectoral_templates.length,
    }),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  )
})
