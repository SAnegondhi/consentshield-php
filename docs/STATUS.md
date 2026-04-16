# ConsentShield Status

(c) 2026 Sudhindra Anegondhi a.d.sudhindra@gmail.com

**Snapshot date:** 2026-04-16
**Branch:** main
**Latest commit:** `c83831e` — feat(ADR-0018): pre-built connectors — Mailchimp + HubSpot direct API

---

## Summary

**Phase 2 of `docs/ROADMAP-phase2.md` is COMPLETE.** All 18 ADRs
(0001–0018) are Completed. All 11 Phase-2 sprints shipped in the
2026-04-16 execution session: distributed rate limiter (ADR-0010),
deletion retry (ADR-0011), full automated test suite — workflows /
worker / buffer (ADR-0012), OTP-only signup (ADR-0013), external
service activation — Resend / Turnstile / Razorpay (ADR-0014),
security posture scanner (ADR-0015), consent probes v1 (ADR-0016),
audit export Phase 1 (ADR-0017), pre-built deletion connectors
Mailchimp + HubSpot (ADR-0018). Test suite grew **39 → 86**.

The 2026-04-14 codebase review's 9 blocking + 13 should-fix items are
all closed (some via ADR-0010/0011/0012 per
`docs/reviews/2026-04-15-deferred-items-analysis.md`). The
`docs/reviews/2026-04-16-phase2-completion-review.md` re-audit is the
authoritative gap list.

The Next.js app is deployed to Vercel at
`consentshield-one.vercel.app`, five static demo customer sites at
`consentshield-demo.vercel.app`, the Worker at `cdn.consentshield.in`,
and four Edge Functions in Supabase. No known blocking bugs. Eleven
consciously-deferred items live in `docs/V2-BACKLOG.md`.

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
| 0010 | Distributed rate limiter (Upstash via Vercel Marketplace) | Completed |
| 0011 | Deletion retry / timeout Edge Function | Completed |
| 0012 | Automated test suites (worker / buffer / workflows) | Completed |
| 0013 | Signup bootstrap hardening (OTP-only) | Completed |
| 0014 | External service activation (Resend / Turnstile / Razorpay) | Completed |
| 0015 | Security posture scanner (run-security-scans + dashboard) | Completed |
| 0016 | Consent probes v1 (run-consent-probes — static HTML analysis; headless v2 → V2-P1) | Completed |
| 0017 | Audit export package Phase 1 (direct-download ZIP; R2 upload → V2-X3) | Completed |
| 0018 | Pre-built deletion connectors (Mailchimp + HubSpot direct API; OAuth → V2-C1) | Completed |

`docs/ROADMAP-phase2.md` (11 sprints, ADR-0010 through ADR-0018) is
fully shipped. Next: post-Phase-2 review picks 2–3 items from
`docs/V2-BACKLOG.md` to graduate into Phase-3 ADRs.

---

## Deployments Live

| Component | URL / identifier |
|-----------|------------------|
| Admin app (Next.js on Vercel) | `https://consentshield-one.vercel.app` |
| Demo customer sites (Vercel) | `https://consentshield-demo.vercel.app` (5 scenarios: ecommerce, saas, blog, healthtech, violator) |
| Cloudflare Worker CDN | `https://cdn.consentshield.in/v1/*` (Worker version `9fb7bd37`) |
| Supabase project | `xlqiakmkdjycfiioslgs` |
| SLA Edge Function | `send-sla-reminders` deployed; reads `CS_ORCHESTRATOR_ROLE_KEY` (CS_ prefix because Supabase reserves SUPABASE_) |
| pg_cron jobs | 6 active, all green: `buffer-sweep-15min` + `cleanup-unverified-rights-requests-daily` (pure SQL), `sla-reminders-daily` + `check-stuck-deletions-hourly` + `security-scan-nightly` + `consent-probes-hourly` (HTTP via `net.http_post`, Edge Functions deployed with `--no-verify-jwt`). Two orphan jobs (`stuck-buffer-detection-hourly`, `retention-check-daily`) remain unscheduled — their target Edge Functions haven't been built; they will be re-registered when Phase-3 ops features ship. |
| GitHub repo | `github.com/SAnegondhi/consentshield` |

---

## Database State

- **32 operational tables** + `webhook_events_processed`. All with RLS enabled.
- **Scoped roles** (`cs_worker`, `cs_delivery`, `cs_orchestrator`) are the runtime principals. Every mutating code path routes through a security-definer RPC owned by `cs_orchestrator` (or `cs_delivery`), granted to `anon` or `authenticated` per endpoint. `grep -r SUPABASE_SERVICE_ROLE_KEY src/` returns zero matches.
- `cs_orchestrator` / `cs_delivery` carry `BYPASSRLS` so security-definer calls can read org-scoped tables inside their own function bodies. They do **not** have USAGE on schema `auth` (hosted Supabase forbids it); RPCs that need the caller's user id use the `public.current_uid()` helper from `20260415000001`.
- **Demo org** seeded: `ConsentShield Demo Customer` (`432bca6d-8fce-415a-85e0-96397ddac666`) with 5 web properties + 5 banners matching the Vercel demo site routes.
- Test suite: **86 / 86 passing** on every build (39 RLS isolation + 5 URL-path RLS + 4 rate-limit fallback + 7 SLA-timer + 10 Worker events + 4 Worker banner + 6 buffer delivery + 6 buffer lifecycle + 5 Mailchimp/HubSpot dispatch). Live Supabase round trips where the test requires it; Worker tests run entirely in Miniflare with mocked outbound Supabase.
- **27 migrations applied**, through `20260416000007_audit_export.sql`.

