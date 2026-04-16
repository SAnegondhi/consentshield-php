# ADR-0013: Signup Bootstrap Hardening

(c) 2026 Sudhindra Anegondhi a.d.sudhindra@gmail.com

**Status:** Completed
**Date proposed:** 2026-04-15
**Date completed:** 2026-04-15

---

## Context

After ADR-0009, `/api/auth/signup` refuses to bootstrap the org unless
`auth.getUser()` returns a server-side session. That's correct (the old
route trusted a client-supplied `userId`) but incompatible with the common
Supabase configuration where "Confirm email" is ON: `supabase.auth.signUp`
returns `{user, session: null}` and no cookie is set. The browser fetch to
`/api/auth/signup` arrives without auth and gets 401, leaving the
newly-created auth user with no organisation row.

Quick-fix today: toggle "Confirm email" off in Supabase. Unacceptable for
production or even staging — we should work regardless of the flag, and
trusting a client-supplied user id is a regression we won't reintroduce.

## Decision

Consolidate every post-signup flow through a single server-side callback.
The signup form attaches `orgName` + `industry` to the auth user's
`user_metadata` via `options.data`, and always redirects to
`/auth/callback`. The callback handler:

1. If there's a `?code=…` (email-confirmation link), exchanges it for a
   session.
2. Reads the current user with the freshly-set cookie.
3. If the user has no `organisation_members` row and `user_metadata`
   carries an `org_name`, calls `rpc_signup_bootstrap_org` under the
   user's JWT (same RPC as ADR-0009 Sprint 3.1).
4. Redirects to `/dashboard` on success, `/login?error=…` on failure.

Both Supabase flavours converge on the same code path:

| Scenario | Immediate effect | Where bootstrap runs |
|----------|------------------|----------------------|
| Confirm email OFF | `signUp` returns session | `/auth/callback` reached directly; no code exchange; RPC runs |
| Confirm email ON | `signUp` returns `session: null`, user sees "check your inbox" | Email link → `/auth/callback?code=…` → exchange → RPC runs |

`/api/auth/signup` is removed. It was introduced in ADR-0009 Sprint 3.1;
ADR-0013 supersedes that file.

## Consequences

- `user_metadata` becomes load-bearing: it carries the pending org name
  across the email-confirmation gap. Operators inspecting
  `auth.users.raw_user_meta_data` will now see `{org_name, industry}` for
  any user whose confirmation is pending.
- `rpc_signup_bootstrap_org` gets one new invariant: it must be
  idempotent. If the user already has an `organisation_members` row, the
  callback short-circuits and the RPC isn't called. No changes to the RPC
  body.
- The old `/api/auth/signup` route disappears; no caller survives after
  this sprint.
- Email confirmation becomes a deploy-time toggle with no code changes.
  Production will be ON; dev can stay OFF if the operator prefers faster
  iteration.

---

## Implementation Plan

### Phase 1: Single callback path

#### Sprint 1.1: Rework signup UX + add `/auth/callback`

**Deliverables:**
- `src/app/(public)/signup/page.tsx`:
  - Attach `{ org_name, industry }` to `options.data`.
  - Set `options.emailRedirectTo` to
    `${window.location.origin}/auth/callback`.
  - If `signUp` returns a session, redirect to `/auth/callback`.
  - If session is null, render a "Check your email" panel with a resend
    link.
- `src/app/auth/callback/route.ts` (new, server `GET`):
  - `exchangeCodeForSession` on `?code=…`.
  - Check `organisation_members` for the signed-in user; if empty and
    `user_metadata.org_name` present, call `rpc_signup_bootstrap_org`.
  - Redirect to `/dashboard` on success; `/login?error=…` otherwise.
- Delete `src/app/api/auth/signup/route.ts`.

**Testing plan:**
- `bun run lint`, `bun run build`, `bun run test` — all green; route
  count drops by one.
- Manual (confirm-email OFF): sign up a fresh email →
  `organisations` + `organisation_members` + `audit_log` rows present;
  lands on `/dashboard`.
- Manual (confirm-email ON): sign up `a.d.sudhindra@gmail.com` →
  "Check your email" panel → click email link → lands on `/dashboard`.
- Idempotency: hitting `/auth/callback` twice in a row does not create a
  second `organisations` row.

**Status:** `[x] complete` (superseded in effect by Sprint 1.2; magic-link path is no longer the primary flow)

#### Sprint 1.2: OTP-only email verification (supersedes magic-link flow)

**Goal:** Eliminate the magic-link email entirely. Replace with a 6-digit
OTP that the user types back into the session that requested it. Closes
the phishing, email-forwarding, referer-leak, and email-scanner-prefetch
failure modes that magic links carry.

**Why OTP over magic link:**
1. **Phishing / forwarding resistance.** Magic link in email = anyone with
   mailbox access can complete signup. OTP requires the originating
   browser tab.
