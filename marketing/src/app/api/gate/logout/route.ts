// POST /api/gate/logout — ADR-0502 Sprint 1.2.

import { NextResponse } from 'next/server'
import { logGateEvent } from '@/lib/gate/log'
import {
  COOKIE_SESSION,
  COOKIE_PENDING,
  buildClearCookie,
  gateCookieDomain,
} from '@/lib/gate/cookies'

export async function POST(req: Request): Promise<Response> {
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null
  const ua = req.headers.get('user-agent')
  const host = req.headers.get('host')
  const requestId = req.headers.get('x-vercel-id')
  const domain = gateCookieDomain(host)

  const res = NextResponse.json({ ok: true, redirect: '/gate' })
  res.headers.append('Set-Cookie', buildClearCookie(COOKIE_SESSION, { domain }))
  res.headers.append('Set-Cookie', buildClearCookie(COOKIE_PENDING, { domain }))

  logGateEvent({
    event: 'gate.session.cleared',
    outcome: 'logout',
    ip,
    userAgent: ua,
    requestId,
  })

  return res
}
