import Link from 'next/link'
import { redirect } from 'next/navigation'
import { createServerClient } from '@/lib/supabase/server'
import { BillingProfileForm } from './profile-form'

export const dynamic = 'force-dynamic'

interface InvoiceRow {
  id: string
  invoice_number: string
  issue_date: string
  total_paise: number
  status: string
  pdf_r2_key: string | null
  issuer_legal_name: string
}

interface BillingProfile {
  account_id: string
  name: string
  plan_code: string | null
  status: string | null
  billing_legal_name: string | null
  billing_gstin: string | null
  billing_state_code: string | null
  billing_address: string | null
  billing_email: string | null
  billing_profile_updated_at: string | null
  role: string
}

function statusPill(status: string): string {
  const map: Record<string, string> = {
    paid: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    issued: 'bg-amber-50 text-amber-700 border-amber-200',
    partially_paid: 'bg-amber-50 text-amber-700 border-amber-200',
    overdue: 'bg-red-50 text-red-700 border-red-200',
    void: 'bg-gray-100 text-gray-500 border-gray-200',
    refunded: 'bg-gray-100 text-gray-500 border-gray-200',
    draft: 'bg-gray-100 text-gray-500 border-gray-200',
  }
  return map[status] ?? 'bg-gray-100 text-gray-500 border-gray-200'
}

function formatInr(paise: number): string {
  return `₹${(paise / 100).toFixed(2)}`
}

export default async function BillingSettingsPage() {
  const supabase = await createServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const [profileRes, invoicesRes] = await Promise.all([
    supabase.rpc('get_account_billing_profile'),
    supabase.rpc('list_account_invoices'),
  ])

  // Role-gated: account_owner / account_viewer only
  if (profileRes.error) {
    const msg = profileRes.error.message ?? ''
    if (msg.includes('access_denied') || msg.includes('no_account_context')) {
      return (
        <main className="p-8 max-w-3xl">
          <h1 className="text-2xl font-bold">Billing</h1>
          <div className="mt-4 rounded-lg border border-gray-200 bg-gray-50 px-5 py-6">
            <div className="mb-1 text-sm font-medium text-gray-700">Not available for your role</div>
            <p className="text-sm text-gray-500">
              Billing is an account-level concern. Only account owners and account viewers can see this page.
              If you need access, ask your account owner.
            </p>
          </div>
        </main>
      )
    }
    return (
      <main className="p-8 max-w-3xl">
        <h1 className="text-2xl font-bold">Billing</h1>
        <p className="mt-4 text-sm text-red-600">Failed to load billing profile: {msg}</p>
      </main>
    )
  }

  const profile = profileRes.data as BillingProfile
  const invoices = (invoicesRes.data ?? []) as InvoiceRow[]

  return (
    <main className="p-8 max-w-5xl">
      <header className="mb-6">
        <h1 className="text-2xl font-bold">Billing</h1>
        <p className="mt-1 text-sm text-gray-500">
          Plan, billing profile, and invoice history for <strong>{profile.name}</strong>
        </p>
      </header>

      {/* Current plan card */}
      <section className="mb-6 rounded-lg border border-gray-200 bg-white p-5">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-base font-semibold capitalize">
              {profile.plan_code?.replace(/_/g, ' ') ?? 'No plan'}
            </div>
            <div className="mt-0.5 text-sm text-gray-500">
              Status: <span className="capitalize">{profile.status ?? 'unknown'}</span>
            </div>
          </div>
          <Link
            href="/dashboard/billing"
            className="rounded border border-gray-200 bg-white px-3 py-1.5 text-sm hover:bg-gray-50"
          >
            Change plan
          </Link>
        </div>
      </section>

      {/* Billing profile — editable for account_owner */}
      <BillingProfileForm profile={profile} />

      {/* Invoice history */}
      <section className="rounded-lg border border-gray-200 bg-white p-5">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-gray-700">Invoice history</h2>
          <span className="text-xs text-gray-400">
            {invoices.length === 0 ? 'No invoices yet' : `${invoices.length} invoice${invoices.length === 1 ? '' : 's'}`}
          </span>
        </div>

        {invoices.length === 0 ? (
          <div className="rounded border border-dashed border-gray-300 p-8 text-center">
            <p className="text-sm text-gray-500">
              Your first invoice will appear here after your first billing cycle.
            </p>
          </div>
        ) : (
          <div className="overflow-hidden rounded border border-gray-200">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-left">
                <tr>
                  <th className="px-4 py-2 font-medium text-gray-600">Invoice #</th>
                  <th className="px-4 py-2 font-medium text-gray-600">Issued</th>
                  <th className="px-4 py-2 font-medium text-gray-600">Amount (incl. GST)</th>
                  <th className="px-4 py-2 font-medium text-gray-600">Status</th>
                  <th className="px-4 py-2 text-right font-medium text-gray-600">PDF</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {invoices.map((inv) => (
                  <tr key={inv.id} className="hover:bg-gray-50">
                    <td className="px-4 py-2 font-mono text-xs">{inv.invoice_number}</td>
                    <td className="px-4 py-2 text-xs text-gray-600">
                      {new Date(inv.issue_date).toLocaleDateString('en-IN')}
                    </td>
                    <td className="px-4 py-2">{formatInr(inv.total_paise)}</td>
                    <td className="px-4 py-2">
                      <span
                        className={`inline-flex rounded-full border px-2 py-0.5 text-xs font-medium capitalize ${statusPill(inv.status)}`}
                      >
                        {inv.status.replace(/_/g, ' ')}
                      </span>
                    </td>
                    <td className="px-4 py-2 text-right">
                      {inv.status === 'void' || !inv.pdf_r2_key ? (
                        <span className="text-xs text-gray-400">—</span>
                      ) : (
                        <a
                          href={`/api/billing/invoices/${inv.id}/pdf`}
                          className="text-xs text-emerald-700 hover:underline"
                        >
                          Download ↓
                        </a>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <p className="mt-3 text-xs text-gray-400">
          Invoices are issued by the active ConsentShield issuer entity. GST is computed at issuance
          based on your registered state vs the issuer&apos;s state. PDFs are tamper-evident (SHA-256 recorded).
        </p>
      </section>
    </main>
  )
}
