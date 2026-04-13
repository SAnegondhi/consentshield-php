ConsentShield — Master Design Document		Version 1.1  ·  April 2026  ·  CONFIDENTIAL

**CONFIDENTIAL — INTERNAL MASTER DOCUMENT**

**ConsentShield**

*India’s DPDP Compliance Operating System for Digital-First Businesses*

**MASTER DESIGN DOCUMENT**

Marketing · Product Positioning · App Design Blueprint

Version 1.1  ·  April 2026  (Updated from v1.0 following design review)

Hyderabad, India

| **What changed in v1.1** This version incorporates decisions from the April 2026 design review. Changes are marked [RESOLVED] or [UPDATED] throughout. Key updates: auth stack confirmed as Supabase Auth; breach notification upgraded to full guided workflow; GDPR added as Phase 3; lead magnet upgraded to scored gap assessment with email gate; enforcement delay risk elevated; CA partner revenue clarified as net of 30% share; primary positioning shifted to future-proofing over fear; workflow engine architecture decision recorded. |
| --- |

# **1. Executive Summary**

| ConsentShield is a B2B SaaS product that transforms DPDP Act compliance from a legal burden into an operational system — giving Indian startups, SaaS companies, and healthcare businesses the tools to achieve, demonstrate, and maintain compliance automatically. |
| --- |

## **The Opportunity in One Paragraph**

India’s Digital Personal Data Protection (DPDP) Rules were notified on 13 November 2025. The full penalty and rights architecture becomes enforceable on 13 May 2027. A single breach can expose a company to cumulative penalties of ₹650 crore across multiple violation categories. Every company processing Indian user data — from a 5-person SaaS startup to a 500-bed hospital — now needs a compliant consent system, a data inventory, a rights-management workflow, and an audit trail. No India-native SaaS product owns this space. The window to capture it is approximately 12 months before large GRC incumbents enter.

## **Product Vision**

| Core Promise: ConsentShield provides the compliance infrastructure that lets any Indian digital business achieve, demonstrate, and maintain DPDP compliance — deployable in 48 hours, without a 3-month legal engagement. ConsentShield is tooling that augments legal advice; it does not replace it. All templates carry prominent disclaimers. The DPO-as-a-Service partner at Enterprise tier carries legal liability; ConsentShield carries software liability. |
| --- |

**[UPDATED: Positioning nuance]  **Previous versions stated "compliance in a day, not a quarter." While directionally correct, this framing risks customers believing the product alone constitutes full legal compliance. The revised framing positions ConsentShield as infrastructure — the operational layer that makes legal compliance achievable and demonstrable, not a substitute for legal counsel.

## **Key Financial Targets (24 Months)**

| **Milestone** | **Target MRR** | **Customer Count** | **Key Driver** |
| --- | --- | --- | --- |
| Month 3 | ₹15,000 | 5 customers | Direct outreach, SaaSBoomi network |
| Month 6 | ₹1,00,000 | 25 customers | Gap assessment inbound + community |
| Month 12 | ₹4,00,000 | 80 customers | CA partner channel + healthcare bundle |
| Month 24 | ₹12,00,000 | 200+ customers | DPDP + GDPR + ABDM multi-vertical |

# **2. Market Opportunity**

## **The DPDP Enforcement Timeline**

Three dates define the compliance urgency curve. All sales conversations in 2026 should be anchored to these:

| **Date** | **Event** | **Impact on Buyers** |
| --- | --- | --- |
| 13 Nov 2025 | DPDP Rules notified. Data Protection Board established. | Legal obligation confirmed. Planning mode begins. |
| 13 Nov 2026 | Consent Manager framework becomes operational. Registration opens. | Companies must have a registered Consent Manager or use one. |
| 13 May 2027 | Full enforcement: processing obligations, rights architecture, and penalties. | ₹250 crore per violation. Cumulative exposure up to ₹650 crore. |

## **Total Addressable Market**

The immediate TAM is every company in India that processes personal data of Indian users — estimated at 400,000+ businesses. The serviceable addressable market for a solo-dev SaaS in 2026 is:

| **Indian SaaS Startups** | ~15,000 active startups. Technically sophisticated, self-serve buyers. Highest urgency because their product IS the data-processing mechanism. |
| --- | --- |
| Edtech Platforms | ~3,000 platforms. Children’s data provisions under DPDP are the strictest — separate consent, no behavioural advertising, highest penalty multiplier. |
| D2C E-commerce | ~25,000 brands. Large user databases, cookie-based marketing, email lists — all immediately regulated. Penalty risk is proportional to user base. |
| HR Tech Platforms | ~2,000 platforms. Employee data has explicit obligations around purpose limitation and retention. |
| Independent Clinics | 438,000 ABDM-registered facilities. Health data attracts the highest penalty tier. The DPDP + ABDM bundle is the premium play. |

## **Competitive Landscape**

