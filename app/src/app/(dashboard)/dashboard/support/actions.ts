'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { createServerClient } from '@/lib/supabase/server'

// ADR-0032 Sprint 2.1 — customer-side Support Server Actions.
//
// Wraps admin.create_support_ticket (customer-callable — ADR-0027
// Sprint 3.1 §19) and public.add_customer_support_message (new in
// migration 20260421000001). Both are SECURITY DEFINER so they work
// without admin JWT claims.

type ActionResult<T = undefined> =
  | { ok: true; data?: T }
  | { ok: false; error: string }

const ALLOWED_PRIORITIES = ['low', 'normal', 'high'] as const

export async function createTicket(input: {
  subject: string
  body: string
  priority: string
  reporterEmail: string
  reporterName?: string
}): Promise<ActionResult<{ ticketId: string }>> {
  const subject = input.subject.trim()
  if (subject.length < 3) {
    return { ok: false, error: 'Subject must be at least 3 characters.' }
  }
  const body = input.body.trim()
  if (body.length === 0) {
    return { ok: false, error: 'Message required.' }
  }
  if (!(ALLOWED_PRIORITIES as readonly string[]).includes(input.priority)) {
    return { ok: false, error: 'Invalid priority (customers can pick low, normal, or high).' }
  }
  const reporterEmail = input.reporterEmail.trim()
  if (reporterEmail.length < 3 || !reporterEmail.includes('@')) {
    return { ok: false, error: 'Valid reporter email required.' }
  }

  const supabase = await createServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { ok: false, error: 'Not authenticated.' }

  const orgId = user.app_metadata?.org_id as string | undefined
  if (!orgId) {
    return { ok: false, error: 'No org on current session — sign out and back in.' }
  }

  const { data, error } = await supabase
    .schema('admin')
    .rpc('create_support_ticket', {
      p_org_id: orgId,
      p_subject: subject,
      p_reporter_email: reporterEmail,
      p_reporter_name: input.reporterName?.trim() || null,
      p_priority: input.priority,
      p_category: null,
      p_initial_message: body,
    })
  if (error) return { ok: false, error: error.message }

  revalidatePath('/dashboard/support')
  return { ok: true, data: { ticketId: data as string } }
}

export async function replyToTicket(
  ticketId: string,
  body: string,
): Promise<ActionResult<{ messageId: string }>> {
  if (!body || body.trim().length === 0) {
    return { ok: false, error: 'Message body required.' }
  }

  const supabase = await createServerClient()
  const { data, error } = await supabase.rpc('add_customer_support_message', {
    p_ticket_id: ticketId,
    p_body: body.trim(),
  })
  if (error) return { ok: false, error: error.message }

  revalidatePath(`/dashboard/support/${ticketId}`)
  revalidatePath('/dashboard/support')
  return { ok: true, data: { messageId: data as string } }
}

export async function goToNewTicketForm(): Promise<void> {
  redirect('/dashboard/support/new')
}
