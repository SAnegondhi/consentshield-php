// ADR-1025 Phase 4 Sprint 4.1 — retention-cleanup worker.
//
// Called by pg_cron 'storage-retention-cleanup' daily at 03:00 IST
// (21:30 UTC) via net.http_post → dispatch_storage_retention_cleanup().
// Finds forward_only migrations whose retention_until has passed and
// deletes the old CS-managed bucket + revokes its tokens.

import { NextResponse } from 'next/server'
import { csOrchestrator } from '@/lib/api/cs-orchestrator-client'
import { processRetentionCleanup } from '@/lib/storage/retention-cleanup'

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
  const summary = await processRetentionCleanup(pg)
  return NextResponse.json(summary)
}
