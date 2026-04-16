# Session Handoff

**Last Updated:** 2026-04-16

## Current State

**10 ADRs complete** (0001–0009 + 0013). **ADRs 0010/0011/0012/0014–0018 proposed** in `docs/ROADMAP-phase2.md`.

| ADR | Status |
|-----|--------|
| 0001 Project Scaffolding | Completed |
| 0002 Worker HMAC + Origin + Secret Rotation | Completed |
| 0003 Banner Builder + Dashboard + Inventory + Privacy Notice | Completed |
| 0004 Rights Request Workflow (Turnstile + OTP + SLA) | Completed |
| 0005 Tracker Monitoring (banner v2 + 34 signatures) | Completed |
| 0006 Razorpay Billing + Plan Gating | Completed |
| 0007 Deletion Orchestration (webhook protocol) | Completed |
| 0008 Browser Auth Hardening (no client secret, origin_verified, fail-fast Turnstile) | Completed |
| 0009 Scoped-Role Enforcement in REST Paths (zero service_role_key in app) | Completed |
| 0013 Signup Bootstrap Hardening (OTP-only signup + login) | Completed |

## Live Deployments

- **Admin app:** `https://consentshield-one.vercel.app` (Vercel project `consentshield`)
- **Demo customer sites:** `https://consentshield-demo.vercel.app` (Vercel project `consentshield-demo`, root `test-sites/`)
- **Worker CDN:** `https://cdn.consentshield.in/v1/*` (version `9fb7bd37`)
- **Supabase:** `xlqiakmkdjycfiioslgs` (ap-northeast-1 pooler)
- **SLA Edge Fn:** deployed (reads `CS_ORCHESTRATOR_ROLE_KEY`)
- **pg_cron:** 6 jobs active (keys read from Supabase Vault)

## Git State

Latest commit: `28523d8` — `fix: public.current_uid() helper replaces auth.uid() in scoped-role RPCs`

## Where to Pick Up

`docs/ROADMAP-phase2.md` enumerates Sprints 1–11. **Sprint 1 is done.**

**Next session → Sprint 2:** ADR-0010 distributed rate limiter on Vercel KV (or Upstash Redis via Vercel Marketplace — Vercel KV is no longer offered as of 2025). ~3 hours. Replaces the in-memory `Map` in `src/lib/rights/rate-limit.ts`.

**Alternative smallest bite:** Sprint 3 (ADR-0012 Sprint 1) — SLA-timer property tests + the S-2 URL-path RLS test. Self-contained, no new deps.

## Known Outstanding

- Vercel Deployment Protection is off on both projects — fine for dev, revisit before any real traffic.
- Turnstile production keys + Razorpay live keys still pending external-service activation (ADR-0014).

### Closed 2026-04-16

- Stale `anegondhi@gmail.com` auth user removed via psql.
- Migration `20260414000010` no-op `grant usage on schema auth` commented out with explanation (`2404833`).
- Password reset + email change OTP template HTML documented in `reference_email_deliverability.md` memory — paste into Supabase Dashboard before enabling those flows.

## Reference Docs

- `docs/STATUS.md` — high-level state snapshot
- `docs/ROADMAP-phase2.md` — Sprints 1–11 with deliverables
- `docs/reviews/2026-04-14-codebase-architecture-review.md` — blockers closed
- `docs/reviews/2026-04-15-deferred-items-analysis.md` — deferred items scoped
- `docs/ADRs/ADR-0013-signup-bootstrap-hardening.md` — OTP signup decision + test results
- `session-context/context-2026-04-15-22-02-12.md` — full session dump
