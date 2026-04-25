// ADR-0502 Sprint 1.2 — confidential-preview gate enforcement.
//
// Whitelist-based: anything not on the BYPASS list redirects to /gate
// when the session cookie is missing or invalid. Fail-closed by default.

import { NextResponse, type NextRequest } from 'next/server'
import { verify, JwtError } from '@/lib/gate/jwt'
import { COOKIE_SESSION } from '@/lib/gate/cookies'
import { logGateEvent } from '@/lib/gate/log'

interface SessionPayload {
  iat: number
  exp: number
  email: string
  [key: string]: unknown
}

const BYPASS_PREFIXES = [
  '/gate',
  '/api/gate/',
  '/_next/',
  '/monitoring', // Sentry tunnel route
]

const BYPASS_EXACT = new Set([
  '/favicon.ico',
  '/icon.svg',
  '/robots.txt',
  '/sitemap.xml',
])

export async function middleware(req: NextRequest): Promise<NextResponse> {
  const { pathname, search } = req.nextUrl

  if (BYPASS_EXACT.has(pathname)) return NextResponse.next()
  for (const prefix of BYPASS_PREFIXES) {
    if (pathname.startsWith(prefix)) return NextResponse.next()
  }

  const secret = process.env.MARKETING_GATE_SECRET
  if (!secret) {
    // Fail-closed: without a configured gate secret, the gate is not
    // operational. Redirect everyone to /gate where the form will fail
    // gracefully and the operator sees a clear log line.
    logGateEvent({
      event: 'gate.middleware.redirect',
      outcome: 'redirect',
      path: pathname,
      ip: req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null,
      userAgent: req.headers.get('user-agent'),
      requestId: req.headers.get('x-vercel-id'),
    })
    return redirectToGate(req, pathname, search)
  }

  const token = req.cookies.get(COOKIE_SESSION)?.value
  if (!token) {
    logGateEvent({
      event: 'gate.middleware.redirect',
      outcome: 'redirect',
      path: pathname,
      ip: req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null,
      userAgent: req.headers.get('user-agent'),
      requestId: req.headers.get('x-vercel-id'),
    })
    return redirectToGate(req, pathname, search)
  }

  try {
    await verify<SessionPayload>(token, secret)
    return NextResponse.next()
  } catch (err) {
    const reason = err instanceof JwtError ? err.code : 'unknown'
    logGateEvent({
      event: 'gate.middleware.redirect',
      outcome: 'redirect',
      path: pathname,
      ip: req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null,
      userAgent: req.headers.get('user-agent'),
      requestId: req.headers.get('x-vercel-id'),
    })
    void reason
    return redirectToGate(req, pathname, search)
  }
}

function redirectToGate(req: NextRequest, pathname: string, search: string): NextResponse {
  const url = req.nextUrl.clone()
  url.pathname = '/gate'
  const from = pathname + (search ?? '')
  url.search = `?from=${encodeURIComponent(from)}`
  return NextResponse.redirect(url)
}

// Match every path except _next/static and assets (handled by BYPASS_PREFIXES,
// but the matcher narrows the runtime cost on static assets).
export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|icon.svg|robots.txt|monitoring).*)'],
}
