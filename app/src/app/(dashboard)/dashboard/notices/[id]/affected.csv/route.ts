// ADR-1004 Phase 2 Sprint 2.2 — CSV export of affected artefacts on
// the prior version of a material notice.
//
// Reads via the SECURITY DEFINER `rpc_notice_affected_artefacts` RPC
// which fences org_id + caps the row count. The export is operator-
// only (the dashboard route is auth-gated) but the RPC is also
// org_id-checked so a leaked URL doesn't leak data outside the org.

import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

interface AffectedRow {
  artefact_id: string
  status: string
  replaced_by: string | null
  purpose_codes: string[]
  last_consent_at: string | null
  email: string | null
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: noticeId } = await params

  const supabase = await createServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return new NextResponse('Unauthorized', { status: 401 })

  const { data: membership } = await supabase
    .from('org_memberships')
    .select('org_id')
    .eq('user_id', user.id)
    .single()
  if (!membership) return new NextResponse('No org', { status: 403 })

  const orgId = (membership as { org_id: string }).org_id

  const { data, error } = await supabase.rpc('rpc_notice_affected_artefacts', {
    p_org_id: orgId,
    p_notice_id: noticeId,
    p_limit: 500,
  })
  if (error) {
    return new NextResponse(error.message, { status: 422 })
  }

  const rows = (data ?? []) as AffectedRow[]

  const header = [
    'artefact_id',
    'status',
    'replaced_by',
    'purpose_codes',
    'last_consent_at',
    'email',
  ].join(',')
  const body = rows
    .map((r) =>
      [
        csvEscape(r.artefact_id),
        csvEscape(r.status),
        csvEscape(r.replaced_by ?? ''),
        csvEscape((r.purpose_codes ?? []).join(';')),
        csvEscape(r.last_consent_at ?? ''),
        csvEscape(r.email ?? ''),
      ].join(','),
    )
    .join('\n')
  const payload = `${header}\n${body}\n`

  return new NextResponse(payload, {
    status: 200,
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="affected-notice-${noticeId}.csv"`,
      'Cache-Control': 'no-store',
    },
  })
}

function csvEscape(v: string): string {
  if (v == null) return ''
  if (v.includes(',') || v.includes('"') || v.includes('\n')) {
    return `"${v.replace(/"/g, '""')}"`
  }
  return v
}
