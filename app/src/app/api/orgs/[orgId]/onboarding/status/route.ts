import { createServerClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'

// ADR-0058 Sprint 1.4 — onboarding status polled by Step 7.
// ADR-1025 Sprint 2.2 — also surfaces storage-provisioning state so the
// wizard can show a "Storage initialising…" soft banner while the
// background provision flow finishes.
//
// Returns the caller-org's onboarding watermarks. Org membership is
// verified explicitly (defense in depth on top of RLS) so a stray
// `/api/orgs/<other-org>/onboarding/status` request doesn't leak any
// field to a non-member — it 403s before the DB read.

export const dynamic = 'force-dynamic'

interface StatusResponse {
  onboarding_step: number
  onboarded_at: string | null
  first_consent_at: string | null
  /** ADR-1025: null = no export_configurations row yet (trigger in flight);
   *  false = row exists but probe hasn't succeeded; true = ready. */
  storage_verified: boolean | null
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ orgId: string }> },
) {
  const { orgId } = await params
  const supabase = await createServerClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { data: membership } = await supabase
    .from('org_memberships')
    .select('role')
    .eq('user_id', user.id)
    .eq('org_id', orgId)
    .maybeSingle()
  if (!membership) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { data, error } = await supabase
    .from('organisations')
    .select('onboarding_step, onboarded_at, first_consent_at')
    .eq('id', orgId)
    .single()

  if (error || !data) {
    return NextResponse.json(
      { error: error?.message ?? 'not found' },
      { status: 500 },
    )
  }

  // ADR-1025 Sprint 2.2 — storage provisioning state. Reads the one row
  // that the provisioning orchestrator upserts; `null` means the trigger
  // hasn't landed yet (wizard Step 4 → net.http_post is async), `false`
  // means a row exists but verification hasn't succeeded yet (transient
  // window), `true` means the bucket is ready.
  const { data: storageRow } = await supabase
    .from('export_configurations')
    .select('is_verified')
    .eq('org_id', orgId)
    .maybeSingle()

  const response: StatusResponse = {
    onboarding_step: (data.onboarding_step as number | null) ?? 0,
    onboarded_at: (data.onboarded_at as string | null) ?? null,
    first_consent_at: (data.first_consent_at as string | null) ?? null,
    storage_verified: storageRow
      ? ((storageRow.is_verified as boolean | null) ?? false)
      : null,
  }
  return NextResponse.json(response)
}
