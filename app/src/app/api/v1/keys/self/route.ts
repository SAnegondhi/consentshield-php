import { problemJson } from '@/lib/api/auth'
import { readContext, respondV1 } from '@/lib/api/v1-helpers'
import { keySelf } from '@/lib/api/introspection'

// ADR-1012 Sprint 1.1 — GET /v1/keys/self
//
// Returns the public metadata of the Bearer token: id, account_id, org_id,
// name, prefix, scopes, rate_tier, lifecycle timestamps. No scope gate —
// any valid Bearer can introspect itself (same pattern as /v1/_ping).
//
// 200 — KeySelfEnvelope
// 401 — missing/invalid Bearer (middleware)
// 410 — revoked (middleware)
// 500 — unexpected DB error

const ROUTE = '/api/v1/keys/self'

export async function GET() {
  const { context, t0 } = await readContext()

  const result = await keySelf({ keyId: context.key_id })
  if (!result.ok) {
    // api_key_not_found here is unexpected — middleware already verified the
    // Bearer against api_keys. If it happens, treat as a 500 rather than
    // leaking internal state.
    return respondV1(context, ROUTE, 'GET', 500,
      problemJson(500, 'Internal Server Error', 'Key introspection failed'), t0, true)
  }

  return respondV1(context, ROUTE, 'GET', 200, result.data, t0)
}
