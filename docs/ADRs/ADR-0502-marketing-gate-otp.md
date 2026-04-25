# ADR-0502: Marketing-site invite gate via email OTP

**Status:** In Progress
**Date proposed:** 2026-04-25
**Date started:** 2026-04-25
**Wireframe:** `docs/design/marketing-gate-otp-wireframe.md`
**Related:** ADR-0501 (marketing-site scaffold) · `feedback_otp_over_magic_link` · `feedback_session_fingerprint_server_only` · marketing-claims review 2026-04-25 (Layer 1 of confidential-preview gate)

---

## Context

The marketing site (`consentshield.in`) is now branded "Confidential preview" and the founder wants it to be visible **only to invited prospects** with the access tied to the email the invitation went to. The marketing-claims review (`docs/reviews/2026-04-25-marketing-claims-vs-reality-review.md`) Layer 1 already shipped a robots / noindex / X-Robots-Tag block; this ADR is Layer 2, the access-control gate.

Three options were on the table:

1. **Vercel Password Protection** — single shared password. Fastest to enable but Vercel re-priced this feature to ~$150/mo, which is unacceptable for a stopgap.
2. **Vercel Authentication / Trusted IPs** — gates on Vercel team membership or IP allowlist. Doesn't fit external invitees.
3. **Application-level OTP gate** — a small Next.js entry surface that asks for an email, sends an OTP, sets a session cookie. Per-email, no SaaS spend, mirrors the OTP-over-magic-link pattern already used in the customer app.

Decision: option 3.

## Decision

A two-screen entry gate at `/gate` plus a Next.js middleware that enforces a session cookie on every other route. OTP delivery via the already-wired Resend API on the marketing site. Allowlist stored in a single env var (`MARKETING_GATE_INVITES`, comma-separated). Sessions and pending-OTP envelopes are HS256-signed JWTs (Web Crypto, zero npm dep — Rule 16 spirit) keyed off a single env-var secret (`MARKETING_GATE_SECRET`). Every gate event (request, verify-success, verify-fail, logout, redirect-from-middleware) is logged as a structured `console.log` line that Vercel's log sink ingests; no PII payload beyond the invitee email itself, which is operator data, not principal data.

### Routing surfaces

- `/gate` — the entry surface. Renders the email-entry → OTP-entry flow per the wireframe. Server component → client form.
- `POST /api/gate/request-otp` — body `{ email }`. Validates against allowlist, generates a 6-digit OTP, hashes it (SHA-256 + per-OTP salt), stores `{ email, otp_hash, salt, attempts_used: 0, exp: now+10m }` inside a signed pending-token cookie (`cs_mkt_gate_pending`, HttpOnly, Secure, SameSite=Lax, 10m). Sends OTP via Resend. **Always returns 200** with a generic acknowledgement so the gate doesn't enumerate which emails are on the allowlist. Rate-limited per IP (3 requests / 5 minutes — in-process Map, accepted as best-effort).
- `POST /api/gate/verify-otp` — body `{ otp }`. Reads pending cookie, recomputes hash, compares constant-time. On match: clears the pending cookie, mints `cs_mkt_gate_session` (HttpOnly, Secure, SameSite=Lax, 30d) and returns `{ ok: true, redirect }`. On mismatch: increments `attempts_used` in a re-signed pending cookie, allows up to 3 attempts before invalidating (forcing a fresh request).
- `POST /api/gate/logout` — clears `cs_mkt_gate_session` cookie, returns `{ ok: true }`. Linked from the marketing footer as "Sign out of preview".
- `marketing/src/middleware.ts` — runs on every route; redirects to `/gate?from=<original-pathname-and-search>` when no valid session cookie. Allow-list of unauthenticated paths: `/gate*`, `/api/gate/*`, `/_next/static/*`, `/_next/image*`, `/favicon.ico`, `/icon.svg`, `/robots.txt`, `/monitoring*` (Sentry tunnel route).

### Crypto

- HS256 via `crypto.subtle` (Web Crypto, native to the Vercel Node runtime). No `jose` / `jsonwebtoken` dep — keeps the marketing dependency footprint flat and matches Rule 16's "if it can be implemented in 1 day, write it yourself" spirit.
- Signing key: `MARKETING_GATE_SECRET` env var, 64-byte hex (256-bit). Generated locally by the operator (`openssl rand -hex 32`), set on production + preview via the Vercel env-var setup runbook in `reference_vercel_setup.md`. Rotation: change the secret + restart; all sessions invalidate; expected rare.
- OTP: 6 numeric digits, generated via `crypto.randomInt(0, 1000000)` padded to 6. Hashed with `crypto.createHash('sha256').update(salt + otp).digest('hex')`. Salt is 16 bytes random per OTP, embedded in the pending-token alongside the hash so verify can recompute deterministically.
- Constant-time compare via `crypto.timingSafeEqual`.

