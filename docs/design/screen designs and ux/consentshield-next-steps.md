# ConsentShield — Next Steps & Strategic Decisions

*Decision log · April 2026*

---

## Next Steps — Priority Order

The following are the logical next moves in roughly the order that unblocks what comes after.

**1. Screen designs and UX flows** ✅ — Web app wireframes for the five core screens: Dashboard, Consent Manager, Data Inventory, Rights Centre, Audit & Reports. Completed April 2026.

**2. Mobile app UX wireframes** ✅ — Three flows: rights request monitor (founder ICP), breach trigger, and clinic patient consent + ABHA scan (Month 6+). Completed April 2026.

**3. Technical architecture document** — database schema, API design, the consent banner Cloudflare Worker spec, and the multi-tenant data isolation rules. Built on the finalised stack: Next.js + Supabase (Auth + Postgres + Edge Functions) + Cloudflare Workers + Resend + Razorpay + Vercel. This is the build guide.

**4. Landing page copy** — the waitlist page that goes live in Week 3. Headline, subheadline, the three-bullet value prop, and the email capture. The first thing potential customers will see. Can be published before the product exists.

**5. The DPDP compliance checklist** — the lead magnet itself. A 47-point self-assessment that gets gated behind an email. The #1 acquisition asset for Month 1. Drives traffic to the landing page and can be seeded in SaaSBoomi Slack, LinkedIn, and CA firm networks independently of the product being live.

**6. Customer discovery guide** — deferred until after the MVP is live. See decision below.

---

## Decision: Defer Customer Discovery Until After MVP

**Decision:** Customer discovery conversations with potential buyers will be deferred until the MVP is ready and live.

**Rationale:** Pre-MVP discovery conversations carry a real competitive risk in the Hyderabad SaaS ecosystem, which is tight-knit and well-networked. A founder hearing the pitch in a "discovery conversation" today could plausibly be in market before ConsentShield is. Discussing the product before it is ready is not just premature — it is potentially giving a detailed roadmap to the very people capable of executing on it quickly.

---

## The Honest Tension — and Why It Holds

Skipping discovery carries a classic risk: building something nobody pays for. The standard mitigation is pre-launch validation. In this case, however, that mitigation is less necessary than usual for a specific reason:

**DPDP compliance is externally mandated, not optionally chosen.** The law creates the demand. Enforcement is on a published timeline with a hard date of 13 May 2027 and penalties reaching ₹250 crore per violation. This is not a product solving a problem people might or might not feel they have — it is a product solving a problem every company processing Indian user data is legally required to solve. The demand does not need to be discovered or created. It needs to be captured.

This reduces the discovery risk significantly compared to a product solving an optional or speculative problem. The adjusted logic holds: **the law creates the demand, you just need to be first with the right solution.**

---

## Decision: Drop Drizzle, Go Supabase-Native

**Decision:** Drizzle ORM will not be used. The stack will use Supabase's native tooling throughout.

**Rationale:** Supabase already covers everything Drizzle provides:

- **Schema and migrations** — managed via Supabase CLI (`supabase db push`) and migration files
- **Query building** — `@supabase/supabase-js` client with auto-generated TypeScript types (`supabase gen types typescript`)
- **Row-Level Security** — defined directly in Postgres, not in the ORM layer; Drizzle adds nothing here
- **Edge Functions** — Supabase Edge Functions run on Deno; Drizzle cannot run in that runtime, so the Supabase client is required regardless
- **Realtime** — Supabase realtime subscriptions are client-only; Drizzle has no role

Drizzle adds value for complex relational queries or schema-as-code workflows at scale. At this stage it is overhead without benefit.

---

## Decision: Drop Clerk, Use Supabase Auth

**Decision:** Clerk will not be used. Authentication will be handled entirely by Supabase Auth.

**Rationale:** Supabase Auth is a complete authentication system within the same Postgres instance as the application data. This has one decisive advantage over Clerk: Row-Level Security policies can reference `auth.uid()` and JWT claims directly, meaning multi-tenant data isolation is enforced at the database level automatically on every query — with no translation layer between Clerk's JWT and Supabase's JWT.

With Clerk, every request would require passing org context from Clerk's JWT into Supabase's JWT, an extra step that adds complexity and a potential security gap. With Supabase Auth, the policy is simply:

```sql
create policy "org members only"
on consent_events
using (org_id = auth.jwt() ->> 'org_id');
```

The only capability lost is Clerk's pre-built UI components. Those are a single day's work in shadcn/ui, not a reason to add a paid third-party auth service.

Supabase Auth provides: email/password, magic link, Google OAuth, OTP — all built in, all tied natively to RLS.

---

## Decision: Consent Banner Delivery via Cloudflare Workers

**Decision:** The consent banner JS snippet (`cdn.consentshield.in/v1/banner.js`) will be delivered and served via a Cloudflare Worker, not via Vercel Edge Functions or a standard CDN.

**Rationale:** The consent banner is loaded on every page of every customer's website. It is the most latency-sensitive asset in the product — a slow banner blocks the page and destroys the user experience. Cloudflare's edge network has points of presence across India that Vercel's edge does not match for Indian-origin traffic.

