import { createClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'
import { verifyCallback } from '@/lib/rights/callback-signing'

// Public callback endpoint. Signature-verified, no auth required. State
// transitions are enforced by rpc_deletion_receipt_confirm (ADR-0009).
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  const url = new URL(request.url)
  const sig = url.searchParams.get('sig')

  if (!sig || !verifyCallback(id, sig)) {
    return NextResponse.json({ error: 'Invalid or missing signature' }, { status: 403 })
  }

  const body = (await request.json().catch(() => null)) as {
    request_id?: string
    status?: string
    records_deleted?: number
    systems_affected?: string[]
    completed_at?: string
  } | null

  if (!body) {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const anon = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  )

  const { data, error } = await anon.rpc('rpc_deletion_receipt_confirm', {
    p_receipt_id: id,
    p_reported_status: body.status ?? 'completed',
    p_records_deleted: body.records_deleted ?? 0,
    p_systems_affected: body.systems_affected ?? [],
    p_completed_at: body.completed_at ?? null,
  })

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  const envelope = data as {
    ok: boolean
    error?: string
    already_confirmed?: boolean
    receipt_id?: string
    status?: string
    current?: string
  }

  if (!envelope.ok) {
    switch (envelope.error) {
      case 'not_found':
        return NextResponse.json({ error: 'Receipt not found' }, { status: 404 })
      case 'invalid_state':
        return NextResponse.json(
          { error: `Receipt is in state '${envelope.current}'; only 'awaiting_callback' may be confirmed` },
          { status: 409 },
        )
      case 'race':
        return NextResponse.json({ error: 'Concurrent update; retry' }, { status: 409 })
      default:
        return NextResponse.json({ error: envelope.error ?? 'Update failed' }, { status: 400 })
    }
  }

  if (envelope.already_confirmed) {
    return NextResponse.json({ ok: true, already_confirmed: true })
  }

  return NextResponse.json({ ok: true, receipt_id: envelope.receipt_id, status: envelope.status })
}
