import { createBrowserClient as createSSRBrowserClient } from '@supabase/ssr'

// Admin Supabase browser client. Functionally identical to the customer
// app's browser client; the is_admin + AAL2 check is enforced at the
// proxy.ts layer on every navigation and at the API handler layer for
// every admin RPC. This client is not a security boundary on its own.
export function createBrowserClient() {
  return createSSRBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  )
}
