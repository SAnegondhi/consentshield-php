// POST /api/gate/verify-otp — ADR-0502 Sprint 1.2.
//
// Reads the pending-token cookie, recomputes the OTP hash, compares
// constant-time. On success: clears pending, mints a 30-day session
// cookie. On failure: increments attempts_used in a re-signed pending
// cookie; >=3 attempts forces a fresh request.

import { NextResponse } from 'next/server'
import { sign, verify, JwtError } from '@/lib/gate/jwt'
import { hashOtp, constantTimeHexEqual } from '@/lib/gate/otp'
import { logGateEvent } from '@/lib/gate/log'
import {
  COOKIE_PENDING,
  COOKIE_SESSION,
  PENDING_TTL_SECONDS,
  SESSION_TTL_SECONDS,
  buildCookie,
  buildClearCookie,
  gateCookieDomain,
} from '@/lib/gate/cookies'

interface PendingPayload {
  iat: number
  exp: number
  email: string
  otp_hash: string
  salt: string
  attempts_used: number
  [key: string]: unknown
}

interface RequestBody {
  otp?: unknown
  from?: unknown
}

const MAX_ATTEMPTS = 3

export async function POST(req: Request): Promise<Response> {
  const secret = process.env.MARKETING_GATE_SECRET
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null
  const ua = req.headers.get('user-agent')
  const host = req.headers.get('host')
  const requestId = req.headers.get('x-vercel-id')
  const cookieDomain = gateCookieDomain(host)

  if (!secret) {
    logGateEvent({ event: 'gate.otp.verified', outcome: 'invalid_input', ip, userAgent: ua, requestId })
    return NextResponse.json({ ok: false, reason: 'config' }, { status: 500 })
  }

  let body: RequestBody
  try {
    body = (await req.json()) as RequestBody
  } catch {
    return NextResponse.json({ ok: false, reason: 'malformed' }, { status: 400 })
  }

  const otpInput = typeof body.otp === 'string' ? body.otp.trim() : ''
  const fromRaw = typeof body.from === 'string' ? body.from : '/'
  const from = sanitiseFrom(fromRaw)

  if (!/^\d{6}$/.test(otpInput)) {
    logGateEvent({
      event: 'gate.otp.verified',
      outcome: 'invalid_input',
      ip,
      userAgent: ua,
      requestId,
    })
    return NextResponse.json({ ok: false, reason: 'invalid_input' }, { status: 400 })
  }

  const pendingCookie = readCookie(req.headers.get('cookie'), COOKIE_PENDING)
  if (!pendingCookie) {
    logGateEvent({
      event: 'gate.otp.verified',
      outcome: 'expired',
      ip,
      userAgent: ua,
      requestId,
    })
    return NextResponse.json({ ok: false, reason: 'no_pending' }, { status: 401 })
  }

  let pending: PendingPayload
  try {
    pending = await verify<PendingPayload>(pendingCookie, secret)
  } catch (err) {
    const reason = err instanceof JwtError ? err.code : 'malformed'
    logGateEvent({
      event: 'gate.otp.verified',
      outcome: reason === 'expired' ? 'expired' : 'invalid_input',
      ip,
      userAgent: ua,
      requestId,
    })
    return clearPendingResponse(
      NextResponse.json({ ok: false, reason }, { status: 401 }),
      cookieDomain,
    )
  }

  if (typeof pending.email !== 'string' || typeof pending.otp_hash !== 'string' || typeof pending.salt !== 'string') {
    logGateEvent({
      event: 'gate.otp.verified',
      outcome: 'invalid_input',
      email: pending.email,
      ip,
      userAgent: ua,
      requestId,
    })
    return clearPendingResponse(
      NextResponse.json({ ok: false, reason: 'malformed_payload' }, { status: 401 }),
      cookieDomain,
    )
  }

  const { hash } = hashOtp(otpInput, pending.salt)
  const matched = constantTimeHexEqual(hash, pending.otp_hash)

  if (!matched) {
    const attemptsUsed = (pending.attempts_used ?? 0) + 1
    if (attemptsUsed >= MAX_ATTEMPTS) {
      logGateEvent({
        event: 'gate.otp.verified',
        outcome: 'attempts_exhausted',
        email: pending.email,
        ip,
        userAgent: ua,
        requestId,
        attemptsUsed,
      })
      return clearPendingResponse(
        NextResponse.json({ ok: false, reason: 'attempts_exhausted' }, { status: 401 }),
        cookieDomain,
      )
    }
    // Re-sign the pending token with the incremented attempt count.
    const refreshed = await sign(
      { ...pending, attempts_used: attemptsUsed },
      secret,
    )
    const res = NextResponse.json({ ok: false, reason: 'mismatch', attemptsRemaining: MAX_ATTEMPTS - attemptsUsed }, { status: 401 })
    res.headers.append(
      'Set-Cookie',
      buildCookie(COOKIE_PENDING, refreshed, Math.max(0, pending.exp - Math.floor(Date.now() / 1000)), {
        domain: cookieDomain,
      }),
    )
    logGateEvent({
      event: 'gate.otp.verified',
      outcome: 'mismatch',
      email: pending.email,
      ip,
      userAgent: ua,
      requestId,
      attemptsUsed,
    })
    return res
  }

  // Success — mint session cookie, clear pending, return redirect target.
  const now = Math.floor(Date.now() / 1000)
  const sessionToken = await sign(
    {
      iat: now,
      exp: now + SESSION_TTL_SECONDS,
      email: pending.email,
    },
    secret,
  )
  const res = NextResponse.json({ ok: true, redirect: from })
  res.headers.append(
    'Set-Cookie',
    buildCookie(COOKIE_SESSION, sessionToken, SESSION_TTL_SECONDS, {
      domain: cookieDomain,
    }),
  )
  res.headers.append(
    'Set-Cookie',
    buildClearCookie(COOKIE_PENDING, { domain: cookieDomain }),
  )

  logGateEvent({
    event: 'gate.otp.verified',
    outcome: 'success',
    email: pending.email,
    ip,
    userAgent: ua,
    requestId,
  })
  logGateEvent({
    event: 'gate.session.minted',
    outcome: 'created',
    email: pending.email,
    ip,
    userAgent: ua,
    requestId,
    iat: now,
  })
  return res
}

function readCookie(header: string | null, name: string): string | null {
  if (!header) return null
  for (const part of header.split(';')) {
    const eq = part.indexOf('=')
    if (eq === -1) continue
    if (part.slice(0, eq).trim() === name) return part.slice(eq + 1).trim()
  }
  return null
}

function clearPendingResponse(res: Response, domain: string | undefined): Response {
  const out = new NextResponse(res.body, res)
  out.headers.append('Set-Cookie', buildClearCookie(COOKIE_PENDING, { domain }))
  return out
}

function sanitiseFrom(raw: string): string {
  // Only accept same-origin paths beginning with `/` and not `//` (which
  // would be treated as a protocol-relative URL by the browser).
  if (!raw.startsWith('/') || raw.startsWith('//')) return '/'
  if (raw.startsWith('/gate') || raw.startsWith('/api/')) return '/'
  return raw
}