---

## Pending Manual Setup

| Item | Action required |
|------|-----------------|
| Supabase email templates (password reset, email change) | Stock templates still use click-through links. Paste the OTP-form HTML from `docs/ops/supabase-auth-templates.md` before enabling those flows. "Confirm signup" and "Magic Link" templates are already OTP-ready. |
| Resend domain verification | `consentshield.in` verified; relaxed-alignment DMARC live; deliverability confirmed to Gmail. |
| Turnstile production keys | Live. Real site + secret keys deployed to Vercel Production; verified via live fake-token rejection. Preview env vars not set (new CLI requires per-branch targeting — see ADR-0014). |
| Razorpay account | Live in test mode. Seven env vars set on Vercel Production. End-to-end checkout UX smoke with a test card still pending — infrastructure is all in place. |
| Vercel Deployment Protection | Off on both projects for dev; revisit before any real traffic. |
| NEXT_PUBLIC_APP_URL | Currently points to `https://consentshield-one.vercel.app`. Revisit if a custom domain is added. |

---

## Known Bugs (Outstanding)

None blocking. Signup + login + dashboard property creation verified end-to-end on 2026-04-15.

## V2 / post-Phase-2 backlog

See `docs/V2-BACKLOG.md`. Items consciously deferred from Phase-2
sprints (headless-browser probe runner, signup idempotency regression
test, unbuilt Edge Function stubs, Vercel Preview env vars, etc.)
live there. Do not pull from it mid-phase; a dedicated review after
Phase 2 closes will pick 2–3 to graduate into follow-up ADRs.

---

## Most Recent Work (2026-04-16 marathon — Phase 2 close-out)

Commits from the Phase-2 execution session, newest first:

```
c83831e feat(ADR-0018): pre-built connectors — Mailchimp + HubSpot direct API
2204367 feat(ADR-0017): audit export package — Phase 1 direct-download ZIP
293659f docs(CLAUDE.md): record v2-backlog rule alongside ADR workflow
d9372da docs: consolidate deferred-item backlog into docs/V2-BACKLOG.md
8819732 feat(ADR-0016): consent probes v1 — static HTML analysis
b0106d5 feat(ADR-0015): security posture scanner — headers + TLS nightly
9d7085d feat(ADR-0014): completed — Turnstile + Razorpay live on production
3e1457e feat(ADR-0014): remove Resend onboarding@resend.dev fallback
52199c5 feat(ADR-0012): sprint 3 — buffer-pipeline + lifecycle REVOKE tests
8dee427 docs(ADR-0013): close open items — ops runbook + stale status cleanup
7e72e6f feat(ADR-0012): sprint 2 — Worker test harness with Miniflare
05ec7fc chore(ops): fix cron jobs — redeploy sla-reminders, unschedule orphans
649d5dd feat(ADR-0011): sprint 1 — deletion retry + timeout for stuck callbacks
67c1f7d docs: log ADR-0012 Sprint 1 — index, CHANGELOG-schema, STATUS
1dfaafc feat(ADR-0012): sprint 1 — SLA-timer + URL-path RLS test coverage
23fc160 feat(ADR-0010): sprint 1.1 completed — Upstash live, ADR closed
b3b596f docs: log ADR-0010 Sprint 1.1 — index, CHANGELOG-api, STATUS
599e169 feat(ADR-0010): sprint 1.1 — distributed rate limiter via Upstash Redis
0404b67 docs: refresh STATUS.md to the 2026-04-16 pause point
b38862b docs: log loose-end cleanup (migration 20260414000010 + stale auth user)
2404833 chore: remove no-op grant usage on auth schema from migration 20260414000010
```

Earlier 2026-04-14/15 commits (Phase 1 close-out and ADR-0008/0009/0013
groundwork) are preserved in `git log`.

---

## Where to Pick Up Next

Phase 2 is closed. The natural next step is the **post-Phase-2
review**:

1. Walk the existing code end-to-end (start with the
   `2026-04-16-phase2-completion-review.md` gap report).
2. Pick **2–3 architecture decision points** from
   `docs/V2-BACKLOG.md` to graduate into Phase-3 ADRs.
3. Down-grade or close the rest.

Out-of-phase Phase-3+ headlines (per the Phase-2 roadmap "Out of
scope"):

- Continuous buffer-delivery-to-R2 pipeline (prerequisite for
  ADR-0017's Phase 2 R2 upload flow — V2-X3).
- GDPR dual-framework (multi-sprint, schema-wide).
- ABDM healthcare module (never persists FHIR per rule #3).
