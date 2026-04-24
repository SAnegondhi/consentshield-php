// ADR-1025 Phase 4 Sprint 4.2 — monthly storage usage snapshot worker.
//
// Called by pg_cron 'storage-usage-snapshot-monthly' on the 1st at
// 04:30 IST via net.http_post → dispatch_storage_usage_snapshot().
// Iterates every cs_managed_r2 org and captures a usage snapshot.

import { NextResponse } from 'next/server'
import { csOrchestrator } from '@/lib/api/cs-orchestrator-client'
import { captureStorageUsageSnapshots } from '@/lib/storage/fetch-usage'

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
  const summary = await captureStorageUsageSnapshots(pg)
  return NextResponse.json(summary)
}
