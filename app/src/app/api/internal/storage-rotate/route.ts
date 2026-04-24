// ADR-1025 Phase 4 Sprint 4.1 — per-org credential rotation worker.
//
// Called by admin.storage_rotate_credentials(org_id, reason) via
// dispatch_storage_rotate(). Mints a new bucket-scoped token for the
// existing CS-managed bucket, probes, atomically swaps, revokes old.

import { NextResponse } from 'next/server'
import { csOrchestrator } from '@/lib/api/cs-orchestrator-client'
import { rotateStorageCredentials } from '@/lib/storage/rotate-org'

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

  let body: { org_id?: string }
  try {
    body = (await request.json()) as { org_id?: string }
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 })
  }
  const orgId = body.org_id
  if (!orgId) {
    return NextResponse.json({ error: 'org_id required' }, { status: 400 })
  }

  const result = await rotateStorageCredentials(csOrchestrator(), orgId)
  return NextResponse.json(result)
}
