import { NextResponse } from 'next/server'
import { csOrchestrator } from '@/lib/api/cs-orchestrator-client'
import { provisionStorageForOrg } from '@/lib/storage/provision-org'
import { CfProvisionError } from '@/lib/storage/cf-provision'

// ADR-1025 Phase 2 Sprint 2.1 — customer-storage auto-provisioning endpoint.
//
// Callers:
//   * data_inventory AFTER INSERT trigger (first row per org) via net.http_post
//   * admin.provision_customer_storage(org_id) RPC via net.http_post
//   * operator retry via `curl -H "Authorization: Bearer $STORAGE_PROVISION_SECRET"`
//
// Runs the full flow end-to-end: createBucket → createBucketScopedToken →
// 5s propagation → runVerificationProbe → encrypt + upsert
// export_configurations → flip is_verified. Idempotent per org.
//
// Auth: shared bearer (`STORAGE_PROVISION_SECRET`). Same pattern as
// /api/internal/invitation-dispatch. The secret lives in Vercel env +
// Supabase Vault; it's stable unless rotated intentionally.

export const dynamic = 'force-dynamic'
// Fluid Compute (Node) — cf-provision uses node:crypto, node:fetch.
export const runtime = 'nodejs'

const PROVISION_SECRET = process.env.STORAGE_PROVISION_SECRET ?? ''

export async function POST(request: Request) {
  if (!PROVISION_SECRET) {
    return NextResponse.json(
      { error: 'STORAGE_PROVISION_SECRET not configured' },
      { status: 500 },
    )
  }

  const auth = request.headers.get('authorization') ?? ''
  if (!auth.startsWith('Bearer ')) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }
  const token = auth.slice('Bearer '.length).trim()
  if (token !== PROVISION_SECRET) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  let body: { org_id?: string }
  try {
    body = (await request.json()) as { org_id?: string }
  } catch {
    return NextResponse.json({ error: 'invalid body' }, { status: 400 })
  }
  const orgId = body.org_id
  if (!orgId || typeof orgId !== 'string') {
    return NextResponse.json(
      { error: 'org_id required' },
      { status: 400 },
    )
  }

  try {
    const result = await provisionStorageForOrg(csOrchestrator(), orgId)
    // Always return 200 — verification_failed is a recorded outcome, not
    // a transport error. Callers (trigger / admin RPC) can inspect status.
    return NextResponse.json({
      status: result.status,
      config_id: result.configId,
      bucket_name: result.bucketName,
      probe: result.probe
        ? {
            ok: result.probe.ok,
            probe_id: result.probe.probeId,
            duration_ms: result.probe.durationMs,
            failed_step: result.probe.failedStep,
            error: result.probe.error,
          }
        : undefined,
    })
  } catch (err) {
    // CF-level errors (auth, rate_limit, server, network) AND unexpected
    // errors both land here. Surface the CfProvisionError code when
    // available so the caller can distinguish transient-retry-possible
    // from config-broken.
    if (err instanceof CfProvisionError) {
      return NextResponse.json(
        { error: 'provisioning_failed', code: err.code, message: err.message },
        { status: err.code === 'auth' || err.code === 'config' ? 500 : 502 },
      )
    }
    return NextResponse.json(
      {
        error: 'provisioning_failed',
        message: err instanceof Error ? err.message : String(err),
      },
      { status: 500 },
    )
  }
}
