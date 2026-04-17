import Link from 'next/link'
import { createServerClient } from '@/lib/supabase/server'
import { NewTicketForm } from '@/components/support/new-ticket-form'

// ADR-0032 Sprint 2.1 — Contact Support form (customer side).

export const dynamic = 'force-dynamic'

export default async function NewSupportTicketPage() {
  const supabase = await createServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  return (
    <div className="mx-auto max-w-2xl p-6">
      <header className="mb-4">
        <p className="text-xs text-gray-500">
          <Link href="/dashboard/support" className="hover:underline">
            ← Support
          </Link>
        </p>
        <h1 className="mt-1 text-2xl font-semibold">New support ticket</h1>
        <p className="mt-1 text-sm text-gray-600">
          Your ticket lands in the ConsentShield operator console. Replies
          appear in this support thread.
        </p>
      </header>

      <NewTicketForm
        defaultEmail={user?.email ?? ''}
        defaultName={
          (user?.user_metadata?.display_name as string | undefined) ?? ''
        }
      />
    </div>
  )
}
