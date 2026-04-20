import { createServerClient } from '@/lib/supabase/server'

// ADR-0029 Sprint 4.1 + 2026-04-20 follow-up — customer-side suspension banner.
//
// Server Component. Reads the current user's org status + parent account
// status via the RLS-visible organisations row + a best-effort account
// lookup. Renders nothing when both are 'active'; a red banner when
// either is suspended telling the customer:
//   · what is paused (banner delivery, new compliance workflow entries)
//   · what still works (data viewing, team management, billing updates
//     so they can pay their way out)
//
// Cloudflare Worker separately serves a no-op banner script for suspended
// orgs — the two surfaces reinforce each other.

export async function SuspendedOrgBanner() {
  const supabase = await createServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return null

  const { data: orgs } = await supabase
    .from('organisations')
    .select('id, name, status, account_id')
    .limit(1)

  const org = orgs?.[0] as
    | { id: string; name: string; status: string; account_id: string | null }
    | undefined
  if (!org) return null

  // Also peek at the parent account's status — account suspension is the
  // more common driver (from admin/past_due/etc.) and cascades to orgs.
  let accountStatus: string | null = null
  if (org.account_id) {
    const { data: account } = await supabase
      .from('accounts')
      .select('status')
      .eq('id', org.account_id)
      .maybeSingle()
    accountStatus = (account?.status as string | null) ?? null
  }

  const isSuspended = org.status === 'suspended' || accountStatus === 'suspended'
  if (!isSuspended) return null

  const driver = accountStatus === 'suspended' ? 'account' : 'organisation'

  return (
    <div className="border-b border-red-700 bg-red-700 px-6 py-3 text-white">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-sm font-semibold">
            Your {driver} is suspended.
          </p>
          <p className="mt-1 text-xs text-red-100">
            <strong>Paused:</strong> banner delivery on your websites · new DPIA / auditor
            engagement entries. <strong>Still works:</strong> viewing existing data · billing
            updates (so you can resolve the suspension) · team management. Your compliance data
            is preserved — contact support to restore service.
          </p>
        </div>
        <a
          href="mailto:support@consentshield.in?subject=Account%20suspended%20-%20please%20restore"
          className="flex-shrink-0 rounded border border-white bg-white/10 px-3 py-1.5 text-xs font-medium text-white hover:bg-white/20"
        >
          Contact support
        </a>
      </div>
    </div>
  )
}