| **Competitor** | **Type** | **Gap / Why ConsentShield Wins** |
| --- | --- | --- |
| OneTrust | US GRC Platform | Costs $50,000+/year. Built for GDPR. No India-specific templates, no DPDP-specific consent artefacts. |
| Scrut.io | Indian GRC (SOC 2) | Focused on SOC 2 / ISO 27001 audit prep. No DPDP module as of April 2026. |
| Sprinto | Indian GRC (compliance automation) | SOC 2 / ISO 27001 focused. No DPDP-native consent or rights management module. |
| Zoho Compliance | Suite add-on (rumoured) | Not shipped. Even if shipped, a generic add-on in a 50-product suite cannot position as a DPDP specialist. |
| CookieYes / Cookiebot | Cookie consent tools | GDPR-native. India market presence but no DPDP-specific consent artefacts or rights workflows. |
| ClearTax | Tax & compliance SaaS | Strong in GST. No personal data compliance product. Different buyer (CFO vs CTO). |
| Law Firms | Manual legal advisory | ₹5–25 lakh per engagement. One-time document, not a living system. No operational tooling. |

| **12-Month Window: Every conversation with a buyer who says ‘we’re evaluating options’ is a conversation you need to win before Zoho, Tata Consultancy, or a well-funded GDPR tool clones this for India. The window is real and finite. Competitive analysis must be updated quarterly — especially Scrut, Sprinto, and Zoho.** |
| --- |

# **3. Product Positioning**

## **Positioning Statement**

| For Indian SaaS founders and healthcare operators who are overwhelmed by DPDP legal complexity and exposed to enforcement risk, ConsentShield is a compliance operating system that automates consent collection, data inventory, rights management, and audit trails under the DPDP Act 2023. Unlike OneTrust (too expensive, built for GDPR) or law firms (one-time documents, no operational tooling), ConsentShield is built specifically for India, deployable in 48 hours, and priced for growth-stage companies. |
| --- |

## **Primary Messaging Hierarchy**

Two messaging tracks operate simultaneously. The primary track is used in all outbound communications:

| **Track** | **Message** | **When to Use** |
| --- | --- | --- |
| Primary — Future-Proofing | A company that builds compliance infrastructure now is not losing anything. DPDP is notified law. The question is not if but when. ConsentShield is the operating layer that makes compliance automatic and demonstrable. | All marketing, content, onboarding, and partner materials |
| Secondary — Enforcement Urgency | 13 May 2027. ₹250 crore per violation. The DPB is operational now. Companies in planning mode today will be the ones with working compliance when enforcement begins. | Landing page urgency section, direct sales conversations |

**[UPDATED: Messaging shift]  **v1.0 led with enforcement fear as the primary message. v1.1 elevates future-proofing as primary. Fear-based urgency is retained as a secondary message. This change makes the product defensible if enforcement is delayed beyond May 2027, and appeals to founders who respond better to prudence than to threat.

## **Brand Pillars**

| **India-First** | Every template, every consent artefact, every workflow is written for the DPDP Act — not adapted from GDPR. Indian legal language, Indian enforcement timelines, Indian penalty structure. |
| --- | --- |
| Operational | Not a document generator. A living compliance system that runs alongside your product — generating audit logs, tracking consent changes, and alerting you to data subject rights requests. |
| Infrastructure, Not Advice | ConsentShield provides the operational layer. Legal advice remains the domain of your counsel or a DPO-as-a-Service partner. Every template carries a prominent disclaimer to this effect. |
| Developer-Friendly | JS snippet, REST API, webhook events. A CTO can integrate the consent banner in 20 minutes. No vendor lock-in on the core infrastructure. |
| Affordable | Priced for Indian growth-stage companies. Starting at ₹2,999/month — less than a single hour of a senior law firm partner’s time. |
| Expanding Moat | Every month of data stored — consent logs, audit trails, DPDP records — raises the switching cost. After 12 months on ConsentShield, leaving means losing legally-required retention records. |

## **Key Messages by Audience**

| **Audience** | **Their Fear** | **Your Message** |
| --- | --- | --- |
| SaaS Founder / CTO | A complaint triggers a ₹250 crore notice from the Data Protection Board. | Deploy in 48 hours. First consent collected. First audit log written. The infrastructure is in place. |
| Legal / Compliance Head | Manual tracking in spreadsheets won’t survive a DPB audit. | ConsentShield is your audit-ready, exportable evidence trail — always current, never a spreadsheet. |
| Edtech Founder | Children’s data provisions are the harshest — one violation and the brand is destroyed. | ConsentShield’s Edtech tier has age-gating, separate parental consent flows, and no ad-tracking by design. |
| Clinic Owner / Doctor | Patient health records under ABDM are also covered by DPDP — two compliance obligations, one product. | ConsentShield for Clinics handles ABDM consent and DPDP compliance from a single dashboard. |
| CA / Legal Partner | My clients ask me about DPDP and I don’t have a tool to give them. | White-label ConsentShield under your firm’s brand. Your clients get tooling. You get a referral stream. |

# **4. Product Features ****&**** Roadmap**

## **Phase 1 — MVP (Months 1–2): The Compliance Starter Kit**

Goal: Get first 5 paying customers. The product must be fully usable without a sales call. Everything deployable from a self-serve dashboard.

