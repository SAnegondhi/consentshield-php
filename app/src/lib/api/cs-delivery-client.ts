// ADR-1019 Sprint 1.1 — cs_delivery direct-Postgres client.
//
// Mirrors app/src/lib/api/cs-orchestrator-client.ts exactly; the only
// differences are the connection string (cs_delivery role) and the callers
// that use it. Introduced by the ADR-1019 Sprint 1.1 amendment: the delivery
// orchestrator runs as a Next.js API route (not a Supabase Edge Function), so
// cs_delivery graduates from an Edge-Function pool role to a third Next.js
// LOGIN role alongside cs_api and cs_orchestrator. Rule 5 least-privilege
// separation is preserved — cs_delivery retains its narrow grants (SELECT +
// UPDATE(delivered_at) + DELETE on buffer tables, SELECT on
// export_configurations, EXECUTE on decrypt_secret).
//
// Called by:
//   * /api/internal/deliver-consent-events — POST route (bearer-authed)
//   * app/src/lib/delivery/deliver-events.ts — orchestrator
//
// Fluid Compute note: module-scope `sql` singleton is reused across
// concurrent requests on the same function instance; postgres.js manages its
// own pool internally.

import postgres from 'postgres'

const connectionString = process.env.SUPABASE_CS_DELIVERY_DATABASE_URL

let _sql: ReturnType<typeof postgres> | null = null

export function csDelivery() {
  if (!connectionString) {
    throw new Error(
      'SUPABASE_CS_DELIVERY_DATABASE_URL is not set. ADR-1019 Sprint 1.1 ' +
        'requires a cs_delivery connection string (Supavisor pooler, ' +
        'transaction mode). Mirror SUPABASE_CS_ORCHESTRATOR_DATABASE_URL — ' +
        'only the user + password differ (cs_delivery.<ref> / rotated ' +
        'password from ADR-1019 Sprint 1.1 operator runbook).',
    )
  }
  if (_sql === null) {
    _sql = postgres(connectionString, {
      prepare: false,
      max: 5,
      idle_timeout: 20,
      connect_timeout: 10,
      ssl: 'require',
      debug: false,
      transform: { undefined: null },
    })
  }
  return _sql
}
