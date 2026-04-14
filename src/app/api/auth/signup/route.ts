import { createServerClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'

export async function POST(request: Request) {
  const supabase = await createServerClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { orgName, industry } = await request.json()
  if (!orgName) {
    return NextResponse.json({ error: 'orgName is required' }, { status: 400 })
  }

  // rpc_signup_bootstrap_org (ADR-0009) creates the org, adds the caller as
  // admin, and writes audit_log — all atomically as cs_orchestrator under
  // the caller's JWT (auth.uid() becomes the admin).
  const { data, error } = await supabase.rpc('rpc_signup_bootstrap_org', {
    p_org_name: orgName,
    p_industry: industry ?? null,
  })

  if (error) {
    if (error.code === '28000') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  const envelope = data as { ok: boolean; org_id: string; name: string }
  return NextResponse.json({ org: { id: envelope.org_id, name: envelope.name } })
}
