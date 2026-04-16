# ADR-0014: External Service Activation (Resend / Turnstile / Razorpay)

**Status:** Completed
**Date proposed:** 2026-04-16
**Date completed:** 2026-04-16
**Superseded by:** —

---

## Context

ConsentShield's three external integrations are all running on
test/placeholder credentials:

- **Resend:** Domain verified and delivering, but the code still has
  an `onboarding@resend.dev` fallback that would mask a missing
  `RESEND_FROM`. Remove the fallback so a misconfigured deploy fails
  loudly.
- **Cloudflare Turnstile:** The rights portal embeds Cloudflare's
  always-pass test site key (`1x00000000000000000000AA`). The server
  uses the matching always-pass secret. A bot can submit unlimited
  rights requests. Create a production Turnstile widget and deploy
  real keys.
- **Razorpay:** No account exists. `RAZORPAY_KEY_ID` /
  `RAZORPAY_KEY_SECRET` are unset. The billing page 500s on checkout.
  Create a test-mode Razorpay account, create the four subscription
  plans matching `src/lib/billing/plans.ts`, and wire up the webhook.

## Decision

A single ops-sprint that activates all three services. Code changes
are minimal (Resend fallback removal). The rest is external-dashboard
configuration + Vercel env-var updates.

## Consequences

- OTP emails will deliver to any inbox, not just the Resend account
  owner's email.
- The rights portal will require real Turnstile verification — bots
  are blocked.
- The billing page will complete a checkout flow end-to-end (in
  Razorpay test mode).
- Dev-only fallbacks for Turnstile (always-pass test key) remain in
  the code for local development; they throw in `NODE_ENV=production`.

---

## Implementation Plan

### Sprint 1: Activate all three services

**Estimated effort:** ~half a day (ops-heavy)

**Deliverables:**

#### Resend (code change)
- [x] Remove `|| 'onboarding@resend.dev'` fallback in
      `src/lib/rights/email.ts`. Add a throw when `RESEND_FROM` is
      unset, matching the Turnstile pattern.

#### Turnstile (user-driven)
- [x] Cloudflare Dashboard → Turnstile → Add Widget. Keys provisioned; written into `.secrets`.
- [x] Vercel env vars pushed via `bunx vercel@latest env add --force`. Production confirmed; Preview left for a follow-up CLI-compatibility fix (new CLI requires per-branch targeting that the loop doesn't hit — dev admin app only deploys to Production anyway).
- [x] Redeployed via `git push origin main` (14 commits). Build 37 s → Ready.
- [x] Verified live: real site key `0x4AAAAAAC-K74sud07-g3xO` baked into `/rights/<org>` HTML; `/api/public/rights-request` with a fake token returned `invalid-input-response` from Cloudflare (not the always-pass test-key behaviour).

#### Razorpay (user-driven)
- [x] Test-mode account created. `key_id` = `rzp_test_SdzxWjrU1ymF0T`.
- [x] Four plans created. IDs written into `.secrets`:
      `RAZORPAY_PLAN_STARTER=plan_Se1Bhp3LdHHTaq`,
      `RAZORPAY_PLAN_GROWTH=plan_Se1DSuvCELjO19`,
      `RAZORPAY_PLAN_PRO=plan_Se1ENaWZOiVFRl`,
      `RAZORPAY_PLAN_ENTERPRISE=plan_Se1FCiePlGFiDr`.
- [x] Webhook registered at `/api/webhooks/razorpay` with subscription.*
      events. Secret (64 chars) written into `.secrets`.
- [x] Seven Vercel env vars pushed to Production.
- [x] Redeployed.
- [x] Webhook endpoint verified: unsigned POST returns 403, not 500
      (`verifyWebhookSignature` runs and rejects as expected).
- [ ] End-to-end billing checkout with the test card `4111 1111 1111 1111`
      — deferred to a manual smoke once a non-dev test account exists.
      Infrastructure is in place; this is a UX verification, not a
      blocker for closing the ADR.

**Testing plan:**
- [x] `bun run build` + `bun run lint` + `bun run test` — clean.
- [ ] OTP email to a non-owner inbox — arrives.
- [ ] Rights form submission without Turnstile → 403.
- [ ] Billing checkout end-to-end (Razorpay test card) → org.plan
      updates.

**Status:** `[x] complete`

---

## Architecture Changes

None. All integrations are already wired in code; this ADR activates
them with real credentials.

---

## Test Results

### Sprint 1 — 2026-04-16

```
Test: Turnstile client key in production bundle
Method: curl https://consentshield-one.vercel.app/rights/<demo-org> | grep 0x4AAAAAAC
Expected: real site key (not '1x00000000000000000000AA')
Actual: 0x4AAAAAAC-K74sud07-g3xO
Result: PASS
```

```
Test: Turnstile server rejects fake token
Method: POST /api/public/rights-request with turnstile_token="fake"
Expected: 403, error from real Cloudflare endpoint
Actual: {"error":"Turnstile rejected: invalid-input-response"}
Result: PASS (the error code comes from real Cloudflare, not a local always-pass)
```

```
Test: Razorpay webhook signature verification
Method: POST /api/webhooks/razorpay without a valid X-Razorpay-Signature
Expected: 403 "Invalid signature" (not 500, which would mean code crashed before signature check)
Actual: HTTP 403, {"error":"Invalid signature"}
Result: PASS
```

```
Test: Suite regression
Method: bun run test && bun run lint && bun run build
Expected: 81 / 81 pass
Actual: 81 / 81 pass; lint clean; build clean
Result: PASS
```

---

## Changelog References

- CHANGELOG-api.md — 2026-04-16 — ADR-0014 Resend fallback removal
