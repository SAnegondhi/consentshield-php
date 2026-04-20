// ADR-1001 Sprint 2.4 — fire-and-forget API request logging.
// Uses the service-role client (same carve-out as verifyBearerToken in auth.ts).
// Non-sensitive data only: key_id, path, method, status, latency.

import { createClient } from '@supabase/supabase-js'
import type { ApiKeyContext } from './auth'

function makeServiceClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  )
}

export function logApiRequest(
  context: ApiKeyContext,
  route: string,
  method: string,
  status: number,
  latencyMs: number,
): void {
  // Fire-and-forget — never await; never block the response.
  void makeServiceClient()
    .rpc('rpc_api_request_log_insert', {
      p_key_id:     context.key_id,
      p_org_id:     context.org_id,
      p_account_id: context.account_id,
      p_route:      route,
      p_method:     method,
      p_status:     status,
      p_latency:    latencyMs,
    })
}