| **Consent Banner Builder** | Drag-and-drop no-code builder for DPDP-compliant consent banners. Generates a CDN-hosted JS snippet. Supports granular purpose consent (marketing, analytics, personalisation). Stores consent timestamps server-side. |
| --- | --- |
| Privacy Notice Generator | Guided wizard produces a plain-language, legally-structured privacy notice. Outputs a hosted page and downloadable PDF. Includes all DPDP-required disclosures: identity, purpose, categories, retention, rights. |
| Data Inventory Worksheet | Guided form maps data flows: what data, collected where, processed for what purpose, retained for how long, third parties involved. Generates a shareable, exportable inventory PDF — the first document a DPB auditor will request. |
| 72-Hour Breach Notification (Guided Workflow) | Full step-by-step guided workflow: breach detected → log with timestamp (clock starts) → categorise data and affected users → assess DPB notification threshold → draft notification from data inventory → internal approval → notify affected users → submit to DPB → post-breach remediation log. Every step timestamped and attributed to a named user. Full audit trail exportable. |
| Compliance Dashboard | Single-page view of compliance status: consent banner live/not, privacy notice published, data inventory complete, last audit date, pending rights requests. Minimum one visible value event per customer per month. |

**[RESOLVED: Breach notification depth]  **Changed from template-only to full guided end-to-end workflow. Template alone is a download; a guided workflow is a product the customer must be inside to complete. The workflow engine built for breach notification is the same engine used for rights request handling — build concretely first, extract the shared pattern when building rights requests.

## **Phase 2 — Growth Layer (Months 3–5)**

Goal: Increase average contract value. Add features that make ConsentShield stickier for companies already using Phase 1.

| **DPDP Gap Assessment Tool** | Interactive 47-question scored assessment across 7 DPDP categories, mapped to actual Act sections. Produces a personalised gap report (red/amber/green) with ConsentShield feature mapped to each gap. Email gate before results. Used externally as the primary lead acquisition tool. |
| --- | --- |
| Data Principal Rights Tracker | Manages the full lifecycle of erasure, access, correction, and nomination requests. 30-day SLA timer with auto-reminders. Exportable response log for audit evidence. Built on the shared workflow engine from Phase 1. |
| Consent Withdrawal Engine | When a user withdraws consent, ConsentShield triggers a workflow: pause marketing, notify integrations via webhook, log the withdrawal with timestamp. Satisfies DPDP Section 6(3). |
| Processing Log Module | Continuous log of all data processing activities. Minimum 1-year retention as required by DPDP Rules. Queryable by purpose, data category, or date range. |
| Multi-property Support | Manage consent across multiple websites or apps from one account. Critical for SaaS companies with multiple products or regional domains. |

## **Phase 3 — Moat Building (Months 6–12)**

Goal: Create switching costs, open new verticals, and justify premium pricing.

| **GDPR Module** | Dual-framework coverage for Indian SaaS companies selling to European markets. Infrastructure is 60–70% shared with DPDP (consent banner, data inventory, rights workflow, audit export). Launched as an upsell to existing DPDP customers after 20–25 customers are acquired. Retention driver: customers with EU exposure cannot cancel without losing both frameworks. |
| --- | --- |
| Sector Templates | Pre-configured template sets for SaaS, edtech (with parental consent), fintech, and healthcare. Each template pre-maps the highest-risk data categories for that sector. |
| DPO-as-a-Service Matchmaking | Connect customers with empanelled Data Protection Officers. ConsentShield earns a referral fee. Customer gets a named DPO for regulatory purposes without a full-time hire. DPO partner carries the legal liability; ConsentShield carries the software liability. |
| DPDP + ABDM Bundle | For clinic customers: unified consent engine that satisfies both the ABDM consent artefact requirement and DPDP notice-plus-consent in a single patient interaction. Do not build ABDM features until 3 clinics commit to a paid pilot in writing. Sales before code. |
| Compliance API | REST API for enterprise customers to embed compliance workflows into their own products. Enables white-label partnerships with CA firms and legal tech platforms. |
| Audit Export Package | One-click export of all audit evidence: consent logs, processing records, rights request responses, breach notifications, formatted for DPB inspection. |

**[RESOLVED: GDPR sequencing]  **GDPR added as Phase 3 feature, not Phase 1. Rationale: adding GDPR before DPDP is proven dilutes India-first positioning and puts ConsentShield into a crowded market against OneTrust and CookieYes without a differentiated product. After 20–25 DPDP customers, GDPR becomes an upsell to existing customers with EU exposure — high conversion, low marginal build cost.

# **5. Pricing ****&**** Packaging**

## **Pricing Philosophy**

Price on compliance urgency and operational value, not on features. Customers are not buying software — they are buying legal protection and operational infrastructure. The comparison is not ‘vs. other SaaS tools’ — it is ‘vs. a law firm retainer at ₹5–25 lakh per engagement.’ Anchoring to that comparison makes every price point feel like a bargain.

| **Starter ₹2,999/mo** | **Growth ₹5,999/mo** | **Pro ₹9,999/mo** | **Enterprise ₹24,999+/mo** |
| --- | --- | --- | --- |
| 1 product / website | 3 properties | 10 properties | Unlimited |
| Consent banner + JS snippet | Everything in Starter | Everything in Growth | Everything in Pro |
| Privacy notice builder | Audit readiness score | Sector-specific templates | DPO-as-a-Service matching |
| Data inventory worksheet | Rights request tracker | Compliance API access | Custom SLA |
| 72-hr breach workflow | Consent withdrawal engine | Multi-team roles | White-label option |
| Compliance dashboard | Processing log (1-year) | Audit export package | ABDM bundle available |
| Email support | Priority support | Dedicated onboarding call | Named account manager |

## **Add-on: ConsentShield for Clinics (DPDP + ABDM Bundle)**

