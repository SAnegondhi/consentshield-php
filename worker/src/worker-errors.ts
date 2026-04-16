import type { Env } from './index'

// N-S1 fix: persist Worker → Supabase write failures to the worker_errors
// operational table so operators see ingestion breakage from the dashboard,
// not only from Cloudflare log tailing.
//
// Called via ctx.waitUntil() so it never adds latency to the customer's
// page. Best-effort: if this POST also fails (Supabase fully down), the
// Cloudflare console.error remains the last line of defence.

export interface WorkerErrorRecord {
  org_id: string
  property_id?: string
  endpoint: string
  status_code: number
  upstream_error: string
}

export async function logWorkerError(
  env: Env,
  record: WorkerErrorRecord,
): Promise<void> {
  try {
    await fetch(`${env.SUPABASE_URL}/rest/v1/worker_errors`, {
      method: 'POST',
      headers: {
        apikey: env.SUPABASE_WORKER_KEY,
        Authorization: `Bearer ${env.SUPABASE_WORKER_KEY}`,
        'Content-Type': 'application/json',
        Prefer: 'return=minimal',
      },
      body: JSON.stringify({
        org_id: record.org_id,
        property_id: record.property_id ?? null,
        endpoint: record.endpoint,
        status_code: record.status_code,
        // Cap the upstream error text — Supabase REST errors can be verbose
        // and we don't need novella-length payloads in an ops table.
        upstream_error: record.upstream_error.slice(0, 1000),
      }),
    })
  } catch (e) {
    console.error('worker_errors insert also failed:', e)
  }
}
