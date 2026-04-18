// ADR-0045 Sprint 1.2 — admin invite email dispatch via Resend.
//
// Admin auth is OTP-only (per project memory, no magic-link password
// flow). The invite email therefore points the invitee at the login
// page and tells them to enter their email; the first OTP round-trip
// signs them in. Their auth user already carries app_metadata.is_admin=true,
// so the very first successful sign-in reaches the operator dashboard.
//
// Missing RESEND_API_KEY degrades cleanly — the route handler returns
// `email_dispatch_skipped` so the operator can forward credentials
// out-of-band until env is set.

const ADMIN_LOGIN_URL =
  process.env.NEXT_PUBLIC_ADMIN_LOGIN_URL ?? 'https://admin.consentshield.in/login'

interface InviteEmailInput {
  to: string
  displayName: string
  adminRole: 'platform_operator' | 'support' | 'read_only'
  invitedByDisplayName: string
}

export class InviteEmailEnvError extends Error {}

export async function sendAdminInviteEmail(
  input: InviteEmailInput,
): Promise<{ dispatched: true } | { dispatched: false; reason: string }> {
  const apiKey = process.env.RESEND_API_KEY
  const from = process.env.RESEND_FROM ?? 'onboarding@resend.dev'

  if (!apiKey) {
    return { dispatched: false, reason: 'RESEND_API_KEY not set on admin env' }
  }

  const roleLabel =
    input.adminRole === 'platform_operator'
      ? 'Platform Operator'
      : input.adminRole === 'support'
        ? 'Support'
        : 'Read-only'

  const html = `
    <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',system-ui,sans-serif;max-width:560px;margin:0 auto;color:#0F2D5B">
      <h1 style="font-size:20px;margin:24px 0 12px">ConsentShield operator access</h1>
      <p>Hi ${escape(input.displayName)},</p>
      <p>${escape(input.invitedByDisplayName)} has added you to the ConsentShield operator console with <strong>${roleLabel}</strong> access.</p>
      <p>To sign in:</p>
      <ol>
        <li>Go to <a href="${ADMIN_LOGIN_URL}">${ADMIN_LOGIN_URL}</a>.</li>
        <li>Enter this email address.</li>
        <li>Enter the 6-digit code you receive.</li>
      </ol>
      <p style="color:#94A3B8;font-size:12px;margin-top:32px">
        You received this because an existing platform operator invited you. If you weren't expecting it, ignore this email — your account cannot be used until you sign in.
      </p>
    </div>
  `

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from,
      to: input.to,
      subject: 'ConsentShield — you have been granted operator access',
      html,
    }),
  })

  if (!res.ok) {
    const text = await res.text().catch(() => '')
    return { dispatched: false, reason: `Resend ${res.status}: ${text.slice(0, 200)}` }
  }

  return { dispatched: true }
}

function escape(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    c === '&'
      ? '&amp;'
      : c === '<'
        ? '&lt;'
        : c === '>'
          ? '&gt;'
          : c === '"'
            ? '&quot;'
            : '&#39;',
  )
}