| Bundle Pricing: Available as an add-on to any plan from Growth upward, or as a standalone at ₹4,999/mo for single-doctor clinics. Clinics with ABDM integration and DPDP compliance justify pricing at ₹6,000–₹8,000/month — 2–3× the market rate for generic clinic EMR subscriptions — because it replaces two mandatory compliance obligations. |
| --- |

## **Annual Discount ****&**** CA Partner Program**

- Annual upfront: 20% discount (2 months free). Positions annual ACV at ₹28,800–₹2,40,000 depending on tier.

- CA / Legal firm white-label: 30% revenue share on all referred and managed accounts. No upfront fee. Note: the ₹2,000 average MRR shown for CA-referred customers in Section 9 represents ConsentShield’s net revenue after the 30% share. The underlying subscription is ~₹6,667/month.

- Startup accelerator partnerships (NASSCOM, T-Hub, iSPIRT): group pricing at 40% off Growth tier for cohort members.

**[RESOLVED: CA partner revenue clarification]  **The ₹2,000 avg MRR per CA-referred customer in the Month 24 revenue mix is ConsentShield’s net revenue after the 30% share. The underlying subscription is approximately ₹6,667/month. This distinction matters for margin analysis and should be reflected consistently in financial modelling.

# **6. Marketing Strategy**

## **Ideal Customer Profile (ICP) — Priority Order**

| **Priority** | **Profile** | **Why They Buy** | **Where to Find Them** |
| --- | --- | --- | --- |
| 1 | Indian SaaS founder, 5–50 employees, B2B or B2C product, raised seed or Series A — especially those with EU customer exposure | DPDP is now a due diligence item for fundraising. VCs ask about it. EU exposure adds GDPR urgency — dual-framework customers have lowest churn. | SaaSBoomi Slack, ProductHunt India, LinkedIn, IndiaHacks communities |
| 2 | Edtech CTO, 50K–2M users, K–12 or upskilling product | Children’s data provisions are the harshest — reputational risk is existential. | EdTechX Asia network, NASSCOM FutureSkills, LinkedIn |
| 3 | D2C e-commerce founder, ₹5–50 crore GMV, email/WhatsApp marketing-heavy | Email lists and WhatsApp groups are explicitly regulated. First enforcement cases likely here. | D2C Insider community, e-commerce WhatsApp groups |
| 4 | Single-doctor clinic or 5–10 doctor group practice in Telangana / Karnataka | ABDM registration + health data = immediate DPDP obligation. Most don’t know yet. | IMA-Telangana, in-person clinic visits, medical college networks |

## **Content Marketing — The Trust Engine**

The DPDP compliance space is won by whoever is perceived as the authoritative expert. Content is not a growth hack — it is the product demo for buyers who won’t take a sales call without first reading your work.

| **DPDP Founder Newsletter** | Weekly email: ‘One DPDP thing you need to know this week.’ Plain English. Actionable. No legal jargon. Target: 5,000 subscribers by Month 6. This is the primary inbound channel. |
| --- | --- |
| DPDP Gap Assessment Tool (Primary Lead Magnet) | Interactive 47-question scored assessment. Email-gated before results. Personalised red/amber/green gap report. Each gap maps to a ConsentShield fix. Results CTA carries gap context into signup. Converts readers to trials. Sends personalised PDF to the user’s inbox — forwarded to CTOs and VCs. This replaces the generic downloadable checklist. |
| DPDP Explained for Founders | SEO content series. Target keywords: ‘DPDP compliance India’, ‘DPDP consent management’, ‘data protection India SaaS’. Long-tail traffic with high buying intent. |
| Case Study Library | After Month 6: publish anonymised case studies. ‘How a 12-person edtech startup achieved DPDP compliance in 3 days.’ Trust signal for procurement conversations. |
| LinkedIn Thought Leadership | 2 posts per week from the founder account. Discuss enforcement updates, regulatory news, real-world implications. Not product promotion. Industry authority positioning. |

**[RESOLVED: Lead magnet upgrade]  **v1.0 listed a generic downloadable DPDP checklist as the primary lead magnet. v1.1 replaces this with the interactive gap assessment tool (dpdp-checklist.html). Rationale: (1) personalised scoring creates urgency the generic checklist cannot; (2) the gap report is a document founders forward internally and to VCs — organic distribution; (3) email gate provides structured lead data including industry and score; (4) results CTA carries specific gap IDs into the signup URL, enabling personalised onboarding.

## **Community ****&**** Partnership Channels**

| **SaaSBoomi** | India’s largest SaaS founder community. Conference presence + Slack community sponsorship. High-intent buyers concentrated in one place. Target: speak at one event by Month 4. |
| --- | --- |
| iSPIRT Network | Volunteer ecosystem that built the DPDP policy framework. Being known here = credibility. Attend open houses, contribute to DPDP awareness GitHub resources. |
| CA / Law Firm Channel | India has 300,000+ practising Chartered Accountants. Many advise clients on compliance without a tool. White-label program: 30% revenue share, no upfront fee. CA-referred customers have naturally higher trust and lower churn. |
| T-Hub / NASSCOM | Hyderabad’s startup ecosystem. Get listed as a preferred compliance tool for portfolio companies. T-Hub alone has 600+ startups. |
| IMA-Telangana | For the ABDM + DPDP bundle: the Indian Medical Association – Telangana State chapter is the distribution channel into the clinic segment. |

