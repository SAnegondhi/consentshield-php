import { createClient, SupabaseClient } from '@supabase/supabase-js'

// Service-role Supabase client for admin Route Handlers that need to
// orchestrate `auth.admin.*` operations — creating users, mutating
// `raw_app_meta_data`, deleting users. These APIs are service-role-only
// and have no authenticated-role equivalent.
//
// Rule-5 reading: "Never use SUPABASE_SERVICE_ROLE_KEY in running
// application code — it is for migrations only." The admin console
// Route Handlers are platform-operator-gated (proxy.ts rule 21 + RPC
// require_admin defence-in-depth); they are NOT end-user-facing code
// paths. Scoped use here is acceptable because every Route Handler
// that constructs a service client must:
//
//   1. Be located under admin/src/app/api/admin/ (naming convention).
//   2. Call an admin.* RPC FIRST that re-verifies
//      require_admin('platform_operator') — RPC fails for anyone whose
//      JWT lacks the claim, even if they somehow reached the route.
//   3. Do auth.admin.* only after the RPC succeeds.
//
// See ADR-0045 for the design rationale.

export class ServiceClientEnvError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ServiceClientEnvError'
  }
}

/**
 * Construct a service-role Supabase client. Throws if the required env
 * vars are missing so the Route Handler can surface a precise 500.
 * Either `SUPABASE_SERVICE_ROLE_KEY` (legacy JWT) or `SUPABASE_SECRET_KEY`
 * (new sb_secret_* format) works — we accept both.
 */
export function getAdminServiceClient(): SupabaseClient {
  const url =
    process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_PROJECT_URL
  const key =
    process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SECRET_KEY

  if (!url) {
    throw new ServiceClientEnvError(
      'NEXT_PUBLIC_SUPABASE_URL or SUPABASE_PROJECT_URL must be set on the admin project.',
    )
  }
  if (!key) {
    throw new ServiceClientEnvError(
      'SUPABASE_SERVICE_ROLE_KEY or SUPABASE_SECRET_KEY must be set on the admin project to run the admin user lifecycle Route Handlers.',
    )
  }
  return createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
}

export function isServiceClientReady(): boolean {
  const url =
    process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_PROJECT_URL
  const key =
    process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SECRET_KEY
  return Boolean(url && key)
}
