# Marketing-site invite gate — wireframe spec

**Date:** 2026-04-25
**Owning ADR:** ADR-0502 (marketing invite gate via email OTP).
**Surface:** `consentshield.in/gate` and three companion API routes.

This wireframe is the visual + interaction specification for the marketing-site access gate. Per the wireframes-first rule (`feedback_wireframes_before_adrs`), the ADR's acceptance criterion is "matches this wireframe."

---

## Why a wireframe rather than a Figma file

Two screens, one form per screen, no marketing-design surface area. Text-wireframe is normative for this scale of UI. If the implementation deviates structurally (extra screens, persistent multi-form layout, etc.), an alignment doc records the drift the same way the customer-app and admin alignment docs do.

---

## Visual posture

- Same palette and typography as the rest of the marketing site (DM Sans body / JetBrains Mono accents / Satoshi wordmark; navy + teal accents on slate-soft backgrounds).
- The existing marketing **Nav** and **Footer** render unchanged on the gate page. Nav links remain the public-marketing items; clicking any of them while ungated returns the visitor to `/gate` via the middleware redirect — acceptable, no special handling needed.
- Full-bleed hero pattern is **not** rendered on the gate (it's reserved for the home hero); the gate uses a single centred card on the slate-soft background to read as utility, not pitch.

---

## Screen 1 — Email entry

```
┌───────────────────────────────────────────────────────────────────┐
│  [ ConsentShield wordmark ]    [ no nav links — utility surface ] │
├───────────────────────────────────────────────────────────────────┤
│                                                                   │
│                                                                   │
│           ┌─────────────────────────────────────────┐             │
│           │  Confidential preview                    │             │
│           │                                          │             │
│           │  Enter the email address your invitation │             │
│           │  was sent to. We'll mail you a 6-digit   │             │
│           │  code valid for 10 minutes.              │             │
│           │                                          │             │
│           │  ┌───────────────────────────────────┐   │             │
│           │  │ name@company.com                  │   │             │
│           │  └───────────────────────────────────┘   │             │
│           │                                          │             │
│           │  [        Send me the code        ]      │             │
│           └─────────────────────────────────────────┘             │
│                                                                   │
│                                                                   │
│  [ Footer — copyright + DPDP-Act disclaimer; no links to gated   ] │
│  [ docs / pricing / product / contact pages                      ] │
└───────────────────────────────────────────────────────────────────┘
```

- **Eyebrow text** — "Confidential preview" (matches the home-hero pill).
- **Lede** — explicit about (a) email-must-match-invitation (b) 6-digit code (c) 10-minute validity.
- **Input** — `type="email"`, `autocomplete="email"`, `inputmode="email"`, `required`, `aria-label="Invitation email"`. Validated client-side as basic-email; server-side on submit.
- **Submit** — primary button ("Send me the code"). Disabled while in-flight; shows spinner + "Sending…". Re-enabled on response.
- **Error states** (rendered as a `<p role="alert">` between input and button):
  - Email not on allowlist → *"This email isn't on the invitee list. If you think this is a mistake, email hello@consentshield.in."* — same generic message regardless of which arm fired (allowlist miss / rate-limit hit / Resend failure) so the gate doesn't enumerate invitees.
  - Network failure → *"Couldn't reach the server. Try again."*
- **No help line / no mailto.** A public mailto on a gate page invites email harvesters and address-list spam; reaching out for a lost invitation is an out-of-band conversation the invitee initiates from the original invitation email's reply path.
- **No social-login**, **no signup**, **no "remember me"** — all wrong category for an invite-only confidential preview.

## Screen 2 — OTP entry

Rendered after a successful POST to `/api/gate/request-otp`. The same `<GateForm>` swaps state without a hard navigation. `?from=<path>` query param is preserved so successful verify returns the visitor to where they originally tried to go.

```
┌───────────────────────────────────────────────────────────────────┐
│  [ ConsentShield wordmark ]                                       │
├───────────────────────────────────────────────────────────────────┤
│                                                                   │
│           ┌─────────────────────────────────────────┐             │
│           │  Check your inbox                        │             │
│           │                                          │             │
│           │  We sent a 6-digit code to               │             │
│           │  name@company.com. It expires in 10 min. │             │
│           │                                          │             │
│           │  ┌─┐ ┌─┐ ┌─┐ ┌─┐ ┌─┐ ┌─┐                 │             │
│           │  │_│ │_│ │_│ │_│ │_│ │_│                 │             │
│           │  └─┘ └─┘ └─┘ └─┘ └─┘ └─┘                 │             │
│           │                                          │             │
│           │  [           Verify             ]        │             │
│           │                                          │             │
│           │  Didn't get it? [Send a new code]        │             │
│           │  Wrong email? [Use a different one]      │             │
│           └─────────────────────────────────────────┘             │
│                                                                   │
│  [ Footer ]                                                       │
└───────────────────────────────────────────────────────────────────┘
```

- **Heading** — "Check your inbox".
- **Lede** — confirms target email + 10-minute expiry.
- **OTP input** — single `<input type="text" inputmode="numeric" pattern="[0-9]{6}" maxLength={6} autocomplete="one-time-code" aria-label="6-digit code">` rendered with letter-spacing to give the six-cell appearance — no per-cell custom inputs (accessibility cost > visual gain at this scale).
- **Submit** — "Verify". Disabled until 6 digits typed. Shows spinner + "Verifying…" while in-flight.
- **Error states**:
  - Wrong code → *"That code didn't match. Try again."* (3 attempts before forcing a fresh request — enforced server-side by counting on the pending token).
  - Expired pending → *"Your code expired. Send a new one."* (auto-disables the input; "Send a new code" link prefilled).
- **Secondary actions** — both rendered as inline links:
  - **"Send a new code"** — POSTs to `/api/gate/request-otp` with the same email, mints fresh OTP + pending-token cookie, returns to OTP entry state with a small "New code sent" success line. Throttled 60s on the client + server.
  - **"Use a different one"** — clears pending state, returns to Screen 1.

## Screen 3 — Verified (redirect)

Not a rendered screen; on successful verify the API route sets the session cookie and returns `{ ok: true, redirect: <from-or-root> }`. Client navigates with `router.replace(redirect)` so the gate URL doesn't appear in history. Subsequent requests are served unmodified by the middleware as long as the session cookie is valid.

---

## Email template (Resend)

Plain HTML, plaintext fallback. Subject: `Your ConsentShield preview code: NNNNNN`.

Body (HTML, no images so it ships fast and doesn't get filtered):

```
ConsentShield · Confidential preview

Your sign-in code is

    NNNNNN

It expires in 10 minutes. You're receiving this because
your email address (name@company.com) is on the
ConsentShield invited-preview list.

If you didn't request this, you can ignore this email —
the code expires on its own.

  hello@consentshield.in
```

From: `ConsentShield <noreply@consentshield.in>`.
Reply-To: `hello@consentshield.in`.

## Cookies

| Name | Lifetime | HttpOnly | Secure | SameSite | Purpose |
|---|---|---|---|---|---|
| `cs_mkt_gate_pending` | 10 min | yes | yes | Lax | Server-signed envelope of `{ email, otp_hash, attempts_used, exp }` issued by `/api/gate/request-otp`; consumed by `/api/gate/verify-otp`. |
| `cs_mkt_gate_session` | 30 days | yes | yes | Lax | Server-signed envelope of `{ email, iat, exp }` issued on successful verify; checked by `middleware.ts` on every protected request. |

Domain: `.consentshield.in` so the cookie also covers preview deploys on `*.vercel.app` only via separate per-deploy preview domain (cookies don't cross to vercel.app — fine; preview deployments will just re-run the gate). Path: `/`. No persistence to localStorage or any client store; cookie is the only session surface.

## Logout

Linked discreetly in the **footer** as `Sign out of preview` (visible site-wide once gated). POST to `/api/gate/logout` clears the session cookie and redirects to `/gate`.

## Accessibility

- Both screens have a single `<h1>` matching the heading.
- All inputs labelled.
- The OTP input announces "6-digit code from your email" via `aria-describedby` on the help text.
- Error `<p role="alert">` is announced by screen readers when state changes.
- Tab order: input → primary button → secondary links.
- Focus management: on screen swap (1 → 2), focus moves to the OTP input automatically.