## **90-Day Go-to-Market Plan**

| **Phase** | **Period** | **Milestones ****&**** Targets** |
| --- | --- | --- |
| MVP Build | Week 1–8 | Build Phase 1 features. Set up Razorpay subscriptions. Deploy on Vercel. Register consentshield.in domain. Launch gap assessment tool. |
| Soft Launch | Week 9 | Launch in SaaSBoomi Slack, LinkedIn, and 3 founder WhatsApp groups. Give 10 free 30-day trials to respected founders for feedback and testimonials. |
| Lead Magnet Live | Week 10 | Gap assessment tool live on landing page. Run one LinkedIn post promoting it. Collect emails. Target: 200 email submissions in Week 10. |
| First Revenue | Week 11–12 | Convert 5 trial users to Starter plan (₹2,999/month). Begin CA firm outreach. Send first edition of DPDP Founder Newsletter. |
| Growth Phase | Month 3–6 | Ship Phase 2 features. Speak at SaaSBoomi event. Reach ₹1L MRR. Begin ABDM clinic conversations in Hyderabad. |

# **7. App Design Blueprint**

## **Design Principles**

| **Clarity over Cleverness** | Every screen should communicate what it is and what action to take next in under 5 seconds. DPDP is confusing enough — the UI cannot add to that confusion. |
| --- | --- |
| Status-First Layout | The dashboard is a compliance status board, not a settings page. The dominant visual should be ‘how compliant are you right now’ — not navigation menus. |
| Actionable Empty States | When a feature hasn’t been configured yet, the empty state shows one CTA: ‘Set this up now.’ Every empty state is a conversion opportunity. |
| Audit-Ready by Default | Every action a user or their customer takes inside ConsentShield generates a timestamped log. Logging runs silently — never needs to be ‘turned on’. |
| Mobile-Accessible Core | Clinic customers may check compliance status on a phone between patients. The compliance dashboard and rights request tracker must be fully usable on mobile. |
| Monthly Value Moment | Every customer receives at least one visible value event per month: compliance health score update, regulatory alert, processing log reminder, or open DSR countdown. This is the retention mechanism for customers whose dashboard is green. |

## **Information Architecture**

| **Nav Area** | **Purpose** | **Primary User Action** |
| --- | --- | --- |
| Dashboard | Compliance health at a glance. Scores, alerts, pending items. | Fix the top-ranked compliance gap. |
| Consent Manager | Build and manage consent banners, withdrawal flows, consent logs. | Deploy a new consent banner. View consent rate analytics. |
| Data Inventory | Map what data you collect, why, and for how long. | Complete or update a data flow entry. |
| Rights Centre | Manage Data Principal rights requests (erasure, access, correction). | Respond to an open rights request within SLA. |
| Audit & Reports | Processing logs, breach notifications, downloadable compliance packages. | Export the Audit Package for a VC or DPB inspection. |
| Settings | Account, team members, integrations, billing. | Add a new web property or team member. |

## **Key Screen Designs**

**Dashboard — Compliance Command Centre**

| **Top Bar** | Logo left. ‘Compliance Score: 74%’ badge (colour-coded: red <50, amber 50–80, green >80). Notification bell with count. User avatar. |
| --- | --- |
| Score Card | Large circular gauge showing overall DPDP compliance %. Below it: ‘Last updated: 2 hours ago.’ Link: ‘See full audit report.’ |
| Status Grid | 4 cards in a row: Consent Banner (Live/Not Live), Privacy Notice (Published/Draft), Data Inventory (Complete/Incomplete), Rights Requests (Open count + SLA status). |
| Action Queue | Ordered list of ‘Things to fix today’: each item has severity (High/Medium), estimated time to fix, and a single CTA button. No more than 5 items shown. |
| Recent Activity | Timeline of recent events: consent banner deployed, rights request received, breach notification sent. Last 7 days. |
| Enforcement Clock | Bottom right: small widget. ‘Days until full DPDP enforcement: 396.’ Orange if <365 days, red if <180 days. |

**Rights Centre — Request Management**

| **Request Inbox** | Table of all incoming Data Principal rights requests. Columns: Name, Type (Erasure/Access/Correction/Nomination), Date received, Days remaining, Status, Assignee. |
| --- | --- |
| SLA Timer | Each open request shows a countdown: ‘24 days remaining’ (green) → ‘5 days remaining’ (amber) → ‘OVERDUE’ (red). Auto-email reminder sent at 7 days. |
| Response Workflow | Step-by-step guided response: Verify identity → Confirm data categories → Draft response → Log action → Mark complete. Each step logged with timestamp and user attribution. |
| Audit Log | Read-only log of all completed requests. Exportable. Shows who responded, what was done, when. The evidence file for a DPB inspection. |

## **UX Flow: New Customer Onboarding (0 → First Consent Collected)**

