import Link from 'next/link'
import { notFound } from 'next/navigation'
import { createServerClient } from '@/lib/supabase/server'
import { canOperate, type AdminRole } from '@/lib/admin/role-tiers'
import { AccountActionBar } from './action-bar'
import { AccountNotesCard, type AccountNote } from './account-notes-card'
import {
  DefaultTemplateCard,
  type TemplateOption,
} from './default-template-card'

// ADR-0048 Sprint 1.2 — Account detail.

export const dynamic = 'force-dynamic'

interface AccountEnvelope {
  account: {
    id: string
    name: string
    plan_code: string
    status: string
    razorpay_customer_id: string | null
    razorpay_subscription_id: string | null
    trial_ends_at: string | null
    current_period_ends_at: string | null
    created_at: string
    updated_at: string
    effective_plan: string
    default_sectoral_template_id: string | null
  }
  organisations: Array<{
    id: string
    name: string
    status: string
    created_at: string
  }>
  active_adjustments: Array<{
    id: string
    kind: 'comp' | 'override'
    plan: string
    starts_at: string
    expires_at: string | null
    reason: string
    granted_by: string
    created_at: string
  }>
  audit_recent: Array<{
    action: string
    admin_user_id: string
    reason: string
    created_at: string
    new_value: Record<string, unknown> | null
  }>
  default_template: {
    id: string
    template_code: string
    display_name: string
    version: number
    status: string
  } | null
}

interface PageProps {
  params: Promise<{ accountId: string }>
}

