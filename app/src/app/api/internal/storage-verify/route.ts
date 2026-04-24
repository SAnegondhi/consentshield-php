// ADR-1025 Phase 4 Sprint 4.1 — nightly verify worker.
//
// Called by pg_cron 'storage-nightly-verify' daily at 02:00 IST (20:30
// UTC) via net.http_post → dispatch_storage_verify(). Iterates every
// verified export_configurations row, runs the probe, flips
// is_verified=false on failure.

import { NextResponse } from 'next/server'
import { csOrchestrator } from '@/lib/api/cs-orchestrator-client'
import { verifyAllVerifiedConfigs } from '@/lib/storage/nightly-verify'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const SECRET = process.env.STORAGE_PROVISION_SECRET ?? ''

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

  const pg = csOrchestrator()
  const summary = await verifyAllVerifiedConfigs(pg)
  return NextResponse.json(summary)
}
