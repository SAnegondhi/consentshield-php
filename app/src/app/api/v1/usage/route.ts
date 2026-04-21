import { NextRequest } from 'next/server'
import { problemJson } from '@/lib/api/auth'
import { readContext, respondV1 } from '@/lib/api/v1-helpers'
import { keyUsageSelf } from '@/lib/api/introspection'

// ADR-1012 Sprint 1.1 — GET /v1/usage
//
// Per-day request_count + p50/p95 latency for the Bearer token over the
// last ?days=N (default 7, clamped 1..30). No scope gate.
//
// Query:
//   ?days=N  (optional, 1..30)
//
// 200 — UsageEnvelope
// 401/410 — middleware
// 422 — bad days param
// 500 — unexpected DB error

const ROUTE = '/api/v1/usage'

export async function GET(request: NextRequest) {
  const { context, t0 } = await readContext()

  const url = new URL(request.url)
  const daysRaw = url.searchParams.get('days')
  let days: number | undefined
  if (daysRaw !== null) {
    const n = parseInt(daysRaw, 10)
    if (isNaN(n) || n < 1 || n > 30) {
      return respondV1(context, ROUTE, 'GET', 422,
        problemJson(422, 'Unprocessable Entity', 'days must be an integer between 1 and 30'),
        t0, true)
    }
    days = n
  }

  const result = await keyUsageSelf({ keyId: context.key_id, days })
  if (!result.ok) {
    return respondV1(context, ROUTE, 'GET', 500,
      problemJson(500, 'Internal Server Error', 'Usage lookup failed'), t0, true)
  }

  return respondV1(context, ROUTE, 'GET', 200, result.data, t0)
}
