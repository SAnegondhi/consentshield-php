import { createServerClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'

export async function POST(
  request: Request,
  { params }: { params: Promise<{ orgId: string; id: string }> },
) {
  const { orgId, id } = await params
  const supabase = await createServerClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json()
  const { event_type, notes, metadata } = body

  if (!event_type) {
    return NextResponse.json({ error: 'event_type is required' }, { status: 400 })
  }

  // rpc_rights_event_append (ADR-0009) verifies auth.uid() membership in p_org_id
  // and performs the insert as cs_orchestrator.
  const { data, error } = await supabase.rpc('rpc_rights_event_append', {
    p_org_id: orgId,
    p_request_id: id,
    p_event_type: event_type,
    p_notes: notes ?? null,
    p_metadata: metadata ?? null,
  })

  if (error) {
    const code = error.code
    if (code === '28000') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    if (code === '42501') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  const envelope = data as { ok: boolean; event_id?: string }
  return NextResponse.json({ event: { id: envelope.event_id } }, { status: 201 })
}
