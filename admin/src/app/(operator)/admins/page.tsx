import { createServerClient } from '@/lib/supabase/server'
import { isServiceClientReady } from '@/lib/supabase/service'
import { canOperate, type AdminRole } from '@/lib/admin/role-tiers'
import { AdminListPanel, type AdminRow } from './admin-list'

// ADR-0045 Sprint 2.1 — Admin Users panel.

export const dynamic = 'force-dynamic'

export default async function AdminsPage() {
  const supabase = await createServerClient()

  const [list, user] = await Promise.all([
    supabase.schema('admin').rpc('admin_list'),
    supabase.auth.getUser(),
  ])

  const error = list.error?.message ?? null
  const rows = (list.data ?? []) as AdminRow[]

  const adminRole =
    (user.data.user?.app_metadata?.admin_role as AdminRole) ?? 'read_only'
  const canWrite = canOperate(adminRole)

  const currentAdminId = user.data.user?.id ?? null
  const serviceReady = isServiceClientReady()

  return (
    <div className="mx-auto max-w-6xl space-y-4">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">Admin Users</h1>
          <p className="text-sm text-text-2">
            Invite new operators, change roles, and disable access. All writes
            require platform_operator and land an audit row.
          </p>
        </div>
        <span className="rounded-full border border-[color:var(--border)] bg-bg px-3 py-1 text-[11px] text-text-3">
          ADR-0045 · lifecycle
        </span>
      </header>

      {error ? (
        <div className="rounded border border-red-200 bg-red-50 p-3 text-xs text-red-800">
          {error}
        </div>
      ) : null}

      {!serviceReady ? (
        <div className="rounded border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
          <strong>Service-role key not set.</strong> Invite + role-change +
          disable will fail until <code>SUPABASE_SERVICE_ROLE_KEY</code> (or{' '}
          <code>SUPABASE_SECRET_KEY</code>) is configured on the admin Vercel
          project. Reads still work.
        </div>
      ) : null}

      <AdminListPanel
        rows={rows}
        canWrite={canWrite}
        currentAdminId={currentAdminId}
      />
    </div>
  )
}
