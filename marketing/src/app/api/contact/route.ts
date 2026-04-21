import { NextResponse } from 'next/server'
import {
  CONTACT_FROM,
  CONTACT_INBOX,
  RESEND_API_KEY,
  RESEND_ENABLED,
  TURNSTILE_SECRET_KEY,
} from '@/lib/env'

// POST /api/contact — contact-form submit.
//
// Flow:
//   1. Parse + shape-validate body.
//   2. Verify Turnstile token against Cloudflare siteverify.
//   3. Email the submission to CONTACT_INBOX via Resend (or log + accept
//      when RESEND_API_KEY is unset — local dev path).
//
// Failures return explicit, non-leaky messages. Violation details
// (siteverify error-codes, Resend error body) are logged server-side
// but not echoed to the client.

export const runtime = 'nodejs'

interface ContactBody {
  firstName?: unknown
  lastName?: unknown
  email?: unknown
  company?: unknown
  role?: unknown
  interest?: unknown
  notes?: unknown
  'cf-turnstile-response'?: unknown
}

interface CleanContactBody {
  firstName: string
  lastName: string
  email: string
  company: string
  role: string
  interest: string
  notes: string
  turnstileToken: string
}

export async function POST(req: Request) {
  let raw: unknown
  try {
    raw = await req.json()
  } catch {
    return NextResponse.json(
      { error: 'Invalid request body.' },
      { status: 400 },
    )
  }

  const body = raw as ContactBody
  const clean = shape(body)
  if ('error' in clean) {
    return NextResponse.json({ error: clean.error }, { status: 400 })
  }

  const verdict = await verifyTurnstile(
    clean.turnstileToken,
    req.headers.get('x-forwarded-for') ?? req.headers.get('x-real-ip'),
  )
  if (!verdict.ok) {
    return NextResponse.json(
      { error: 'Human-verification challenge failed. Please retry.' },
      { status: 403 },
    )
  }

  const sent = await deliver(clean)
  if (!sent.ok) {
    return NextResponse.json(
      { error: 'Submission could not be delivered. Please email us directly.' },
      { status: 502 },
    )
  }

  return NextResponse.json({ ok: true }, { status: 202 })
}

function shape(
  body: ContactBody,
): CleanContactBody | { error: string } {
  const s = (v: unknown): string | null =>
    typeof v === 'string' ? v.trim() : null

  const firstName = s(body.firstName)
  const lastName = s(body.lastName)
  const email = s(body.email)
  const company = s(body.company)
  const role = s(body.role)
  const interest = s(body.interest)
  const notes = s(body.notes)
  const turnstileToken = s(body['cf-turnstile-response'])

  if (!firstName || firstName.length < 1 || firstName.length > 80)
    return { error: 'First name is required (max 80 characters).' }
  if (!lastName || lastName.length < 1 || lastName.length > 80)
    return { error: 'Last name is required (max 80 characters).' }
  if (!email || !isPlausibleEmail(email) || email.length > 200)
    return { error: 'A valid work email is required.' }
  if (!company || company.length > 200)
    return { error: 'Company is required (max 200 characters).' }
  if ((role ?? '').length > 200)
    return { error: 'Role is too long (max 200 characters).' }
  if (!interest || interest.length > 200)
    return { error: 'Please pick an option for "I\u2019m interested in".' }
  if ((notes ?? '').length > 5000)
    return { error: 'Notes are too long (max 5000 characters).' }
  if (!turnstileToken)
    return { error: 'Human-verification challenge was not completed.' }

  return {
    firstName,
    lastName,
    email,
    company,
    role: role ?? '',
    interest,
    notes: notes ?? '',
    turnstileToken,
  }
}

function isPlausibleEmail(s: string): boolean {
  // Intentionally lax — RFC-compliant validation is a rabbit hole.
  // Real validation happens when the operator replies.
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s)
}

async function verifyTurnstile(
  token: string,
  remoteIp: string | null,
): Promise<{ ok: true } | { ok: false; codes: string[] }> {
  const form = new URLSearchParams()
  form.set('secret', TURNSTILE_SECRET_KEY)
  form.set('response', token)
  if (remoteIp) form.set('remoteip', remoteIp.split(',')[0].trim())

  let res: Response
  try {
    res = await fetch(
      'https://challenges.cloudflare.com/turnstile/v0/siteverify',
      { method: 'POST', body: form, cache: 'no-store' },
    )
  } catch (err) {
    console.error('turnstile.siteverify.network', err)
    return { ok: false, codes: ['network-error'] }
  }

  if (!res.ok) {
    console.error('turnstile.siteverify.http', res.status)
    return { ok: false, codes: [`http-${res.status}`] }
  }

  const json = (await res.json().catch(() => null)) as
    | { success: boolean; 'error-codes'?: string[] }
    | null
  if (!json || !json.success) {
    console.error('turnstile.siteverify.failed', json?.['error-codes'])
    return { ok: false, codes: json?.['error-codes'] ?? ['unknown'] }
  }
  return { ok: true }
}

async function deliver(
  clean: CleanContactBody,
): Promise<{ ok: true } | { ok: false }> {
  const subject = `[ConsentShield] ${clean.interest} — ${clean.firstName} ${clean.lastName}`
  const text = renderText(clean)

  if (!RESEND_ENABLED) {
    console.log('\n[contact/dev-log] RESEND_API_KEY unset — logging instead:')
    console.log(text)
    return { ok: true }
  }

  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: CONTACT_FROM,
        to: [CONTACT_INBOX],
        reply_to: clean.email,
        subject,
        text,
      }),
      cache: 'no-store',
    })
    if (!res.ok) {
      const body = await res.text().catch(() => '')
      console.error('resend.contact.failed', res.status, body.slice(0, 400))
      return { ok: false }
    }
    return { ok: true }
  } catch (err) {
    console.error('resend.contact.network', err)
    return { ok: false }
  }
}

function renderText(c: CleanContactBody): string {
  return [
    `First name: ${c.firstName}`,
    `Last name:  ${c.lastName}`,
    `Email:      ${c.email}`,
    `Company:    ${c.company}`,
    `Role:       ${c.role || '—'}`,
    `Interest:   ${c.interest}`,
    '',
    'Notes:',
    c.notes || '(none)',
    '',
    '---',
    'Submitted via consentshield.in contact form.',
  ].join('\n')
}
