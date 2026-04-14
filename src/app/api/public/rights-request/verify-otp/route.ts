import { createClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'
import { hashOtp } from '@/lib/rights/otp'
import { checkRateLimit } from '@/lib/rights/rate-limit'
import { sendComplianceNotification } from '@/lib/rights/email'

const MAX_ATTEMPTS = 5

export async function POST(request: Request) {
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown'

  // Rate limit OTP attempts: 10 per IP per hour
  const limit = checkRateLimit(`rights-otp:${ip}`, 10, 60)
  if (!limit.allowed) {
    return NextResponse.json(
      { error: 'Too many attempts. Try again later.' },
      { status: 429, headers: { 'Retry-After': String(limit.retryInSeconds) } },
    )
  }

  const body = (await request.json().catch(() => null)) as {
    request_id?: string
    otp?: string
  } | null

  if (!body?.request_id || !body.otp) {
    return NextResponse.json({ error: 'request_id and otp are required' }, { status: 400 })
  }

  const admin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  )

  const { data: req } = await admin
    .from('rights_requests')
    .select(
      'id, org_id, request_type, requestor_name, requestor_email, otp_hash, otp_expires_at, otp_attempts, email_verified',
    )
    .eq('id', body.request_id)
    .single()

  if (!req) {
    return NextResponse.json({ error: 'Request not found' }, { status: 404 })
  }

  if (req.email_verified) {
    return NextResponse.json(
      { error: 'Already verified' },
      { status: 400 },
    )
  }

  if (!req.otp_hash || !req.otp_expires_at) {
    return NextResponse.json({ error: 'No OTP issued for this request' }, { status: 400 })
  }

  if (new Date(req.otp_expires_at).getTime() < Date.now()) {
    return NextResponse.json({ error: 'Code expired. Please start a new request.' }, { status: 400 })
  }

  if ((req.otp_attempts ?? 0) >= MAX_ATTEMPTS) {
    return NextResponse.json(
      { error: 'Too many wrong attempts. Please start a new request.' },
      { status: 400 },
    )
  }

  const providedHash = hashOtp(body.otp)
  if (providedHash !== req.otp_hash) {
    await admin
      .from('rights_requests')
      .update({ otp_attempts: (req.otp_attempts ?? 0) + 1 })
      .eq('id', req.id)
    return NextResponse.json({ error: 'Invalid code' }, { status: 400 })
  }

  // OTP matches — mark verified, clear OTP fields
  const now = new Date().toISOString()
  await admin
    .from('rights_requests')
    .update({
      email_verified: true,
      email_verified_at: now,
      otp_hash: null,
      otp_expires_at: null,
      otp_attempts: 0,
      status: 'new',
    })
    .eq('id', req.id)

  // Append rights_request_events entry (via cs_orchestrator — using service role for now)
  await admin.from('rights_request_events').insert({
    request_id: req.id,
    org_id: req.org_id,
    event_type: 'created',
    notes: 'Rights request submitted and email verified',
  })

  // Notify compliance contact
  const { data: org } = await admin
    .from('organisations')
    .select('name, compliance_contact_email')
    .eq('id', req.org_id)
    .single()

  if (org?.compliance_contact_email) {
    const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'
    await sendComplianceNotification(
      org.compliance_contact_email,
      org.name,
      req.request_type,
      req.requestor_name,
      req.requestor_email,
      `${appUrl}/dashboard/rights/${req.id}`,
    )
  }

  // Write to audit_log (service role)
  await admin.from('audit_log').insert({
    org_id: req.org_id,
    event_type: 'rights_request_created',
    entity_type: 'rights_request',
    entity_id: req.id,
    payload: { request_type: req.request_type },
  })

  return NextResponse.json({ verified: true })
}
