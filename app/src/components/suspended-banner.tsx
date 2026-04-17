import { createServerClient } from '@/lib/supabase/server'

// ADR-0029 Sprint 4.1 — customer-side suspension banner.
//
// Server Component. Reads the current user's org status via the
// members/organisations join. Renders nothing when the org is 'active';
// a red banner when 'suspended' telling the customer to contact support.
// Cloudflare Worker separately serves a no-op banner script for
// suspended orgs — the two surfaces reinforce each other.

export async function SuspendedOrgBanner() {
  const supabase = await createServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return null

  // current_org_id() is populated from the JWT's org_id claim. Directly
  // select the matching organisation row; RLS restricts to own-org.
  const { data: orgs } = await supabase
    .from('organisations')
    .select('id, name, status')
    .limit(1)

  const org = orgs?.[0] as
    | { id: string; name: string; status: string }
    | undefined
  if (!org || org.status !== 'suspended') return null

  return (
    <div className="border-b border-red-700 bg-red-700 px-6 py-3 text-white">
      <div className="flex items-center justify-between gap-4">
        <div>
          <p className="text-sm font-semibold">
            Your organisation is suspended.
          </p>
          <p className="mt-1 text-xs text-red-100">
            Banner delivery is paused on your websites. Your compliance
            data is preserved. Contact support to resolve and restore
            service.
          </p>
        </div>
        <a
          href="mailto:support@consentshield.in?subject=Account%20suspended%20-%20please%20restore"
          className="rounded border border-white bg-white/10 px-3 py-1.5 text-xs font-medium text-white hover:bg-white/20"
        >
          Contact support
        </a>
      </div>
    </div>
  )
}
