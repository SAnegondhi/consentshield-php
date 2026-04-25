// POST /api/gate/request-otp — ADR-0502 Sprint 1.2.
//
// Always returns 200 with a generic acknowledgement so the gate doesn't
// enumerate which emails are on the allowlist. Side-effects fire only
// when the email is invited and the rate limit isn't tripped.

import { NextResponse } from 'next/server'
import { sign } from '@/lib/gate/jwt'
import { generateOtp, hashOtp } from '@/lib/gate/otp'
import { isInvited } from '@/lib/gate/allowlist'
import { logGateEvent } from '@/lib/gate/log'
import { tryConsume } from '@/lib/gate/rate-limit'
import { buildOtpEmail } from '@/lib/gate/templates'
import {
  COOKIE_PENDING,
  PENDING_TTL_SECONDS,
  buildCookie,
  gateCookieDomain,
} from '@/lib/gate/cookies'
import { RESEND_API_KEY, INVITE_FROM } from '@/lib/env'

interface RequestBody {
  email?: unknown
}

export async function POST(req: Request): Promise<Response> {
  const secret = process.env.MARKETING_GATE_SECRET
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null
  const ua = req.headers.get('user-agent')
  const host = req.headers.get('host')
  const requestId = req.headers.get('x-vercel-id')

  // Generic 200 — always shaped the same so the gate does not enumerate.
  const ack = NextResponse.json({ ok: true })

  if (!secret) {
    logGateEvent({
      event: 'gate.otp.requested',
      outcome: 'invalid_input',
      ip,
      userAgent: ua,
      requestId,
      email: 'config_missing',
    })
    return ack
  }

  let body: RequestBody
  try {
    body = (await req.json()) as RequestBody
  } catch {
    logGateEvent({
      event: 'gate.otp.requested',
      outcome: 'invalid_input',
      ip,
      userAgent: ua,
      requestId,
    })
    return ack
  }

  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : ''
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    logGateEvent({
      event: 'gate.otp.requested',
      outcome: 'invalid_input',
      ip,
      userAgent: ua,
      requestId,
    })
    return ack
  }

  // Per-IP rate limit: 3 requests / 5 minutes.
  const rl = tryConsume(`req-otp:${ip ?? 'unknown'}`, 3, 5 * 60 * 1000)
  if (!rl.ok) {
    logGateEvent({
      event: 'gate.otp.requested',
      outcome: 'rate_limited',
      email,
      ip,
      userAgent: ua,
      requestId,
      retryAfterMs: rl.retryAfterMs,
    })
    return ack
  }

  if (!isInvited(email)) {
    logGateEvent({
      event: 'gate.otp.requested',
      outcome: 'accepted',
      email,
      ip,
      userAgent: ua,
      requestId,
    })
    return ack
  }

  const otp = generateOtp()
  const { hash, salt } = hashOtp(otp)
  const now = Math.floor(Date.now() / 1000)
  const pendingToken = await sign(
    {
      iat: now,
      exp: now + PENDING_TTL_SECONDS,
      email,
      otp_hash: hash,
      salt,
      attempts_used: 0,
    },
    secret,
  )

  // Send the OTP via Resend's REST API. Direct fetch matches the
  // pattern in /api/internal/send-email so the marketing project keeps
  // a single Resend integration and no new npm dep. Failures are logged
  // but never surfaced — same generic ack response so an attacker can't
  // probe for delivery failure.
  if (RESEND_API_KEY.length > 0) {
    try {
      const { subject, text, html } = buildOtpEmail(otp, email)
      const resendRes = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${RESEND_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: INVITE_FROM,
          to: email,
          subject,
          text,
          html,
        }),
      })
      if (!resendRes.ok) {
        const body = await resendRes.text().catch(() => '')
        console.error('gate.otp.requested resend status:', resendRes.status, body.slice(0, 400))
      }
    } catch (err) {
      logGateEvent({
        event: 'gate.otp.requested',
        outcome: 'invalid_input',
        email,
        ip,
        userAgent: ua,
        requestId,
      })
      console.error('gate.otp.requested resend error:', err instanceof Error ? err.message : err)
      return ack
    }
  } else {
    // Dev fallback: log the OTP server-side so local smoke tests proceed.
    console.log(`[gate.dev] OTP for ${email}: ${otp}`)
  }

  ack.headers.append(
    'Set-Cookie',
    buildCookie(COOKIE_PENDING, pendingToken, PENDING_TTL_SECONDS, {
      domain: gateCookieDomain(host),
    }),
  )

  logGateEvent({
    event: 'gate.otp.requested',
    outcome: 'accepted',
    email,
    ip,
    userAgent: ua,
    requestId,
  })

  return ack
}
