import { createClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'
import { hashOtp } from '@/lib/rights/otp'
import { checkRateLimit } from '@/lib/rights/rate-limit'
import { sendComplianceNotification } from '@/lib/rights/email'

export async function POST(request: Request) {
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown'

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

  const anon = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  )

  const { data, error } = await anon.rpc('rpc_rights_request_verify_otp', {
    p_request_id: body.request_id,
    p_otp_hash: hashOtp(body.otp),
  })

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  const envelope = data as {
    ok: boolean
    error?: string
    org_id?: string
    org_name?: string
    compliance_contact_email?: string
    request_type?: string
    requestor_name?: string
    requestor_email?: string
  }

  if (!envelope.ok) {
    const errorMap: Record<string, { status: number; message: string }> = {
      not_found: { status: 404, message: 'Request not found' },
      already_verified: { status: 400, message: 'Already verified' },
      no_otp_issued: { status: 400, message: 'No OTP issued for this request' },
      expired: { status: 400, message: 'Code expired. Please start a new request.' },
      too_many_attempts: { status: 400, message: 'Too many wrong attempts. Please start a new request.' },
      invalid_otp: { status: 400, message: 'Invalid code' },
    }
    const mapped = errorMap[envelope.error ?? ''] ?? { status: 400, message: envelope.error ?? 'Verification failed' }
    return NextResponse.json({ error: mapped.message }, { status: mapped.status })
  }

  if (envelope.compliance_contact_email) {
    const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'
    await sendComplianceNotification(
      envelope.compliance_contact_email,
      envelope.org_name ?? 'your organisation',
      envelope.request_type ?? 'access',
      envelope.requestor_name ?? '',
      envelope.requestor_email ?? '',
      `${appUrl}/dashboard/rights/${body.request_id}`,
    )
  }

  return NextResponse.json({ verified: true })
}
