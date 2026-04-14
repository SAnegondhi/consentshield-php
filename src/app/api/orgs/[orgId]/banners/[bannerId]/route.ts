import { createServerClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'

const VALID_POSITIONS = ['bottom-bar', 'bottom-left', 'bottom-right', 'modal']

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ orgId: string; bannerId: string }> },
) {
  const { orgId, bannerId } = await params
  const supabase = await createServerClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data, error } = await supabase
    .from('consent_banners')
    .select('*')
    .eq('id', bannerId)
    .eq('org_id', orgId)
    .single()

  if (error || !data) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  return NextResponse.json({ banner: data })
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ orgId: string; bannerId: string }> },
) {
  const { orgId, bannerId } = await params
  const supabase = await createServerClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json()
  const updates: Record<string, unknown> = {}

  if (typeof body.headline === 'string') updates.headline = body.headline
  if (typeof body.body_copy === 'string') updates.body_copy = body.body_copy
  if (typeof body.position === 'string') {
    if (!VALID_POSITIONS.includes(body.position)) {
      return NextResponse.json(
        { error: `position must be one of: ${VALID_POSITIONS.join(', ')}` },
        { status: 400 },
      )
    }
    updates.position = body.position
  }
  if (Array.isArray(body.purposes)) updates.purposes = body.purposes
  if (typeof body.monitoring_enabled === 'boolean') {
    updates.monitoring_enabled = body.monitoring_enabled
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: 'No updatable fields provided' }, { status: 400 })
  }

  const { data, error } = await supabase
    .from('consent_banners')
    .update(updates)
    .eq('id', bannerId)
    .eq('org_id', orgId)
    .select('*')
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ banner: data })
}
