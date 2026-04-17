import Link from 'next/link'
import { createServerClient } from '@/lib/supabase/server'

// ADR-0032 Sprint 2.1 — customer-side Support inbox.
//
// Lists all tickets belonging to the caller's org via the new
// public.list_org_support_tickets() RPC. Customers cannot see other
// orgs' tickets (enforced inside the RPC).

export const dynamic = 'force-dynamic'

interface Ticket {
  id: string
  subject: string
  status: string
  priority: string
  category: string | null
  reporter_email: string
  reporter_name: string | null
  created_at: string
  resolved_at: string | null
  message_count: number
}

const OPEN_STATUSES = ['open', 'awaiting_customer', 'awaiting_operator']

export default async function CustomerSupportPage() {
  const supabase = await createServerClient()

  const { data, error } = await supabase.rpc('list_org_support_tickets')

  if (error) {
    return (
      <div className="mx-auto max-w-5xl p-6">
        <h1 className="text-2xl font-semibold">Support</h1>
        <p className="mt-4 rounded border border-red-200 bg-red-50 p-4 text-sm text-red-800">
          {error.message}
        </p>
      </div>
    )
  }

  const tickets = (data ?? []) as Ticket[]
  const openCount = tickets.filter((t) => OPEN_STATUSES.includes(t.status)).length

  return (
    <div className="mx-auto max-w-5xl p-6">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Support</h1>
          <p className="mt-1 text-sm text-gray-600">
            Open tickets with the ConsentShield operator team. Responses are
            sent via the support console.
          </p>
        </div>
        <Link
          href="/dashboard/support/new"
          className="rounded bg-black px-4 py-2 text-sm font-medium text-white hover:bg-gray-800"
        >
          + New ticket
        </Link>
      </header>

      <section className="mt-6">
        {tickets.length === 0 ? (
          <div className="rounded border border-gray-200 bg-white p-8 text-center">
            <p className="text-sm text-gray-700">No support tickets yet.</p>
            <p className="mt-1 text-xs text-gray-500">
              Have a question or hit an issue?{' '}
              <Link href="/dashboard/support/new" className="underline">
                Create a ticket
              </Link>
              .
            </p>
          </div>
        ) : (
          <>
            <p className="mb-2 text-xs text-gray-600">
              {tickets.length} ticket{tickets.length === 1 ? '' : 's'}
              {openCount > 0 ? ` · ${openCount} open` : ''}
            </p>
            <div className="overflow-hidden rounded border border-gray-200 bg-white">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 text-left text-xs uppercase tracking-wider text-gray-500">
                  <tr>
                    <th className="px-4 py-2">Subject</th>
                    <th className="px-4 py-2">Priority</th>
                    <th className="px-4 py-2">Status</th>
                    <th className="px-4 py-2">Messages</th>
                    <th className="px-4 py-2">Opened</th>
                  </tr>
                </thead>
                <tbody>
                  {tickets.map((t) => (
                    <tr key={t.id} className="border-t border-gray-200 hover:bg-gray-50">
                      <td className="px-4 py-2">
                        <Link
                          href={`/dashboard/support/${t.id}`}
                          className="text-black hover:underline"
                        >
                          {t.subject}
                        </Link>
                      </td>
                      <td className="px-4 py-2">
                        <PriorityPill priority={t.priority} />
                      </td>
                      <td className="px-4 py-2">
                        <StatusPill status={t.status} />
                      </td>
                      <td className="px-4 py-2 text-xs text-gray-600">
                        {t.message_count}
                      </td>
                      <td className="px-4 py-2 text-xs text-gray-600">
                        {new Date(t.created_at).toLocaleDateString()}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </section>
    </div>
  )
}

function PriorityPill({ priority }: { priority: string }) {
  const classes =
    priority === 'urgent'
      ? 'rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700'
      : priority === 'high'
        ? 'rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800'
        : priority === 'normal'
          ? 'rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-700'
          : 'rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-500'
  return <span className={classes}>{priority}</span>
}

function StatusPill({ status }: { status: string }) {
  const classes =
    status === 'open' || status === 'awaiting_operator'
      ? 'rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800'
      : status === 'awaiting_customer'
        ? 'rounded-full bg-blue-100 px-2 py-0.5 text-xs font-medium text-blue-800'
        : status === 'resolved'
          ? 'rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700'
          : 'rounded-full bg-gray-200 px-2 py-0.5 text-xs font-medium text-gray-700'
  return <span className={classes}>{status.replace(/_/g, ' ')}</span>
}
