import Link from 'next/link'
import { notFound } from 'next/navigation'
import { createServerClient } from '@/lib/supabase/server'
import { CustomerReplyForm } from '@/components/support/customer-reply-form'

// ADR-0032 Sprint 2.1 — Customer-facing ticket detail + thread + reply.

export const dynamic = 'force-dynamic'

interface PageProps {
  params: Promise<{ ticketId: string }>
}

interface TicketRow {
  id: string
  subject: string
  status: string
  priority: string
  reporter_email: string
  reporter_name: string | null
  created_at: string
  resolved_at: string | null
  message_count: number
}

interface MessageRow {
  id: string
  ticket_id: string
  author_kind: 'admin' | 'customer' | 'system'
  author_id: string | null
  body: string
  created_at: string
}

export default async function CustomerTicketDetailPage({ params }: PageProps) {
  const { ticketId } = await params
  const supabase = await createServerClient()

  const [ticketsRes, messagesRes] = await Promise.all([
    supabase.rpc('list_org_support_tickets'),
    supabase.rpc('list_support_ticket_messages', {
      p_ticket_id: ticketId,
    }),
  ])

  if (messagesRes.error) {
    return (
      <div className="mx-auto max-w-3xl p-6">
        <p className="text-xs text-gray-500">
          <Link href="/dashboard/support" className="hover:underline">
            ← Support
          </Link>
        </p>
        <p className="mt-4 rounded border border-red-200 bg-red-50 p-4 text-sm text-red-800">
          {messagesRes.error.message}
        </p>
      </div>
    )
  }

  const tickets = (ticketsRes.data ?? []) as TicketRow[]
  const ticket = tickets.find((t) => t.id === ticketId)
  if (!ticket) notFound()

  const messages = (messagesRes.data ?? []) as MessageRow[]

  return (
    <div className="mx-auto max-w-3xl p-6">
      <header className="mb-4">
        <p className="text-xs text-gray-500">
          <Link href="/dashboard/support" className="hover:underline">
            ← Support
          </Link>
        </p>
        <h1 className="mt-1 text-2xl font-semibold">{ticket.subject}</h1>
        <p className="mt-1 text-xs text-gray-600">
          <span className="font-mono">{ticket.id.slice(0, 8)}</span> ·{' '}
          Opened {new Date(ticket.created_at).toLocaleString()} ·{' '}
          Reporter: {ticket.reporter_email}
        </p>
        <div className="mt-2 flex items-center gap-2">
          <StatusPill status={ticket.status} />
          <PriorityPill priority={ticket.priority} />
        </div>
      </header>

      <section className="rounded border border-gray-200 bg-white p-4">
        <h2 className="mb-3 text-sm font-semibold">Thread</h2>
        {messages.length === 0 ? (
          <p className="text-sm text-gray-500">No messages yet.</p>
        ) : (
          <ol className="flex flex-col gap-3">
            {messages.map((m) => (
              <Message key={m.id} message={m} />
            ))}
          </ol>
        )}
      </section>

      <section className="mt-4">
        <CustomerReplyForm ticketId={ticket.id} />
      </section>
    </div>
  )
}

function Message({ message }: { message: MessageRow }) {
  const isAdmin = message.author_kind === 'admin'
  const isSystem = message.author_kind === 'system'
  const wrapperClasses = isAdmin
    ? 'mr-auto max-w-[90%] rounded-lg bg-teal-50 p-3'
    : isSystem
      ? 'mx-auto max-w-[90%] rounded-lg bg-gray-100 p-3 text-gray-700'
      : 'ml-auto max-w-[90%] rounded-lg bg-gray-50 p-3'

  const label = isAdmin
    ? 'ConsentShield Support'
    : isSystem
      ? 'System'
      : 'You'

  return (
    <li className={wrapperClasses}>
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold text-gray-700">{label}</span>
        <span className="text-xs text-gray-500">
          {new Date(message.created_at).toLocaleString()}
        </span>
      </div>
      <p className="mt-1 whitespace-pre-wrap text-sm text-gray-800">
        {message.body}
      </p>
    </li>
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
