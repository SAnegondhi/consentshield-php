import { NextResponse } from 'next/server'

// ADR-1018 Sprint 1.4 — unauthenticated liveness endpoint for status probes.
// No DB round-trip, no cookies, no state. Represents reachability of the
// Next.js runtime on Vercel. `/api/health` is outside proxy.ts matcher so
// the Bearer gate does not fire. Not `/api/_health` — Next.js treats
// underscore-prefixed folders as private and excludes them from routing.
export async function GET() {
  return NextResponse.json(
    { ok: true, surface: 'customer_app', at: new Date().toISOString() },
    {
      status: 200,
      headers: {
        'Cache-Control': 'no-store',
      },
    },
  )
}

export async function HEAD() {
  return new NextResponse(null, {
    status: 200,
    headers: { 'Cache-Control': 'no-store' },
  })
}