| **Step** | **Action** |
| --- | --- |
| 1 | Signup: Email + Google OAuth. Supabase Auth. No credit card required for 14-day trial. |
| 2 | Company Setup: Company name, industry (dropdown with sector-specific template pre-selection), primary website URL, estimated monthly unique visitors. |
| 3 | Data Inventory Quick-Start: 10-question guided interview. Auto-generates a draft data inventory. Seeds the gap assessment personalisation on first login. |
| 4 | Consent Banner Wizard: Choose from 3 pre-built templates (Minimal / Standard / Full). Edit text. Select purposes. Preview renders live. |
| 5 | Snippet Deployment: Copy JS snippet. Paste into website <head>. ConsentShield monitors and confirms when the snippet is detected live (green tick within 5 minutes). |
| 6 | Compliance Score Calculated: Dashboard loads with initial score (typically 40–60% after steps 1–5). Action queue shows next 3 gaps to close. |
| 7 | First Consent Collected: Dashboard shows first consent event. ‘Your first DPDP-compliant consent was collected at 14:32 today.’ Completion of the onboarding arc. |

# **8. Technical Architecture**

## **Core Stack**

| **Layer** | **Technology** | **Rationale** |
| --- | --- | --- |
| Frontend | Next.js 14 + TypeScript + Tailwind + shadcn/ui | App Router for nested layouts. Server components for dashboard data. |
| Auth | Supabase Auth | Confirmed choice. Integrated with database, native RLS support. No cross-service identity plumbing. Multi-tenant isolation via organisation_id on every row. |
| Database | PostgreSQL + Drizzle ORM (Supabase) | Row-level security for multi-tenant data isolation. Append-only consent_events table enforced at DB role level. |
| Consent Snippet | Vanilla JS + Vercel Edge Network (CDN) | Sub-50ms load time globally. Edge caching for the banner script. cdn.consentshield.in/v1/banner.js. |
| Workflow Engine | Shared step/task engine (built Phase 1, reused Phase 2) | Breach notification workflow and rights request workflow share the same engine: timestamped steps, user attribution, status progression, audit export. Build breach notification concretely first; extract the pattern when building rights requests. |
| PDF Generation | react-pdf or Puppeteer | For audit export packages, privacy notice PDFs, gap report PDFs. |
| Email | Resend | Transactional: rights request alerts, SLA reminders, breach notifications, gap report delivery, weekly newsletter. |
| Billing | Razorpay Subscriptions | Indian payment stack. Supports INR, auto-renewal, webhook-driven plan changes. |
| Monitoring | Sentry + Vercel Analytics | Error tracking + performance. Essential when audit trails cannot have gaps. |

**[RESOLVED: Auth stack]  **Supabase Auth confirmed. Clerk removed from all references. Rationale: single integrated platform for auth, database, and RLS eliminates cross-service identity plumbing and reduces tooling surface area.

| **IMPLEMENTATION RULE: RLS policies must be written and tested before any customer data exists. Schema design and RLS policy definitions are the first committed code, before any UI. A consent log that leaks across tenants — even briefly, even in a bug — is a catastrophic trust event for a compliance product specifically.** |
| --- |

## **Data Architecture Rules (Non-Negotiable)**

| **ConsentShield's database is an operational state store, not a compliance record store.** The canonical compliance record — every consent event, audit entry, processing log, and rights request — lives in customer-owned storage. ConsentShield holds working copies in buffer tables only until confirmed delivery to the customer's storage destination, then hard-deletes them. |
| --- |

- **Two categories of data, not one.** Operational state (org config, banner config, consent artefact validity index, delivery buffer state) lives in ConsentShield permanently. User data (consent events, audit log, processing log, rights request personal data) is buffer data — held for delivery, deleted after confirmed write to customer storage.

- **Health data (ABDM bundle) is never stored.** FHIR records flow through ConsentShield's server in memory only. No schema, no table, no log ever holds FHIR content. The only durable writes from an ABDM session are artefact validity index entries (no clinical data) and audit entries (timestamps and purpose references only). This supersedes the earlier rule about a separate encrypted schema — a separate schema is not sufficient; zero persistence is the requirement.

- **Multi-tenant isolation:** every record includes organisation_id. Row-Level Security enforced at DB level, not just application level.

- **Consent events are append-only buffers** — no UPDATE or DELETE permissions at DB role level. Rows are hard-deleted by a nightly purge job after confirmed delivery to customer storage. The purge is not a violation of immutability; it is the correct behaviour for a write-ahead log that has completed its purpose.

- **Audit log schema:** event_id, org_id, user_id (nullable for Data Principal actions), event_type, payload (JSONB), created_at, delivered_at. The delivered_at field is set on confirmed write to customer storage. DPDP's 1-year minimum retention obligation sits with the Data Fiduciary (the customer) — who holds it in their own storage.

- **Processing modes** — Standard (ConsentShield-provisioned R2, per-customer encryption key delivered and discarded), Insulated (customer BYOS, write-only credential, customer-held key), Zero-Storage (in-memory transit only for sensitive data). Enforced at the API gateway before any data write.

- **Export storage default: Cloudflare R2.** No egress fees, same Cloudflare account as Workers, simpler token model than AWS IAM. S3 available for BYOS customers with existing AWS infrastructure. S3 + AWS KMS for regulated enterprise requiring verifiable CMK.

## **Consent Banner — Technical Specification**

| **Delivery** | CDN-hosted script: cdn.consentshield.in/v1/banner.js. Customer adds one <script> tag. No NPM install required. |
| --- | --- |
| Consent Storage | Server-side only. Consent events POST to ConsentShield API with: user fingerprint (hashed), timestamp, purposes accepted, IP (truncated for privacy), banner version ID. |
| Retrieval | On page load, script calls API with session token to retrieve existing consent state. If consent exists, banner does not re-appear. |
| Events | Webhook events fired on: consent_given, consent_withdrawn, purpose_updated, banner_dismissed. Customer can subscribe any endpoint. |
| Versioning | Every change to banner configuration creates a new banner version. Historical consent is always tied to the exact version the user consented to. |

