import { createServerClient as createSSRClient } from '@supabase/ssr'
import { cookies } from 'next/headers'

// Admin Supabase server client. Uses the same auth.users pool as the
// customer app but is only consumed by admin code paths. Every admin
// call path must additionally verify is_admin + AAL2 at a higher layer
// (proxy.ts or API route handler) before taking any action. The cs_admin
// connection (for admin.* tables) is layered on top via security-definer
// RPCs; this client carries the end user's JWT like the customer client.
export async function createServerClient() {
  const cookieStore = await cookies()

  return createSSRClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll()
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options),
            )
          } catch {
            // setAll called from Server Component — safe to ignore
          }
        },
      },
    },
  )
}
