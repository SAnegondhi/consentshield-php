import { createClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'
import { verifyTurnstileToken } from '@/lib/rights/turnstile'
import { generateOtp, hashOtp, otpExpiryIso } from '@/lib/rights/otp'
import { checkRateLimit } from '@/lib/rights/rate-limit'
import { sendOtpEmail } from '@/lib/rights/email'

const VALID_TYPES = ['erasure', 'access', 'correction', 'nomination']

export async function POST(request: Request) {
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown'

  // Rate limit: 5 per IP per hour
  const limit = checkRateLimit(`rights:${ip}`, 5, 60)
  if (!limit.allowed) {
    return NextResponse.json(
      { error: 'Too many requests. Try again later.', retry_in_seconds: limit.retryInSeconds },
      { status: 429, headers: { 'Retry-After': String(limit.retryInSeconds) } },
    )
  }

  const body = (await request.json().catch(() => null)) as {
    org_id?: string
    request_type?: string
    requestor_name?: string
    requestor_email?: string
    requestor_message?: string
    turnstile_token?: string
  } | null

  if (!body) {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const { org_id, request_type, requestor_name, requestor_email, requestor_message, turnstile_token } =
    body

  if (!org_id || !request_type || !requestor_name || !requestor_email) {
    return NextResponse.json(
      { error: 'org_id, request_type, requestor_name, requestor_email are required' },
      { status: 400 },
    )
  }

  if (!VALID_TYPES.includes(request_type)) {
    return NextResponse.json(
      { error: `request_type must be one of: ${VALID_TYPES.join(', ')}` },
      { status: 400 },
    )
  }

  // Email format check
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(requestor_email)) {
    return NextResponse.json({ error: 'Invalid email format' }, { status: 400 })
  }

  // Turnstile verification
  const turnstile = await verifyTurnstileToken(turnstile_token ?? '', ip)
  if (!turnstile.ok) {
    return NextResponse.json({ error: turnstile.error }, { status: 403 })
  }

  // Verify org exists (using service role — public endpoint)
  const admin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  )

  const { data: org } = await admin
    .from('organisations')
    .select('id, name')
    .eq('id', org_id)
    .single()

  if (!org) {
    return NextResponse.json({ error: 'Unknown organisation' }, { status: 404 })
  }

  // Create rights request row (turnstile_verified=true, email_verified=false)
  const otpCode = generateOtp()
  const { data: rightsReq, error } = await admin
    .from('rights_requests')
    .insert({
      org_id: org.id,
      request_type,
      requestor_name,
      requestor_email,
      requestor_message,
      turnstile_verified: true,
      email_verified: false,
      otp_hash: hashOtp(otpCode),
      otp_expires_at: otpExpiryIso(15),
      status: 'new',
    })
    .select('id')
    .single()

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  // Send OTP email
  await sendOtpEmail(requestor_email, otpCode, org.name)

  return NextResponse.json(
    {
      request_id: rightsReq.id,
      message: 'Verification code sent. Enter it to confirm your request.',
    },
    { status: 201 },
  )
}