export default async function AccountDetailPage({ params }: PageProps) {
  const { accountId } = await params
  const supabase = await createServerClient()

  const [detailRes, userRes, notesRes, adminsRes, templatesRes] = await Promise.all([
    supabase.schema('admin').rpc('account_detail', { p_account_id: accountId }),
    supabase.auth.getUser(),
    supabase
      .schema('admin')
      .rpc('account_note_list', { p_account_id: accountId }),
    supabase.schema('admin').from('admin_users').select('id, display_name'),
    supabase
      .schema('admin')
      .from('sectoral_templates')
      .select('id, template_code, display_name, sector, version')
      .eq('status', 'published')
      .order('sector')
      .order('display_name'),
  ])

  if (detailRes.error) {
    if (detailRes.error.message?.toLowerCase().includes('not found')) notFound()
    return (
      <div className="mx-auto max-w-6xl p-6">
        <p className="rounded border border-red-200 bg-red-50 p-3 text-xs text-red-800">
          {detailRes.error.message}
        </p>
      </div>
    )
  }

  const envelope = detailRes.data as AccountEnvelope
  const adminRole =
    (userRes.data.user?.app_metadata?.admin_role as AdminRole) ?? 'read_only'
  const canWrite = canOperate(adminRole)
  const canPlatformOperator =
    adminRole === 'platform_operator' || adminRole === 'platform_owner'

  const notes = (notesRes.data ?? []) as AccountNote[]
  const adminNameById: Record<string, string | null> = {}
  for (const a of (adminsRes.data ?? []) as Array<{
    id: string
    display_name: string | null
  }>) {
    adminNameById[a.id] = a.display_name ?? null
  }

  const publishedTemplates = (templatesRes.data ?? []) as TemplateOption[]

  const {
    account,
    organisations,
    active_adjustments,
    audit_recent,
    default_template,
  } = envelope

  return (
    <div className="mx-auto max-w-6xl space-y-4">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">{account.name}</h1>
          <p className="font-mono text-[11px] text-text-3">{account.id}</p>
        </div>
        <AccountActionBar
          accountId={account.id}
          accountName={account.name}
          status={account.status}
          canWrite={canWrite}
        />
      </header>

      <section className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card title="Plan">
          <KV label="Plan code">{account.plan_code}</KV>
          <KV label="Effective plan">
            <span
              className={
                account.effective_plan !== account.plan_code
                  ? 'font-medium text-amber-800'
                  : undefined
              }
            >
              {account.effective_plan}
            </span>
          </KV>
          <KV label="Trial ends">
            {account.trial_ends_at
              ? new Date(account.trial_ends_at).toLocaleDateString()
              : '—'}
          </KV>
          <KV label="Period ends">
            {account.current_period_ends_at
              ? new Date(account.current_period_ends_at).toLocaleDateString()
              : '—'}
          </KV>
        </Card>

        <Card title="Billing identity">
          <KV label="Status">
            <StatusPill status={account.status} />
          </KV>
          <KV label="Razorpay customer">
            {account.razorpay_customer_id ? (
              <code className="font-mono text-xs">
                {account.razorpay_customer_id}
              </code>
            ) : (
              '—'
            )}
          </KV>
          <KV label="Razorpay subscription">
            {account.razorpay_subscription_id ? (
              <code className="font-mono text-xs">
                {account.razorpay_subscription_id}
              </code>
            ) : (
              '—'
            )}
          </KV>
        </Card>

        <Card title="Lifecycle">
          <KV label="Created">
            {new Date(account.created_at).toLocaleString()}
          </KV>
          <KV label="Updated">
            {account.updated_at
              ? new Date(account.updated_at).toLocaleString()
              : '—'}
          </KV>
        </Card>
      </section>

      <Card
        title="Organisations"
        pill={`${organisations.length} total`}
      >
        {organisations.length === 0 ? (
          <p className="p-6 text-sm text-text-3">No organisations.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-bg text-left text-xs uppercase tracking-wider text-text-3">
                <tr>
                  <th className="px-4 py-2">Name</th>
                  <th className="px-4 py-2">Status</th>
                  <th className="px-4 py-2">Created</th>
                </tr>
              </thead>
              <tbody>
                {organisations.map((o) => (
                  <tr
                    key={o.id}
                    className="border-t border-[color:var(--border)]"
                  >
                    <td className="px-4 py-2">
                      <Link
                        href={`/orgs/${o.id}`}
                        className="text-sm text-teal hover:underline"
                      >
                        {o.name}
                      </Link>
                    </td>
                    <td className="px-4 py-2">
                      <StatusPill status={o.status} />
                    </td>
                    <td className="px-4 py-2 font-mono text-[11px] text-text-3">
                      {new Date(o.created_at).toLocaleDateString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card
        title="Active plan adjustments"
        pill={`${active_adjustments.length}`}
      >
        {active_adjustments.length === 0 ? (
          <p className="p-6 text-sm text-text-3">
            No active comp or override. Operators can grant one from the
            Billing panel.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-bg text-left text-xs uppercase tracking-wider text-text-3">
                <tr>
                  <th className="px-4 py-2">Kind</th>
                  <th className="px-4 py-2">Plan</th>
                  <th className="px-4 py-2">Expires</th>
                  <th className="px-4 py-2">Reason</th>
                </tr>
              </thead>
              <tbody>
                {active_adjustments.map((a) => (
                  <tr
                    key={a.id}
                    className="border-t border-[color:var(--border)]"
                  >
                    <td className="px-4 py-2 text-xs">{a.kind}</td>
                    <td className="px-4 py-2 text-xs font-mono">{a.plan}</td>
                    <td className="px-4 py-2 font-mono text-[11px]">
                      {a.expires_at
                        ? new Date(a.expires_at).toLocaleDateString()
                        : 'no expiry'}
                    </td>
                    <td className="px-4 py-2 text-[11px] text-text-2">
                      {a.reason}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* ADR-1027 Sprint 3.3 — default sectoral template picker.
          New orgs in this account pre-select this template at wizard
          Step 4. Customer can still override. */}
      <DefaultTemplateCard
        accountId={account.id}
        currentTemplate={default_template}
        publishedTemplates={publishedTemplates}
        canPlatformOperator={canPlatformOperator}
      />

      {/* ADR-1027 Sprint 3.2 — account-level notes. Every write emits an
          audit row with target_table='admin.account_notes' and the
          Sprint 1.1 account_id column populated. */}
      <AccountNotesCard
        accountId={account.id}
        notes={notes}
        adminNameById={adminNameById}
        canPlatformOperator={canPlatformOperator}
      />

      <Card title="Recent admin actions" pill={`${audit_recent.length}`}>
        {audit_recent.length === 0 ? (
          <p className="p-6 text-sm text-text-3">No audit entries yet.</p>
        ) : (
          <ul className="divide-y divide-[color:var(--border)]">
            {audit_recent.slice(0, 20).map((a, i) => (
              <li key={i} className="flex items-start gap-4 px-4 py-2 text-xs">
                <span className="font-mono text-[11px] text-text-3">
                  {new Date(a.created_at).toLocaleString()}
                </span>
                <span className="font-medium">{a.action}</span>
                <span className="flex-1 text-text-2">{a.reason}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  )
}

function Card({
  title,
  pill,
  children,
}: {
  title: string
  pill?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <section className="rounded-md border border-[color:var(--border)] bg-white shadow-sm">
      <header className="flex items-center justify-between border-b border-[color:var(--border)] px-4 py-2.5">
        <h2 className="text-sm font-semibold">{title}</h2>
        {pill ? (
          <span className="rounded-full bg-bg px-2 py-0.5 text-[11px] text-text-3">
            {pill}
          </span>
        ) : null}
      </header>
      <div className="px-4 py-3 space-y-1.5">{children}</div>
    </section>
  )
}

function KV({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between text-sm">
      <span className="text-xs text-text-3">{label}</span>
      <span className="text-xs text-text-1">{children}</span>
    </div>
  )
}

function StatusPill({ status }: { status: string }) {
  const tone =
    status === 'active'
      ? 'bg-green-100 text-green-700'
      : status === 'trial'
        ? 'bg-amber-100 text-amber-800'
        : status === 'suspended' || status === 'suspended_by_plan'
          ? 'bg-red-100 text-red-700'
          : 'bg-bg text-text-3'
  return (
    <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${tone}`}>
      {status}
    </span>
  )
}
