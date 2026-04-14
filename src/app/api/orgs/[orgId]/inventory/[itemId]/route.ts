import { createServerClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ orgId: string; itemId: string }> },
) {
  const { orgId, itemId } = await params
  const supabase = await createServerClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json()
  const updates: Record<string, unknown> = {}
  for (const key of [
    'data_category',
    'collection_source',
    'legal_basis',
    'retention_period',
    'notes',
  ]) {
    if (typeof body[key] === 'string') updates[key] = body[key]
  }
  for (const key of ['purposes', 'third_parties', 'data_locations']) {
    if (Array.isArray(body[key])) updates[key] = body[key]
  }
  if (typeof body.is_complete === 'boolean') updates.is_complete = body.is_complete

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: 'No updatable fields provided' }, { status: 400 })
  }

  const { data, error } = await supabase
    .from('data_inventory')
    .update(updates)
    .eq('id', itemId)
    .eq('org_id', orgId)
    .select('*')
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ item: data })
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ orgId: string; itemId: string }> },
) {
  const { orgId, itemId } = await params
  const supabase = await createServerClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { error } = await supabase
    .from('data_inventory')
    .delete()
    .eq('id', itemId)
    .eq('org_id', orgId)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ deleted: true })
}