The Cloudflare Worker does three things:

- Serves `banner.js` from the edge with aggressive caching, keyed by `org_id` and banner version
- Accepts consent event `POST` requests at the edge and forwards them to Supabase, eliminating a round-trip to the Next.js origin for every consent action
- Handles banner configuration reads from a Cloudflare KV store, so banner script responses are served without hitting the database

This keeps the banner fast for end users, keeps latency off the Next.js/Supabase origin, and separates the high-frequency consent event ingestion path from the low-frequency application API path.

---

## Finalised Year 1 Stack

| Layer | Technology | Role |
|---|---|---|
| Frontend | Next.js 14 + TypeScript + Tailwind + shadcn/ui | Web app |
| Auth | Supabase Auth | Email, OAuth, magic link — native RLS integration |
| Database | Supabase Postgres | All application data, RLS-enforced multi-tenancy |
| Edge Functions | Supabase Edge Functions (Deno) | Webhooks, background jobs, integrations |
| Banner delivery | Cloudflare Workers + KV | `cdn.consentshield.in` — edge-served JS + consent event ingestion |
| Email | Resend | Transactional: rights request alerts, SLA reminders, breach notifications |
| Billing | Razorpay Subscriptions | INR subscriptions, auto-renewal, webhook-driven plan changes |
| Hosting | Vercel | Next.js app deployment |
| Monitoring | Sentry + Vercel Analytics | Error tracking, performance |

---

## Decision: Mobile App Deferred to Month 6+

**Decision:** No mobile app development until the clinic segment is confirmed. Mobile UX flows will not be built until ABDM pilot commitments are received in writing.

**Rationale:** The primary ICP for the first 6 months is the SaaS founder and CTO segment. This segment is desk-bound, technically literate, and will set up and use ConsentShield entirely from a laptop. A mobile app does not affect their purchase decision and does not unblock the build.

Mobile becomes relevant only when the clinic segment arrives — which the master doc places at Month 6, and which is itself gated on the ABDM bundle being confirmed by 3 clinic pilots committing to a paid engagement. Building mobile before that confirmation is the same mistake as building the ABDM features before clinics commit: code before sales.

The mobile app's scope and UX flows are fully documented and ready to build when the trigger condition is met.

---

*Document prepared April 2026. Stack decisions are final for Year 1. Re-evaluate at ₹3L MRR or 80+ customers, whichever comes first.*

---

## Addendum — 2026-04-16 (architecture has moved on)

This document records the strategic decisions taken in early April 2026 and was correct at that time. Since then the architecture has evolved substantially — most importantly, the **DEPA artefact model** was merged into the source-of-truth architecture docs on 2026-04-16 (commit `9d1d05b`). The "✅ Completed April 2026" marks against items 1 and 2 (web screens and mobile UX) at the top of this file remain accurate as a historical record of when those wireframes were drafted, but they should not be read as "complete in absolute terms" — both files have since been amended (web) or annotated with deferred drift items (mobile) to reflect the DEPA architecture.

**What changed since this doc was written:**

- **DEPA artefact model** — per-purpose `consent_artefacts` rows replace the pre-existing `purposes_accepted[]` array on `consent_events`. New tables: `purpose_definitions`, `purpose_connector_mappings`, `consent_artefacts`, `artefact_revocations`, `consent_expiry_queue`, `depa_compliance_metrics`.
- **Two new non-negotiable rules** — Rule 19 (consent artefacts append-only) and Rule 20 (every artefact has explicit `expires_at`).
- **Rule 3 broadened** from FHIR-only to all regulated sensitive content (FHIR + banking identifiers + future sectors).
- **9 new authenticated API routes + 5 new Compliance API routes** for DEPA primitives.
- **Phase 2 closed** — 18 ADRs Completed; the DEPA roadmap (ADR-0019+) is the next chapter.
- **Stack item update** — `Next.js 14` in the table above is now `Next.js 16` (App Router, proxy.ts middleware, Cache Components). The other rows (Supabase, Cloudflare, Resend, Razorpay, Vercel) are unchanged.

**What this means for these wireframes:**

The web screens (`consentshield-screens.html`) have been amended in the same 2026-04-16 pass to reflect the DEPA model — see `ARCHITECTURE-ALIGNMENT-2026-04-16.md` in this folder for the per-screen diff (W1 sidebar, W2 artefacts panel, W3 purposes panel, W4 banner→definition binding, W5 DEPA score gauge, W6 artefact lifecycle tile, W7 artefact-scoped erasure, W8 audit DEPA section, W9 onboarding seed pack, W10 settings sector template, W11 banner save 422, W12 worker pipeline tile).

The mobile wireframes (`consentshield-mobile.html`) carry three open drift items (M1, M2, M3) documented in the alignment doc but deferred to their respective ADRs.

**The decisions above remain valid.** Drizzle still not used. Clerk still not used. Cloudflare Workers still serve the banner. Mobile is still deferred until ABDM clinic pilots commit. The strategic posture is unchanged. What has expanded is the *data model* the screens express — and by extension, what the screens must show.

*Addendum prepared 2026-04-16 alongside the DEPA architecture merge.*