# **9. Revenue Projections ****&**** Financial Model**

## **24-Month MRR Build**

| **Month** | **New Customers** | **Total** | **Avg MRR/customer** | **MRR** | **Key Events** |
| --- | --- | --- | --- | --- | --- |
| 1–2 | 0 | 0 (trials) | — | ₹0 | MVP build. 10 free trials. Gap assessment tool live. |
| 3 | 5 | 5 | ₹3,000 | ₹15,000 | First 5 paying customers. Lead magnet active. |
| 4 | 5 | 10 | ₹3,500 | ₹35,000 | Phase 2 features start. CA outreach begins. |
| 5 | 8 | 18 | ₹4,000 | ₹72,000 | SaaSBoomi event. First CA partner signed. |
| 6 | 7 | 25 | ₹4,000 | ₹1,00,000 | ₹1L MRR milestone. ABDM pilot conversations. GDPR planning. |
| 8 | 12 | 37 | ₹4,500 | ₹1,66,500 | 3 ABDM clinic pilots. Phase 3 features launch. GDPR module build begins. |
| 10 | 15 | 52 | ₹5,000 | ₹2,60,000 | ABDM first paying customers. T-Hub partnership. GDPR module live. |
| 12 | 28 | 80 | ₹5,000 | ₹4,00,000 | ₹4L MRR. 80 customers across 3 segments. |
| 18 | 40 | 140 | ₹6,000 | ₹8,40,000 | ABDM bundle at scale. CA channel producing 30% of revenue. |
| 24 | 60 | 200 | ₹6,000 | ₹12,00,000 | ₹12L MRR. Enterprise tier. DPDP + GDPR + ABDM at scale. |

| **Checkpoint Rule: If DPDP MRR is not at ₹1L by Month 6, fix the sales motion before investing in GDPR or ABDM. Do not add complexity to a model that has not yet proved it can sell.** |
| --- |

## **Revenue Mix by Month 24**

| **Segment** | **Customers** | **Avg MRR/customer** | **Segment MRR** | **% of Total** |
| --- | --- | --- | --- | --- |
| Indian SaaS Startups (DPDP) | 60 | ₹4,500 | ₹2,70,000 | 22.5% |
| Indian SaaS Startups (DPDP + GDPR) | 30 | ₹7,500 | ₹2,25,000 | 18.75% |
| Edtech / D2C | 50 | ₹6,000 | ₹3,00,000 | 25.0% |
| ABDM Clinic Bundle | 40 | ₹7,000 | ₹2,80,000 | 23.3% |
| Enterprise / White-label | 10 | ₹15,000 | ₹1,50,000 | 12.5% |
| CA Partner Referrals (net revenue) | 10 | ₹2,000* | ₹20,000* | 1.7% |

* CA Partner MRR shown as net revenue after 30% revenue share. Underlying subscription averages ~₹6,667/month. GDPR segment separated from DPDP-only to reflect the upsell value.

# **10. Risk Analysis ****&**** Mitigations**

## **Product ****&**** Market Risks**

| **Risk** | **Severity** | **Mitigation** |
| --- | --- | --- |
| Government extends enforcement grace period beyond May 2027 | HIGH | Primary positioning is future-proofing, not fear. A company that is compliant now is not losing anything. Red line: if by November 2026 there is no concrete enforcement signal (no first case, no sector circular), reposition ConsentShield as an operational data governance platform before briefing the marketing firm. Do not hand a fear-based brief to an agency when enforcement may not materialise on schedule. |
| Zoho, Sprinto or Cleartax ships a DPDP module | HIGH | Own a vertical niche (‘DPDP for SaaS’) before they enter. Switching cost once in is high — 12 months of audit logs and consent history cannot be easily migrated. GDPR module creates second reason to stay. |
| DPB enforcement is softer than expected (GDPR 2018 pattern) | MEDIUM | Products that have standalone workflow value (daily-use dashboards, rights management, reporting) survive enforcement slowdowns. Build for utility, not just compliance fear. Monthly value events per Section 7 are essential. |
| Legal liability if product guidance is incorrect | MEDIUM | Position as infrastructure, not legal advice. All templates carry a prominent disclaimer. DPO-as-a-Service partner carries the legal liability; ConsentShield carries the software liability. Disclaimer must be consistent across all customer-facing materials. |
| Churn after customers achieve compliance and dashboard is green | MEDIUM | Three retention mechanisms: (1) data hostage — audit trail and consent logs cannot be migrated without breaking regulatory continuity; (2) ongoing workflow — DSR inbox with active requests keeps customers in the product; (3) regulatory change — every DPB circular triggers a product update and a retention event. |

## **Execution Risks**

