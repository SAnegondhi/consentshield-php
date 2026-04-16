# Supabase Auth Email Templates (OTP form)

(c) 2026 Sudhindra Anegondhi a.d.sudhindra@gmail.com

Paste-ready HTML for the four Supabase Auth email templates. All four
follow the same OTP-only pattern — **never** reintroduce the
`{{ .ConfirmationURL }}` / magic-link form. See ADR-0013 for the
security reasoning (phishing resistance, device continuity, no
prefetch-consumption by email scanners).

Where to paste: **Supabase Dashboard → Authentication → Email Templates**.

Each template must surface `{{ .Token }}` and must NOT include a
clickable `{{ .ConfirmationURL }}` link. A mail-scanner that prefetches
any link in the body will consume a single-use confirmation URL before
the user sees it — that's exactly the class of bug OTP was chosen to
avoid.

---

## 1. Confirm signup  (fires on first-time signup)

Template selector in Dashboard: **Confirm signup**.

```html
<h2>Your ConsentShield code</h2>
<p>Enter this code to continue:</p>
<h1 style="font-size:36px;letter-spacing:8px">{{ .Token }}</h1>
<p>This code expires in 60 minutes. If you didn't request it, ignore this email.</p>
```

## 2. Magic Link  (fires on `signInWithOtp` for an existing user)

Template selector in Dashboard: **Magic Link**.

Same body as Confirm signup — Supabase uses the Magic Link slot for
OTP login emails, even though we don't use the link field:

```html
<h2>Your ConsentShield code</h2>
<p>Enter this code to continue:</p>
<h1 style="font-size:36px;letter-spacing:8px">{{ .Token }}</h1>
<p>This code expires in 60 minutes. If you didn't request it, ignore this email.</p>
```

## 3. Reset Password  (fires on `resetPasswordForEmail`)

Template selector in Dashboard: **Reset Password** (sometimes labelled
`recovery`).

```html
<h2>Reset your ConsentShield password</h2>
<p>Enter this code to continue:</p>
<h1 style="font-size:36px;letter-spacing:8px">{{ .Token }}</h1>
<p>This code expires in 60 minutes. If you didn't request a reset, ignore this email and your password will stay the same.</p>
```

> **Do not enable the password-reset UI in the app until this template
> is updated.** The stock template still includes a
> `{{ .ConfirmationURL }}` link and omits `{{ .Token }}`.

## 4. Change Email Address  (fires on `updateUser({email})`)

Template selector in Dashboard: **Change Email Address** (sometimes
labelled `email_change`).

```html
<h2>Confirm your new email for ConsentShield</h2>
<p>Enter this code in the email-change form:</p>
<h1 style="font-size:36px;letter-spacing:8px">{{ .Token }}</h1>
<p>This code expires in 60 minutes. If you didn't request this change, contact support@consentshield.in immediately.</p>
```

Supabase sends the `email_change` token to **both** the old and new
addresses (double opt-in). The client code must call
`verifyOtp({type: 'email_change'})` once the user enters the code.

---

## Checklist before enabling any new auth flow

- [ ] OTP template pasted for the flow (from this file).
- [ ] Verified the email delivers to Gmail / Outlook / a corporate inbox
      (catch DMARC + DKIM regressions before shipping).
- [ ] UI uses `verifyOtp` with the correct `type` argument (`email` for
      signup + signInWithOtp; `recovery` for reset; `email_change` for
      address change).
- [ ] No code path surfaces a `{{ .ConfirmationURL }}` link — inspect
      the raw email after the template update.
- [ ] Operator runbook for the incident template updated if this flow
      carries new support semantics (password reset support escalation
      path, for example).

## Related documents

- `docs/ADRs/ADR-0013-signup-bootstrap-hardening.md` — why OTP over
  magic link, and the single-callback architecture.
- `docs/ADRs/ADR-0004-rights-request-workflow.md` — OTP on the
  rights-portal (same reasoning, different flow).
