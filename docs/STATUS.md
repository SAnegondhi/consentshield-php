# ConsentShield Status

(c) 2026 Sudhindra Anegondhi a.d.sudhindra@gmail.com

**Snapshot date:** 2026-04-15
**Branch:** main
**Latest commit:** `90cfd5d` — feat: root page is now a real landing with signup/login + demo-sites link

---

## Summary

Phase 1 (ADR-0001…0007) closed on 2026-04-14. On 2026-04-14/15 an internal
codebase review (`docs/reviews/2026-04-14-codebase-architecture-review.md`)
surfaced nine blocking security / compliance issues and thirteen should-fix
items. All nine blockers are closed; nine of thirteen should-fix items are
closed; the remaining four are scoped into named future ADRs
(`docs/reviews/2026-04-15-deferred-items-analysis.md`). The Next.js app is
deployed to Vercel at `consentshield-one.vercel.app`, five static demo
customer sites at `consentshield-demo.vercel.app`, the Worker at
`cdn.consentshield.in`, and the SLA Edge Function in Supabase. One known
bug blocks end-to-end signup on the live environment — documented below.

---

## ADR Completion

| ADR | Title | Status |
|-----|-------|--------|
| 0001 | Project scaffolding | Completed |
| 0002 | Worker HMAC + origin validation | Completed |
| 0003 | Banner builder + dashboard + privacy notice | Completed |
| 0004 | Rights request workflow (Turnstile + OTP) | Completed |
| 0005 | Tracker monitoring | Completed |
| 0006 | Razorpay billing + plan gating | Completed |
| 0007 | Deletion orchestration | Completed |
| 0008 | Browser auth hardening (remove client secret, origin_verified, fail-fast Turnstile) | Completed |
| 0009 | Scoped-role enforcement in REST paths | Completed |
| 0010 | Distributed rate limiter (Vercel KV) | Proposed (scoped) |
| 0011 | Deletion retry / timeout Edge Function | Proposed (scoped) |
| 0012 | Automated test suites (worker / buffer / workflows) | Proposed (scoped) |

---

## Deployments Live

| Component | URL / identifier |
|-----------|------------------|
| Admin app (Next.js on Vercel) | `https://consentshield-one.vercel.app` |
| Demo customer sites (Vercel) | `https://consentshield-demo.vercel.app` (5 scenarios: ecommerce, saas, blog, healthtech, violator) |
| Cloudflare Worker CDN | `https://cdn.consentshield.in/v1/*` (Worker version `9fb7bd37`) |
| Supabase project | `xlqiakmkdjycfiioslgs` |
| SLA Edge Function | `send-sla-reminders` deployed; reads `CS_ORCHESTRATOR_ROLE_KEY` (CS_ prefix because Supabase reserves SUPABASE_) |
| pg_cron jobs | 6 active: 5 orchestrator HTTP posts (key via Supabase Vault `cs_orchestrator_key`) + `cleanup-unverified-rights-requests-daily` |
| GitHub repo | `github.com/SAnegondhi/consentshield` |

---

## Database State

- **32 operational tables** + `webhook_events_processed` (new for S-3). All with RLS enabled.
- **20 migrations applied**, through `20260414000010_scoped_roles_rls_and_auth.sql`.
- **Scoped roles** (`cs_worker`, `cs_delivery`, `cs_orchestrator`) are now the real runtime principals. Every mutating code path routes through a security-definer RPC owned by `cs_orchestrator` (or `cs_delivery`), granted to `anon` or `authenticated` per endpoint. `grep -r SUPABASE_SERVICE_ROLE_KEY src/` returns zero matches.
- `cs_orchestrator` / `cs_delivery` carry `BYPASSRLS` + `USAGE on schema auth` so security-definer calls can read org-scoped tables inside their own function bodies.
- **Demo org** seeded: `ConsentShield Demo Customer` (`432bca6d-8fce-415a-85e0-96397ddac666`) with 5 web properties + 5 banners matching the Vercel demo site routes.
- RLS isolation suite: **39 / 39 passing** on every build.

---

## Pending Manual Setup

| Item | Action required |
|------|-----------------|
| Supabase Auth "Confirm email" | **Toggle off for dev** (Auth → Providers → Email). Currently ON, which breaks the `signUp` → bootstrap flow (signUp returns `session=null`, `/api/auth/signup` 401s on `auth.getUser()`). See Known Bugs below for proper fix plan. |
| Resend domain verification | `consentshield.in` still unverified; sender is `onboarding@resend.dev`. |
| Turnstile production keys | Using CF always-pass test keys on Vercel. Production fail-fast is enforced; replace before any real traffic. |
| Razorpay account | No keys. Billing UI will 500 on checkout; intentional until real keys exist. |
| NEXT_PUBLIC_APP_URL | Currently points to `https://consentshield-one.vercel.app`. Revisit if a custom domain is added. |

---

## Known Bugs (Outstanding)

1. **Signup bootstrap 401 when email confirmation is ON.**
   Flow: `/signup` calls `supabase.auth.signUp` (session=null because confirm required) → browser fetches `/api/auth/signup` with no cookie → `auth.getUser()` returns null → route returns 401 → org never gets created. Quick fix: disable "Confirm email" in dev. Proper fix (deferred): stash `orgName` / `industry` in `options.data` on signUp, move the RPC call into an auth-state listener triggered after email-confirmation redirect. Until fixed, accounts can only be created by operator-provisioned SQL or with confirm-email off.

---

## Most Recent Work (2026-04-14 / 15)

Commits, newest last:

```
ac8b2de docs: deferred-items analysis — schedule S-1/S-5/S-11 into ADR-0010/0011/0012
d619c29 chore: deployment fixups after hosted-Supabase + pooler constraints
adcc184 fix: should-fix batch from 2026-04-14 review (S-3, S-6, S-7, S-10, S-12)
da0d168 feat(ADR-0009): complete B-4 — zero service-role usage in app code
d50b98b fix: close B-5, B-7, B-8, B-9 from 2026-04-14 review
b21b0dc feat(ADR-0009): sprint 1.1 — scoped-role RPCs for public buffer writes (B-4 partial, B-6)
788c63c feat(ADR-0008): phase 1 — browser auth hardening (B-1, B-2, B-3)
dc6b2c3 docs: refresh .env.local.example for Vercel + ADR-0008/0009 reality
266d885 fix: scoped roles need BYPASSRLS + auth schema usage for security-definer RPCs
fcb0de4 feat: test-sites — 5 static demo customer pages for ConsentShield
90cfd5d feat: root page is now a real landing with signup/login + demo-sites link
```

---

## Where to Pick Up Next

Two tracks, pick whichever matches your next session:

- **Unblock signup properly** — implement the `options.data` metadata path so signup works with "Confirm email" ON. Touches `(public)/signup/page.tsx` and adds an auth-state handler client component that fires the bootstrap RPC after confirmation. Estimated 2–3 h.
- **Start ADR-0010 / 0011 / 0012** — any of the three can be picked up independently (`docs/reviews/2026-04-15-deferred-items-analysis.md` has effort estimates). ADR-0012 Sprint 1 (SLA-timer property tests) is the smallest useful bite.

Until signup is unblocked, the live demo flow depends on manually inserted users (the two existing admins for `Estara-ai` / `Estara-ai` orgs) or SQL-provisioned test accounts. The demo site tour (banner → consent event → observation) works today without any login.