| **Risk** | **Severity** | **Mitigation** |
| --- | --- | --- |
| Feature creep slows the path to first revenue | HIGH | Hard cap: Phase 1 ships in 8 weeks maximum. No new features until 5 paying customers exist. Use the customer conversations to decide what Phase 2 prioritises, not personal preference. |
| Healthcare sales take longer than projected | HIGH | ABDM bundle begins as conversations, not builds. Do not build ABDM features until 3 clinics commit to a paid pilot in writing. Sales before code. ABDM timeline in Section 9 is optimistic — treat as a target, not a commitment. |
| Partner company support handoff too late | HIGH | The partner company’s support/maintenance person must be operational before the GDPR module build begins — not during it. Target: onboarded and shadowing by Month 5, independent by Month 6. |
| Low awareness of DPDP among target buyers | MEDIUM | This is a marketing problem, not a product problem. The newsletter, gap assessment tool, and SaaSBoomi presence are the levers. If buyers don’t know about DPDP, you are not the product — you are the category creator. |
| CA partner channel slower to activate than projected | LOW | CA partnerships are a Month 4–6 initiative. If they don’t activate by Month 8, increase direct content/inbound spend instead. The CA channel is additive, not the primary motion. |

# **11. Immediate Next Steps**

## **Week 1–2 Actions**

| **#** | **Action** |
| --- | --- |
| 1 | Register consentshield.in. Set up the landing page with gap assessment tool as primary CTA. No product demo yet. |
| 2 | Set up the tech foundation: Vercel project, Supabase project (Auth + Postgres), Razorpay test account, Resend domain verification, Cloudflare zone for cdn.consentshield.in. |
| 3 | Write the RLS policies for the core schema before any UI code. Test multi-tenant isolation with two dummy organisations before proceeding. |
| 4 | Register for ABDM Sandbox at sandbox.abdm.gov.in. This takes under a week and unlocks the ABDM integration path. |
| 5 | Join SaaSBoomi Slack (if not already a member) and iSPIRT volunteer mailing list. |
| 6 | Write the first DPDP newsletter draft. Publish it whether or not the product is live — it builds the audience that will buy. |
| 7 | Set the LEAD_ENDPOINT in dpdp-checklist.html to the Supabase Edge Function URL before the gap assessment tool goes live. This is the only action that converts the tool from a demo into a lead generation machine. |

## **Definition of Done — Phase 1**

| **Deliverable** | **Success Criterion** |
| --- | --- |
| MVP Launch | Consent banner builder, privacy notice generator, data inventory, breach workflow, dashboard — all live on production. |
| First Revenue | 5 customers on paid Starter plan. ₹15,000 MRR. Razorpay subscription active. |
| Content Engine Live | DPDP newsletter has 500+ subscribers. Gap assessment tool has 200+ email submissions. |
| Partner Handoff Ready | Partner company support person identified and briefed. Onboarding plan written. Independent by Month 6. |
| ABDM Ready | Sandbox access approved. First clinic pilot conversation held in person. No ABDM build until 3 written pilot commitments. |

# **12. Appendix — Key Resources**

## **Regulatory ****&**** Legal**

- DPDP Act 2023 + Rules 2025: meity.gov.in

- Data Protection Board of India: dpboard.gov.in

- DPDP Rules Gazette Notification: Official text, notified 13 November 2025

## **ABDM / Health Stack**

- ABDM Sandbox: sandbox.abdm.gov.in

- NHA Developer Portal: nha.gov.in

- Google ABDM FHIR Wrapper: github.com/google-cloud/healthcare-data-harmonization

## **iSPIRT ****&**** India Stack**

- iSPIRT Foundation: ispirit.in

- IndiaStack overview: indiastack.org

- DEPA framework: github.com/iSPIRT/depa-training

## **Community ****&**** Distribution**

- SaaSBoomi (Indian SaaS community): saasboomi.com

- T-Hub Hyderabad: t-hub.co

- IMA-Telangana: imatsioffice.com

## **Tooling ****&**** Tech**

- Supabase (Auth + Database + RLS): supabase.com

- Drizzle ORM: orm.drizzle.team

- Razorpay Subscriptions: razorpay.com/subscriptions

- Resend (email): resend.com

- Vercel (hosting + edge network): vercel.com

# **13. Design Decisions Log — April 2026 Review**

This section records decisions made during the April 2026 design review. Each decision is reflected in the relevant section of the document above. This log should be updated at each phase checkpoint.

| **Decision** | **Resolved** | **Notes** |
| --- | --- | --- |
| Auth stack | Supabase Auth | Clerk removed from all references. See Section 8. |
| Breach notification depth | Full guided workflow | Template-only rejected. See Section 4 Phase 1. |
| Lead magnet format | Scored gap assessment with email gate | Generic checklist replaced. See Section 6. |
| GDPR inclusion | Phase 3 — after 20–25 DPDP customers | Not Phase 1. See Section 4 Phase 3. |
| Primary messaging | Future-proofing over fear | Fear retained as secondary. See Section 3. |
| Workflow engine | Shared / reusable — breach first, extract pattern | See Section 8. |
| CA partner revenue reporting | Net of 30% share | ₹2,000 avg is net. Gross ~₹6,667. See Section 9. |
| Enforcement delay risk severity | Elevated — High with Nov 2026 red line | See Section 10. |
| Partner company handoff timing | Month 5 — before GDPR build | See Section 11. |
| Competitive analysis | Deferred to Month 3 | Add Scrut, Sprinto, CookieYes to landscape. |

*Document prepared April 2026 (v1.1). This is a living document — update enforcement timeline dates, competitive landscape, and MRR projections quarterly. The regulatory calendar is the primary driver of all marketing claims; verify dates at meity.gov.in before any external use.*

consentshield.in  ·  Hyderabad, India  ·