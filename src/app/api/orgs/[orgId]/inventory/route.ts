import { createServerClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'

const VALID_LEGAL_BASES = [
  'consent',
  'contract',
  'legal_obligation',
  'legitimate_interest',
  'vital_interests',
  'public_task',
]

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ orgId: string }> },
) {
  const { orgId } = await params
  const supabase = await createServerClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data, error } = await supabase
    .from('data_inventory')
    .select('*')
    .eq('org_id', orgId)
    .order('created_at', { ascending: false })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ items: data })
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
  const {
    data_category,
    collection_source,
    purposes,
    legal_basis,
    retention_period,
    third_parties,
    data_locations,
    notes,
  } = body

  if (!data_category) {
    return NextResponse.json({ error: 'data_category is required' }, { status: 400 })
  }

  const finalLegalBasis = legal_basis || 'consent'
  if (!VALID_LEGAL_BASES.includes(finalLegalBasis)) {
    return NextResponse.json(
      { error: `legal_basis must be one of: ${VALID_LEGAL_BASES.join(', ')}` },
      { status: 400 },
    )
  }

  const { data, error } = await supabase
    .from('data_inventory')
    .insert({
      org_id: orgId,
      data_category,
      collection_source,
      purposes: Array.isArray(purposes) ? purposes : [],
      legal_basis: finalLegalBasis,
      retention_period,
      third_parties: Array.isArray(third_parties) ? third_parties : [],
      data_locations: Array.isArray(data_locations) ? data_locations : [],
      notes,
      source_type: 'manual',
      is_complete: !!(data_category && purposes && retention_period),
    })
    .select('*')
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ item: data }, { status: 201 })
}
