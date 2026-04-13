# ConsentShield — Next Steps & Strategic Decisions

*Decision log · April 2026*

---

## Next Steps — Priority Order

The following are the logical next moves in roughly the order that unblocks what comes after.

**1. Customer discovery guide** — the most urgent real-world action. The master doc says "talk to 20 founders before writing a line of code." This would produce the exact script, the listening framework, and the decision criteria (3 out of 10 say yes → build, fewer → iterate). This unblocks everything else.

**2. Screen designs and UX flows** — the master doc describes the key screens in text. Turning those into actual wireframes (Dashboard, Consent Builder, Rights Centre, Audit & Reports) gives you something concrete to put in front of discovery conversations and to hand to a designer or start building against.

**3. Mobile app UX flows** — given the platform analysis, the mobile app's scope is now well-defined. Mapping out the exact flows for the three things mobile does (compliance glance, rights request notification → action, clinic patient consent + ABHA scan) would be a natural next document.

**4. Technical architecture document** — database schema, API design, the consent banner JS snippet spec, and the multi-tenant data isolation rules. The master doc covers this at a high level; a proper technical spec would be the build guide.

**5. Landing page copy** — the waitlist page that goes live in Week 3. Headline, subheadline, the three-bullet value prop, and the email capture. This is the first thing potential customers will see.

**6. The DPDP compliance checklist** — the lead magnet itself. A 47-point self-assessment that gets gated behind an email. This is the #1 acquisition asset for Month 1 and something that can be published before the product exists.

---

## Decision: Stateless Oracle Model — ConsentShield Holds No User Data

**Decision:** ConsentShield's database is an operational state store, not a compliance record store. User data (consent events, audit log entries, processing log entries, rights request personal data) is held in buffer tables only for the duration of delivery to customer-owned storage, then hard-deleted. The canonical compliance record lives in customer storage at all times.

**Storage default:** Cloudflare R2 for ConsentShield-provisioned buckets (Standard mode). No egress fees, same Cloudflare account as Workers, simpler IAM than AWS. S3 available for BYOS customers with existing AWS infrastructure. S3 + AWS KMS for regulated enterprise customers requiring verifiable CMK.

**Three processing modes:**
- **Standard** — ConsentShield provisions R2 bucket, generates encryption key, delivers it to customer once and discards it. Default for non-technical customers.
- **Insulated** — Customer brings their own storage endpoint. ConsentShield holds write-only credentials. Customer holds all encryption keys.
- **Zero-Storage** — Data flows through in memory only (for health, financial, legal data). Consent metadata is the only durable write; it is delivered to customer storage and deleted from ConsentShield systems after confirmed delivery.

**Full specification:** `consentshield-stateless-oracle-architecture.md`

**Documents updated by this decision:**
- `consentshield-technical-architecture.md` — DB schema restructured; buffer tables annotated; security rules 4, 8, 9, 10 added/updated; new Edge Functions added; R2 env vars added
- `consentshield-critical-examination.md` — Section 8 "data hostage" corrected; Section 15 added
- `abdm-scope-data-architecture.md` — Section 6 updated to note export model is now a platform primitive; R2 default confirmed

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

## Revised Priority: Technical Architecture First

Given the decision to defer discovery, the most useful immediate next step is the **technical architecture document** — because that is what actually unblocks the build. Everything else (screen designs, landing page, lead magnet) is useful but does not block starting development.

The technical architecture document should cover:

- **Database schema** — multi-tenant structure, consent events table (append-only), audit log schema, processing log, data isolation rules
- **API design** — the consent banner JS snippet, the POST endpoint for consent events, the webhook event system (consent_given, consent_withdrawn, purpose_updated, banner_dismissed)
- **Onboarding flow** — from signup to first consent collected, in enough detail to build against
- **Infrastructure wiring** — how Vercel, Supabase, Clerk, Resend, and Razorpay connect and hand off to each other

Screen designs and landing page copy are next in sequence but do not need to be complete before the first line of code is written.

---

*Document prepared April 2026.*
