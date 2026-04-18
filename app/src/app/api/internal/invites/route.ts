import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { verifyPayload } from '@/lib/invitations/marketing-signature'

// ADR-0044 Phase 2.6 — HMAC-gated invite creation for the marketing
// site. Stub today (no live consumer); the route shape + signature
// contract is committed so the marketing site can integrate without
// a round-trip redesign.
//
// Auth model:
//   * x-cs-signature + x-cs-timestamp headers verified against
//     INVITES_MARKETING_SECRET (shared with the marketing site).
//   * Timestamp must be within ±5 minutes (replay bound).
//   * On success, cs_orchestrator calls
//     public.create_invitation_from_marketing(...) which drops the
//     is_admin JWT check (is_admin is for the logged-in operator
//     path). cs_orchestrator is the established scoped role for
//     trusted server-to-server RPC calls.
//
// The AFTER-INSERT trigger on public.invitations (Phase 2.5) fires
// Resend automatically — this route does not send email itself.

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!
const ORCHESTRATOR_KEY = process.env.CS_ORCHESTRATOR_ROLE_KEY!
const MARKETING_SECRET = process.env.INVITES_MARKETING_SECRET ?? ''
const APP_BASE_URL =
  process.env.NEXT_PUBLIC_APP_URL ??
  process.env.NEXT_PUBLIC_CUSTOMER_APP_URL ??
  'https://app.consentshield.in'

interface Body {
  email?: string
  plan_code?: string
  trial_days?: number | null
  default_org_name?: string | null
  expires_in_days?: number
}

export async function POST(request: Request) {
  if (!MARKETING_SECRET) {
    return NextResponse.json(
      { error: 'INVITES_MARKETING_SECRET not configured' },
      { status: 500 },
    )
  }

  // Read the raw body once; HMAC is computed over bytes, not over
  // the parsed JSON.
  const rawBody = await request.text()

  const verdict = verifyPayload(rawBody, MARKETING_SECRET, {
    timestamp: request.headers.get('x-cs-timestamp'),
    signature: request.headers.get('x-cs-signature'),
  })

  if (!verdict.ok) {
    const status = verdict.reason === 'stale' ? 408 : 401
    return NextResponse.json({ error: verdict.reason }, { status })
  }

  let body: Body
  try {
    body = JSON.parse(rawBody) as Body
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 })
  }

  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : ''
  if (!email || email.length < 3 || !email.includes('@')) {
    return NextResponse.json({ error: 'email_required' }, { status: 400 })
  }
  if (!body.plan_code || typeof body.plan_code !== 'string') {
    return NextResponse.json({ error: 'plan_code_required' }, { status: 400 })
  }

  const expiresInDays = body.expires_in_days ?? 14
  if (
    !Number.isInteger(expiresInDays) ||
    expiresInDays < 1 ||
    expiresInDays > 90
  ) {
    return NextResponse.json({ error: 'expires_in_days_out_of_range' }, { status: 400 })
  }

  const trialDays =
    body.trial_days === undefined || body.trial_days === null ? null : body.trial_days
  if (trialDays !== null && (!Number.isInteger(trialDays) || trialDays < 0 || trialDays > 365)) {
    return NextResponse.json({ error: 'trial_days_out_of_range' }, { status: 400 })
  }

  const supabase = createClient(SUPABASE_URL, ORCHESTRATOR_KEY, {
    auth: { persistSession: false },
  })

  const { data, error } = await supabase.rpc('create_invitation_from_marketing', {
    p_email: email,
    p_plan_code: body.plan_code,
    p_trial_days: trialDays,
    p_default_org_name:
      typeof body.default_org_name === 'string' && body.default_org_name.trim().length > 0
        ? body.default_org_name.trim()
        : null,
    p_expires_in_days: expiresInDays,
  })

  if (error) {
    // 23505 = unique_violation → pending invite already exists for
    // this email. That's a client-side duplicate, not a server error.
    if (error.code === '23505') {
      return NextResponse.json(
        { error: 'pending_invite_already_exists' },
        { status: 409 },
      )
    }
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  const row = Array.isArray(data) ? data[0] : data
  if (!row?.token || !row?.id) {
    return NextResponse.json({ error: 'rpc_returned_no_row' }, { status: 500 })
  }

  const expiresAt = new Date(
    Date.now() + expiresInDays * 24 * 60 * 60 * 1000,
  ).toISOString()

  return NextResponse.json(
    {
      invitation_id: row.id,
      accept_url: `${APP_BASE_URL}/signup?invite=${row.token}`,
      expires_at: expiresAt,
    },
    { status: 201 },
  )
}
