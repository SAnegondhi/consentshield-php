import { createServerClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'

interface Purpose {
  id: string
  name: string
  description: string
  required: boolean
  default: boolean
}

const VALID_POSITIONS = ['bottom-bar', 'bottom-left', 'bottom-right', 'modal']

export async function GET(
  request: Request,
  { params }: { params: Promise<{ orgId: string }> },
) {
  const { orgId } = await params
  const supabase = await createServerClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const url = new URL(request.url)
  const propertyId = url.searchParams.get('property_id')

  let query = supabase
    .from('consent_banners')
    .select('id, property_id, version, is_active, headline, body_copy, position, purposes, monitoring_enabled, created_at')
    .eq('org_id', orgId)
    .order('created_at', { ascending: false })

  if (propertyId) {
    query = query.eq('property_id', propertyId)
  }

  const { data, error } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ banners: data })
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ orgId: string }> },
) {
  const { orgId } = await params
  const supabase = await createServerClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json()
  const { property_id, headline, body_copy, position, purposes, monitoring_enabled } = body

  if (!property_id || !headline || !body_copy) {
    return NextResponse.json(
      { error: 'property_id, headline, body_copy are required' },
      { status: 400 },
    )
  }

  const finalPosition = position || 'bottom-bar'
  if (!VALID_POSITIONS.includes(finalPosition)) {
    return NextResponse.json(
      { error: `position must be one of: ${VALID_POSITIONS.join(', ')}` },
      { status: 400 },
    )
  }

  const finalPurposes = validatePurposes(purposes)
  if (!finalPurposes.ok) {
    return NextResponse.json({ error: finalPurposes.error }, { status: 400 })
  }

  // Find next version for this property
  const { data: existing } = await supabase
    .from('consent_banners')
    .select('version')
    .eq('property_id', property_id)
    .order('version', { ascending: false })
    .limit(1)

  const nextVersion = existing && existing.length > 0 ? existing[0].version + 1 : 1

  const { data, error } = await supabase
    .from('consent_banners')
    .insert({
      org_id: orgId,
      property_id,
      version: nextVersion,
      is_active: false,
      headline,
      body_copy,
      position: finalPosition,
      purposes: finalPurposes.value,
      monitoring_enabled: monitoring_enabled !== false,
    })
    .select('*')
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ banner: data }, { status: 201 })
}

function validatePurposes(
  purposes: unknown,
): { ok: true; value: Purpose[] } | { ok: false; error: string } {
  if (purposes === undefined || purposes === null) return { ok: true, value: [] }
  if (!Array.isArray(purposes)) return { ok: false, error: 'purposes must be an array' }

  const validated: Purpose[] = []
  for (const p of purposes) {
    if (typeof p !== 'object' || p === null) {
      return { ok: false, error: 'each purpose must be an object' }
    }
    const obj = p as Record<string, unknown>
    if (typeof obj.id !== 'string' || typeof obj.name !== 'string') {
      return { ok: false, error: 'each purpose needs id and name strings' }
    }
    validated.push({
      id: obj.id,
      name: obj.name,
      description: typeof obj.description === 'string' ? obj.description : '',
      required: obj.required === true,
      default: obj.default === true,
    })
  }
  return { ok: true, value: validated }
}
