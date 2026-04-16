import { createClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'
import { verifyTurnstileToken } from '@/lib/rights/turnstile'
import { generateOtp, hashOtp, otpExpiryIso } from '@/lib/rights/otp'
import { checkRateLimit } from '@/lib/rights/rate-limit'
import { sendOtpEmail } from '@/lib/rights/email'

const VALID_TYPES = ['erasure', 'access', 'correction', 'nomination']

export async function POST(request: Request) {
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown'

  const limit = await checkRateLimit(`rl:rights:${ip}`, 5, 60)
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

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(requestor_email)) {
    return NextResponse.json({ error: 'Invalid email format' }, { status: 400 })
  }

  const turnstile = await verifyTurnstileToken(turnstile_token ?? '', ip)
  if (!turnstile.ok) {
    return NextResponse.json({ error: turnstile.error }, { status: 403 })
  }

  const otpCode = generateOtp()
  const anon = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  )

  const { data, error } = await anon.rpc('rpc_rights_request_create', {
    p_org_id: org_id,
    p_request_type: request_type,
    p_requestor_name: requestor_name,
    p_requestor_email: requestor_email,
    p_requestor_message: requestor_message ?? null,
    p_otp_hash: hashOtp(otpCode),
    p_otp_expires_at: otpExpiryIso(15),
  })

  if (error) {
    const msg = error.message ?? ''
    if (msg.includes('unknown organisation')) {
      return NextResponse.json({ error: 'Unknown organisation' }, { status: 404 })
    }
    if (msg.includes('invalid')) {
      return NextResponse.json({ error: msg }, { status: 400 })
    }
    return NextResponse.json({ error: msg || 'Failed to create rights request' }, { status: 500 })
  }

  const row = Array.isArray(data) ? data[0] : data
  if (!row?.request_id) {
    return NextResponse.json({ error: 'Failed to create rights request' }, { status: 500 })
  }

  await sendOtpEmail(requestor_email, otpCode, row.org_name ?? 'your organisation')

  return NextResponse.json(
    {
      request_id: row.request_id,
      message: 'Verification code sent. Enter it to confirm your request.',
    },
    { status: 201 },
  )
}