### Allowlist

- `MARKETING_GATE_INVITES` — comma-separated, case-insensitive, trimmed. Example value: `a.d.sudhindra@gmail.com,prospect1@bank.com,prospect2@hospital.com`.
- Operator workflow: edit on the Vercel dashboard (or `bunx vercel@39 env add MARKETING_GATE_INVITES production` per the v52 preview-bug memory), redeploy. Take-the-list-private later when it grows past ~50 emails by promoting to a Supabase-backed lookup; today the env-var path is the simplest possible source-of-truth.
- The check is the first line of `request-otp` after request validation. Returns the **same** generic 200-ack response whether the email is on the list or not — gate must not enumerate.

### Logging

- Structured single-line `console.log` per event with a stable schema: `{ event, ts, ip_truncated, ua_short, email_or_unknown, outcome, request_id }`. Vercel's log sink ingests these for `vercel logs` retrieval.
- Events:
  - `gate.middleware.redirect` — outcome: `redirect`. Email omitted (no session yet).
  - `gate.otp.requested` — outcome: `accepted` | `rate_limited`. Email always included (operator-data; rule 6 covers principal-data, not operator audit).
  - `gate.otp.verified` — outcome: `success` | `expired` | `mismatch` | `attempts_exhausted`.
  - `gate.session.minted` — outcome: `created`. Includes the JWT `iat` so audit can reconstruct.
  - `gate.session.cleared` — outcome: `logout`.
- IP truncation: keep first three octets of v4, first 64 bits of v6 — same pattern as `feedback_session_fingerprint_server_only`. Avoids storing complete client IPs while preserving regional debug.
- UA: first 64 characters only.
- Sentry breadcrumbs piggyback on the same events but **never** include the email; the Sentry side only carries the event name + outcome.

### What this ADR is *not*

- Not the public-marketing version of the customer-app invitation flow. Customer-app invitations grant an account; this gate grants read access to the marketing site only. Email allowlists are unrelated.
- Not a replacement for the customer-app login. Once an invitee finishes evaluating, they sign up via the existing `/signup` flow on the customer app (which is separately gated by Turnstile + email OTP).
- Not multi-region resilient (the rate-limiter is in-process — fine for a confidential preview with a 24-hour visitor budget; revisit when traffic justifies KV-backed rate-limiting).
- Not a place where the existing customer-app SSO patterns live. The marketing project is intentionally isolated from Supabase — `check-env-isolation.ts` does not allow `SUPABASE_*` vars on it; the gate stays purely env-var + Resend.

## Consequences

- **No new SaaS spend.** $0 / month vs Vercel's $150 / month password-protection add-on.
- **Per-invitee revocation** — remove an email from the env var, redeploy, the session cookie they hold continues to work until expiry (30d). For instant kick-out: rotate `MARKETING_GATE_SECRET` (invalidates everyone). Add a denylist later if surgical revocation becomes a real ask.
- **Logged audit trail** — `vercel logs --no-follow --since 30d` reconstructs every gate event for the last 30 days. Sufficient for the small-scale confidential-preview audience.
- **Two new marketing env vars** — `MARKETING_GATE_SECRET` (32-byte hex), `MARKETING_GATE_INVITES` (comma-separated). Both go on Production + Preview scopes per `reference_vercel_setup.md`.
- **Cookie domain** — set to `.consentshield.in` so the session works across www and apex. Vercel-preview hostnames (`*.vercel.app`) won't share the cookie; that's acceptable — preview deployments re-run the gate independently.
- **Trade-off, allowlist-by-env-var** — the operator workflow is "edit env var + redeploy" rather than "click Add in dashboard." Acceptable at the volume the confidential preview targets (estimate < 50 invitees).

## Implementation Plan

### Sprint 1.1 — Foundation libs (~1h) — **complete 2026-04-25**

**Deliverables:**
- [x] `marketing/src/lib/gate/jwt.ts` — HS256 sign / verify using Web Crypto. Header `{alg:HS256,typ:JWT}`; payload arbitrary; throws on signature mismatch / expiry.
- [x] `marketing/src/lib/gate/otp.ts` — 6-digit numeric OTP generator + salted SHA-256 hasher + `timingSafeEqual` compare wrapper.
- [x] `marketing/src/lib/gate/allowlist.ts` — env-var parser; `isInvited(email)` returns boolean against `MARKETING_GATE_INVITES`. Case-insensitive + trim.
- [x] `marketing/src/lib/gate/log.ts` — `logGateEvent({ event, outcome, ... })` writing structured JSON to `console.log`. IP-truncation + UA-truncation helpers.
- [x] `marketing/src/lib/gate/rate-limit.ts` — in-process Map; `tryConsume(ip, key, max, windowMs)` returns `{ ok, retryAfterMs }`.
- [x] `marketing/src/lib/gate/templates.ts` — Resend HTML + plaintext template for the OTP email.

