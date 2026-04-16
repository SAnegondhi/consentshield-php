import { createServerClient } from '@/lib/supabase/server'

// Placeholder Operations Dashboard — ADR-0026 Sprint 3.1.
//
// Real panel ships in ADR-0028. The wireframe for this page lives in
// docs/admin/design/consentshield-admin-screens.html.

export default async function OperationsDashboardPage() {
  const supabase = await createServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  const displayName =
    (user?.user_metadata?.display_name as string | undefined) ??
    (user?.user_metadata?.full_name as string | undefined) ??
    user?.email ??
    'operator'

  return (
    <div className="max-w-3xl space-y-6">
      <header className="space-y-1">
        <p className="text-xs font-mono uppercase tracking-wider text-red-700">
          Admin / Operations Dashboard
        </p>
        <h1 className="text-2xl font-semibold">Hello, {displayName}.</h1>
      </header>

      <section className="rounded-lg border border-zinc-200 bg-white p-6 shadow-sm">
        <h2 className="text-sm font-semibold">Skeleton admin app</h2>
        <p className="mt-2 text-sm text-zinc-700">
          This admin app is a skeleton landed by ADR-0026 Sprint 3.1.
          Real operator panels (system metrics, cron status, active
          incidents, kill switches summary) ship in ADR-0028.
        </p>
        <p className="mt-3 text-sm text-zinc-700">
          See the wireframe spec at{' '}
          <code className="font-mono text-xs">
            docs/admin/design/consentshield-admin-screens.html
          </code>{' '}
          and the platform architecture at{' '}
          <code className="font-mono text-xs">
            docs/admin/architecture/consentshield-admin-platform.md
          </code>
          .
        </p>
      </section>

      <section className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
        <p className="font-semibold">Admin rules in force</p>
        <ul className="mt-2 list-inside list-disc space-y-1">
          <li>Rule 21 — hardware-key 2FA required (AAL2 gate in proxy.ts)</li>
          <li>Rule 22 — every admin action audit-logged in same transaction (ADR-0027)</li>
          <li>Rule 23 — impersonation time-boxed + reason-required + customer-notified</li>
          <li>Rule 24 — admin endpoints unreachable from customer subdomain (host check)</li>
          <li>Rule 25 — admin app deploys independently from customer app</li>
        </ul>
      </section>
    </div>
  )
}