2. **No URL leakage.** Browser history, `Referer`, proxy logs never carry
   an OTP.
3. **No email-scanner premature consumption.** Outlook / Google Workspace
   scanners prefetch links and consume single-use tokens before the user.
4. **Device continuity.** OTP forces the same browser to start and
   finish; a lost phone with logged-in email isn't a full takeover.

Matches ADR-0004 (rights-request OTP). Consistency across every
email-as-identity moment.

**Deliverables:**
- `src/app/(public)/signup/page.tsx` — two-stage form (email + org
  → OTP). Uses `supabase.auth.signInWithOtp({email, options:{data}})`;
  then `supabase.auth.verifyOtp({email, token, type:'email'})`. Navigates
  to `/auth/callback` on success.
- `src/app/(public)/login/page.tsx` — two-stage form (email → OTP).
  Passwords removed from the UI (Supabase still accepts password auth at
  the API, but we don't surface it).
- `/auth/callback` — no code change. Already handles the "session already
  set by client, no `?code` param" path.
- Operator action: set the Supabase "Magic Link" email template to
  surface `{{ .Token }}` prominently and drop the `{{ .ConfirmationURL }}`
  link (eliminates the link fallback a scanner could prefetch).

**Testing plan:**
- `bun run lint`, `bun run build`, `bun run test` — green.
- Manual: signup a new email → code arrives → enter code → `/dashboard`.
- Manual: login with an existing email (Estara-ai admin) → code arrives
  → enter code → `/dashboard`, org loads.
- Idempotency: existing user re-submitting the signup form does not
  create a new org.

**Status:** `[x] complete`

---

## Architecture Changes

- `docs/architecture/consentshield-definitive-architecture.md` — auth flow
  section updated to describe the single callback path + metadata bridge.
- `.env.local.example` — reminds operators that
  `NEXT_PUBLIC_APP_URL` must match the actual deployment origin because
  `emailRedirectTo` is built from it.

---

## Test Results

### Sprint 1.2 — 2026-04-15 (live, end-to-end)

```
Test: bun run lint / build / test
Expected: all green
Actual:   lint clean, 38 routes built, 39/39 tests pass
Result: PASS

Test: deliverability audit for noreply@consentshield.in
Method: POST /auth/v1/otp → observe Resend event log
Expected: OTP email delivers to Gmail
Actual: initial attempts bounced. Diagnostic below, all fixed:
  - DMARC had adkim=s; aspf=s (strict). Resend signs from send.
    subdomain; strict alignment rejected. Fixed: relaxed to r.
  - DKIM TXT at resend._domainkey.consentshield.in was stale with
    an empty public key ("v=DKIM1; p="). Cloudflare zone itself
    had the correct record; DNS cache/sync lag was the proximate
    cause. After a manual refresh the record resolved correctly.
  - Supabase's "Confirm signup" and "Magic Link" templates are
    separate; the operator customised both to surface `{{ .Token }}`
    and drop the `{{ .ConfirmationURL }}` fallback.
Result: PASS — Resend event log shows `delivered` for every
Supabase-path signup and login OTP after the DNS + template fixes.

Test: end-to-end signup via /signup on the live deploy
Method: Visit https://consentshield-one.vercel.app/signup; fill
  email + orgName + industry; receive code; verify; land on /dashboard.
Expected: organisations + organisation_members + audit_log rows
  created under the new auth.uid().
Actual: confirmed by user. Idempotency not stressed yet (single
  fresh account) — revisit on next signup.
Result: PASS. Idempotency regression test remains deferred — see
follow-ups below.
```

### Follow-ups noted

- DMARC is back at strict `p=reject` which is fine post-fix; relaxed
  alignment (`adkim=r; aspf=r`) stays.
- **Ops runbook published.** `docs/ops/supabase-auth-templates.md`
  carries the paste-ready OTP HTML for all four Supabase email
  templates (Confirm signup, Magic Link, Reset Password,
  Change Email Address). Anyone enabling a new auth flow uses that
  file, not this ADR.
- **Idempotency regression test — deferred.** The guard against
  double-bootstrap lives in `src/app/auth/callback/route.ts` (checks
  `organisation_members` before calling `rpc_signup_bootstrap_org`),
  not in the RPC itself. Testing it requires Next.js route-handler
  invocation with a mocked Supabase client; no such harness exists
  in this repo yet. Will ride along with ADR-0012 Sprint 3
  (buffer-pipeline + route tests) or a dedicated follow-up ADR.
  Live single-account signup passed, so no known bug — only the
  automated safety net is missing.

---

## Changelog References

- `CHANGELOG-api.md` — route removed, callback added (sprint 1.1)
- `CHANGELOG-dashboard.md` — signup page UX (sprint 1.1)