### Sprint 1.2 — Middleware + API routes (~1h) — **complete 2026-04-25**

**Deliverables:**
- [x] `marketing/src/middleware.ts` — gate enforcement; allowlist of unauthenticated paths.
- [x] `marketing/src/app/api/gate/request-otp/route.ts` — request handler; rate-limit; allowlist check; OTP generate + send; pending cookie issue.
- [x] `marketing/src/app/api/gate/verify-otp/route.ts` — verify handler; constant-time compare; attempt count; session cookie issue.
- [x] `marketing/src/app/api/gate/logout/route.ts` — clear session cookie.

### Sprint 1.3 — UI (~1h) — **complete 2026-04-25**

**Deliverables:**
- [x] `marketing/src/app/gate/page.tsx` — server component reading `?from=` query.
- [x] `marketing/src/app/gate/gate-form.tsx` — client component implementing the two-screen flow per the wireframe.
- [x] `marketing/src/app/gate/gate.module.css` — minimal styling using existing palette tokens.
- [x] `marketing/src/components/footer.tsx` — adds "Sign out of preview" link when session cookie is present.

### Sprint 1.4 — Env + ops (~30min) — **operator-pending**

**Deliverables:**
- [ ] `marketing/.env.example` updated to document the two new env vars.
- [ ] `MARKETING_GATE_SECRET` set on Production + Preview (operator runs `openssl rand -hex 32` then `bunx vercel@39 env add ...`).
- [ ] `MARKETING_GATE_INVITES` set with the founder's email at minimum (operator).
- [ ] Resend domain verification confirmed for `noreply@consentshield.in` (likely already done since invitation-dispatch uses it; reconfirm).
- [ ] First-pass smoke: founder receives an OTP, verifies, navigates a marketing page, verifies session cookie persists; logout clears.

## Test Plan

- Unit tests for `jwt.ts` (sign-and-verify round-trip; tampered payload rejected; expired token rejected).
- Unit tests for `otp.ts` (hash determinism for same salt + otp; mismatch under wrong otp; constant-time compare).
- Unit tests for `allowlist.ts` (case + whitespace; empty env var → all rejected; multi-comma-handling).
- Integration test (mocked Resend) on `request-otp`: allowlist hit → 200 + cookie issued; allowlist miss → 200 with no cookie; rate-limit hit → 429.
- Integration test on `verify-otp`: correct OTP → 200 + session cookie; incorrect → 401 with attempt count; expired → 401; missing pending → 401.
- E2E (Playwright) — Mrs Sharma path: visit `/`, redirected to `/gate?from=%2F`, submit invited email, type OTP, return to `/`, click logout, redirected back to `/gate`. To author in a follow-up sprint; not a launch blocker.

## Acceptance Criteria

- A non-invited visitor lands on `/gate` regardless of which marketing URL they hit. They see the wireframe's Screen 1.
- An invited visitor enters their email, receives a 6-digit OTP within 10 seconds, enters it on Screen 2, and is redirected to wherever they originally tried to go.
- The session persists across browser tabs and survives a page refresh for 30 days.
- "Sign out of preview" in the footer clears the cookie and bounces back to `/gate`.
- A wrong OTP shows the wireframe's mismatch error; the third wrong attempt invalidates the pending token and forces "Send a new code".
- robots.ts, document `<meta name="robots">`, and the `X-Robots-Tag` HTTP header all continue to ship per Layer 1 (this ADR's scope is access control, not crawler policy).
- `vercel logs --no-follow --since 1h` returns structured JSON entries for each of the five `gate.*` event names.

## Architecture Changes

- New surface `marketing/src/lib/gate/` houses six small modules with no external network deps beyond Resend (already wired). Web Crypto used everywhere; no new npm package.
- `marketing/src/middleware.ts` is the first middleware on the marketing project; everything previously routed unconditionally. The middleware is whitelist-based (paths that bypass the gate are explicit) so the default is "gated" — fail-closed.
- The marketing site no longer exposes the home page anonymously; SEO previously affected by Layer 1 (noindex) is now layered with access control. Both layers are independent.
- Logging convention: every gate event ships a `gate.*` event name to Vercel logs, queryable with `vercel logs ... | jq 'select(.event | startswith("gate."))'`.

## V2 backlog

- Surgical per-invitee revocation without rotating the global secret — a denylist column on top of the allowlist, possibly migrated to Supabase once the invitee count > 50.
- Per-invitee usage report — count gate.session.minted by email, surface in admin (or just `vercel logs | jq` for now).
- KV-backed rate limit so per-IP throttling survives cold starts.
- Magic-link as an opt-in alternative to OTP (the founder's preference is OTP-over-magic-link per memory; not changing it here).
- Bypass token for support automation (separate signed-URL grant; rare ask).

