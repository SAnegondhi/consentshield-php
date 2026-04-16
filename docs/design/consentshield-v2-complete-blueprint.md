# ConsentShield v2 — Complete Product Blueprint

*Full product specification · April 2026*
*Purpose: Complete platform specification for partner evaluation and joint go-to-market planning*

---

## Why This Document Exists

ConsentShield cannot operate as a registered Consent Manager under DPDP Rule 3 — that requires an Indian-incorporated company with ₹2 crore net worth. A solo developer building the software needs a partner company to carry the regulatory registration, customer-facing support, and go-to-market operations.

This document is the complete technical and product specification for that conversation. It covers every feature across all four product phases, with enough architectural detail that a potential partner can evaluate the full scope of what they would be taking to market.

The software is built by a solo developer. The business requires two entities: one that builds the platform, one that operates and sells it.

---

## Table of Contents

**Part I — Architecture & Foundation**
1. [The identity shift](#1-identity-shift)
2. [What changes, what stays](#2-changes-stays)
3. [Revised stack](#3-revised-stack)
4. [New database schema — all phases](#4-database-schema)
5. [Banner script v2 — the monitoring agent](#5-banner-script)

**Part II — Phase 1: Enforcement MVP (Weeks 1–8)**
6. [Phase 1 feature set](#6-phase-1)
7. [Phase 1 data flows](#7-phase-1-flows)
8. [Phase 1 dashboard](#8-phase-1-dashboard)

**Part III — Phase 2: Enforcement Depth (Months 3–5)**
9. [Phase 2 feature set](#9-phase-2)
10. [Scan engine — server-side verification](#10-scan-engine)
11. [Deletion orchestration](#11-deletion-orchestration)
12. [Phase 2 data flows](#12-phase-2-flows)
13. [Phase 2 dashboard additions](#13-phase-2-dashboard)

**Part IV — Phase 3: Multi-Framework & Ecosystem (Months 6–12)**
14. [Phase 3 feature set](#14-phase-3)
15. [GDPR module architecture](#15-gdpr)
16. [Consent probe testing engine](#16-consent-probes)
17. [Compliance API — white-label & partner access](#17-compliance-api)
18. [DPO-as-a-Service matchmaking](#18-dpo)
19. [Sector templates](#19-sector-templates)
20. [Phase 3 data flows](#20-phase-3-flows)

**Part V — Phase 4: Healthcare & Enterprise (Months 12–18)**
21. [Phase 4 feature set](#21-phase-4)
22. [ABDM healthcare bundle architecture](#22-abdm)
23. [Cross-border data transfer module](#23-cross-border)
24. [Enterprise & white-label platform](#24-enterprise)
25. [Phase 4 data flows](#25-phase-4-flows)

**Part VI — Delivery**
26. [Complete build timeline — all phases](#26-timeline)
27. [Revised pricing across all tiers](#27-pricing)
28. [The partner proposition](#28-partner)
29. [What remains out of scope](#29-out-of-scope)

---

# Part I — Architecture & Foundation

## 1. The Identity Shift {#1-identity-shift}

ConsentShield v1 was a **compliance documentation and workflow tool** — it helped companies produce the paperwork that demonstrates compliance. ConsentShield v2 is a **compliance enforcement engine** — it verifies that what companies claim matches what they actually do, and actively intervenes when it doesn't.

v1 compliance score: "You've configured 8 of 10 things." This is a to-do list.

v2 compliance score: "Your consent banner is live, but Meta Pixel fires before consent on 12% of page loads. Your stated retention period for marketing data expired 14 days ago and 3 connected systems still hold the data. Your site is missing HSTS headers." This is an x-ray of reality.

By Phase 4 the platform covers DPDP + GDPR + ABDM across SaaS, edtech, ecommerce, fintech, and healthcare verticals — with enforcement evidence at every layer.

---

## 2. What Changes, What Stays {#2-changes-stays}

### Foundation that stays

| Component | Status |
|---|---|
| Supabase Auth + RLS multi-tenant isolation | Unchanged |
| Stateless oracle data architecture (customer owns compliance record) | Unchanged |
| Cloudflare Worker for banner delivery | Expanded with monitoring |
| Append-only consent events with buffer-and-deliver | Unchanged |
| Razorpay billing (INR) | Unchanged |
| Export to customer-owned storage (R2/S3) | Unchanged |

### What each phase adds

| Capability | Phase 1 | Phase 2 | Phase 3 | Phase 4 |
|---|---|---|---|---|
| Data inventory | Auto-discovered from tracker detection | + Retention rules per data category | + Sector-specific templates | + ABDM health data flows |
| Consent verification | Active tracker monitoring | + Withdrawal verification loop | + Consent probe testing (synthetic) | + ABDM consent artefact verification |
| Data deletion | — | Deletion orchestration (webhook + 3 connectors) | + 10 more connectors + GDPR Article 17 | + ABDM record deletion protocol |
| Security posture | — | Nightly external scans | + Continuous monitoring | Unchanged |
| Rights management | — | Full DSR lifecycle with SLA | + GDPR DSAR compliance | + ABDM data access requests |
| Multi-framework | DPDP only | DPDP only | + GDPR dual-framework | + ABDM health data framework |
| API access | — | — | Compliance API (REST) | + White-label API |
| Healthcare | — | — | — | Full ABDM bundle |

---

## 3. Revised Stack {#3-revised-stack}

| Layer | Technology | Purpose | Phase introduced |
|---|---|---|---|
| Frontend | Next.js 14 + TypeScript + Tailwind + shadcn/ui | Web application | 1 |
| Auth | Supabase Auth | Multi-tenant auth + RLS | 1 |
| Database | Supabase Postgres | All application data | 1 |
| Edge Functions | Supabase Edge Functions (Deno) | Async jobs, scans, orchestration | 1, expanded each phase |
| Banner + monitoring | Cloudflare Worker + KV | Banner delivery, consent events, tracker observations | 1 |
| Scan Engine | Vercel Cron + HTTP checks | Withdrawal verification, security posture | 2 |
| Integration Connectors | Next.js API routes + Edge Functions | OAuth flows, deletion APIs, webhook protocol | 2 |
| Tracker Signature DB | Versioned JSON, embedded in banner | Tracker classification intelligence | 1 |
| Consent Probe Engine | Headless HTTP scan with synthetic consent state | Automated compliance testing | 3 |
| Compliance API | Next.js API routes + API key auth | White-label partner access, enterprise integrations | 3 |
| ABDM Gateway | Supabase Edge Functions + FHIR R4 | ABHA lookup, consent artefact, record pull, HIP upload | 4 |
| AI Processing | Anthropic API (zero data retention tier) | Drug interaction check from ABDM medication history | 4 |
| Email | Resend | All transactional email | 1 |
| Billing | Razorpay Subscriptions | INR plans | 1 |
| Hosting | Vercel | Next.js app | 1 |
| Notification Channels | Resend (email) + Slack/Teams/Discord webhooks | Compliance alerts without a mobile app | 1 (email), 2 (webhooks) |
| Monitoring | Sentry + Vercel Analytics | Error tracking, performance | 1 |

---

## 4. Database Schema — All Phases {#4-database-schema}

All tables below are additive to the existing schema in `consentshield-technical-architecture.md`. Existing tables (organisations, organisation_members, web_properties, consent_banners, consent_events, data_inventory, rights_requests, rights_request_events, breach_notifications, audit_log, delivery_buffer, export_configurations, consent_artefact_index, processing_log) remain unchanged.

### Phase 1 additions

```sql
-- Tracker classification reference data
create table tracker_signatures (
  id              uuid primary key default gen_random_uuid(),
  service_name    text not null,
  service_slug    text not null unique,
  category        text not null,          -- 'analytics' | 'marketing' | 'personalisation' | 'functional'
  detection_rules jsonb not null,         -- array of { type, pattern, confidence } objects
  data_locations  text[] not null default '{}',
  is_functional   boolean not null default false,
  version         integer not null default 1,
  created_at      timestamptz default now(),
  updated_at      timestamptz default now()
);

-- What the banner script observed on each page load
create table tracker_observations (
  id                  uuid primary key default gen_random_uuid(),
  org_id              uuid not null references organisations(id) on delete cascade,
  property_id         uuid not null references web_properties(id) on delete cascade,
  session_fingerprint text not null,
  consent_state       jsonb not null,
  trackers_detected   jsonb not null,
  violations          jsonb not null default '[]',
  page_url_hash       text,
  observed_at         timestamptz default now(),
  delivered_at        timestamptz,
  created_at          timestamptz default now()
);

create index on tracker_observations (org_id, property_id, observed_at desc);
create index on tracker_observations (org_id, observed_at desc) where violations != '[]'::jsonb;

-- Customer overrides for tracker classification
create table tracker_overrides (
  id              uuid primary key default gen_random_uuid(),
  org_id          uuid not null references organisations(id) on delete cascade,
  property_id     uuid references web_properties(id) on delete cascade,
  domain_pattern  text not null,
  override_category text not null,
  reason          text,
  created_at      timestamptz default now(),
  updated_at      timestamptz default now(),
  unique (org_id, property_id, domain_pattern)
);

-- Add monitoring flag to consent banners
alter table consent_banners add column monitoring_enabled boolean not null default true;
```

### Phase 2 additions

```sql
-- Consent withdrawal verification tracking
create table withdrawal_verifications (
  id                    uuid primary key default gen_random_uuid(),
  org_id                uuid not null references organisations(id) on delete cascade,
  property_id           uuid not null references web_properties(id) on delete cascade,
  consent_event_id      uuid,
  withdrawn_purposes    text[] not null,
  scan_schedule         jsonb not null,
  scan_results          jsonb not null default '[]',
  overall_status        text not null default 'pending',
  created_at            timestamptz default now(),
  delivered_at          timestamptz
);

-- Security posture scan results
create table security_scans (
  id              uuid primary key default gen_random_uuid(),
  org_id          uuid not null references organisations(id) on delete cascade,
  property_id     uuid not null references web_properties(id) on delete cascade,
  scan_type       text not null,
  severity        text not null,
  signal_key      text not null,
  details         jsonb,
  remediation     text,
  scanned_at      timestamptz default now(),
  created_at      timestamptz default now()
);

create index on security_scans (org_id, property_id, scanned_at desc);

-- Connected third-party systems for deletion
create table integration_connectors (
  id              uuid primary key default gen_random_uuid(),
  org_id          uuid not null references organisations(id) on delete cascade,
  connector_type  text not null,
  display_name    text not null,
  config          jsonb not null,        -- encrypted credentials
  status          text not null default 'active',
  last_health_check_at timestamptz,
  last_error      text,
  created_at      timestamptz default now(),
  updated_at      timestamptz default now()
);

-- Deletion execution receipts
create table deletion_receipts (
  id                uuid primary key default gen_random_uuid(),
  org_id            uuid not null references organisations(id) on delete cascade,
  trigger_type      text not null,
  trigger_id        uuid,
  connector_id      uuid references integration_connectors(id),
  target_system     text not null,
  identifier_hash   text not null,
  status            text not null default 'pending',
  request_payload   jsonb,
  response_payload  jsonb,
  requested_at      timestamptz default now(),
  confirmed_at      timestamptz,
  failure_reason    text,
  retry_count       integer default 0,
  created_at        timestamptz default now()
);

-- Data retention rules with auto-deletion triggers
create table retention_rules (
  id                  uuid primary key default gen_random_uuid(),
  org_id              uuid not null references organisations(id) on delete cascade,
  data_category       text not null,
  retention_days      integer not null,
  connected_systems   uuid[] default '{}',
  auto_delete         boolean not null default false,
  last_checked_at     timestamptz,
  next_check_at       timestamptz,
  created_at          timestamptz default now(),
  updated_at          timestamptz default now()
);
```

### Phase 3 additions

```sql
-- GDPR-specific configuration per organisation
create table gdpr_configurations (
  id                    uuid primary key default gen_random_uuid(),
  org_id                uuid not null references organisations(id) on delete cascade,
  enabled               boolean not null default false,
  legal_bases           jsonb not null default '[]',     -- array of { purpose, legal_basis, justification }
  dpa_contacts          jsonb default '[]',              -- supervisory authority contacts
  representative_name   text,                            -- EU representative if non-EU company
  representative_email  text,
  dpia_required         boolean default false,
  created_at            timestamptz default now(),
  updated_at            timestamptz default now(),
  unique (org_id)
);

-- Consent probe test definitions and results
create table consent_probes (
  id                uuid primary key default gen_random_uuid(),
  org_id            uuid not null references organisations(id) on delete cascade,
  property_id       uuid not null references web_properties(id) on delete cascade,
  probe_type        text not null,         -- 'full_accept' | 'full_reject' | 'partial_consent' | 'withdrawal'
  consent_state     jsonb not null,        -- the simulated consent state
  schedule          text not null default 'weekly', -- 'daily' | 'weekly' | 'monthly' | 'manual'
  last_run_at       timestamptz,
  last_result       jsonb,                 -- { status, violations, trackers_detected, duration_ms }
  next_run_at       timestamptz,
  is_active         boolean not null default true,
  created_at        timestamptz default now(),
  updated_at        timestamptz default now()
);

-- Consent probe run history
create table consent_probe_runs (
  id              uuid primary key default gen_random_uuid(),
  probe_id        uuid not null references consent_probes(id) on delete cascade,
  org_id          uuid not null references organisations(id) on delete cascade,
  consent_state   jsonb not null,
  trackers_detected jsonb not null,
  violations      jsonb not null default '[]',
  page_html_hash  text,                    -- SHA-256 of page HTML at scan time
  duration_ms     integer,
  status          text not null,           -- 'pass' | 'fail' | 'error'
  error_message   text,
  run_at          timestamptz default now(),
  delivered_at    timestamptz
);

create index on consent_probe_runs (org_id, probe_id, run_at desc);

-- Sector template definitions
create table sector_templates (
  id              uuid primary key default gen_random_uuid(),
  sector          text not null unique,    -- 'saas' | 'edtech' | 'fintech' | 'ecommerce' | 'healthcare'
  display_name    text not null,
  privacy_notice_template jsonb not null,  -- pre-filled fields and language
  data_inventory_defaults jsonb not null,  -- common data flows for this sector
  tracker_allowlist jsonb not null,        -- functional trackers typical for this sector
  consent_purposes jsonb not null,         -- recommended purpose categories
  risk_categories jsonb not null,          -- highest-risk data categories for this sector
  parental_consent_required boolean default false,
  created_at      timestamptz default now(),
  updated_at      timestamptz default now()
);

-- DPO marketplace — empanelled Data Protection Officers
create table dpo_partners (
  id              uuid primary key default gen_random_uuid(),
  name            text not null,
  firm_name       text,
  email           text not null,
  phone           text,
  specialisations text[] default '{}',     -- ['saas', 'healthcare', 'fintech']
  languages       text[] default '{}',
  monthly_fee_range jsonb,                 -- { min: 15000, max: 50000, currency: 'INR' }
  bio             text,
  is_active       boolean default true,
  created_at      timestamptz default now()
);

-- DPO engagement tracking
create table dpo_engagements (
  id              uuid primary key default gen_random_uuid(),
  org_id          uuid not null references organisations(id) on delete cascade,
  dpo_id          uuid not null references dpo_partners(id),
  status          text not null default 'requested', -- 'requested' | 'active' | 'ended'
  started_at      timestamptz,
  ended_at        timestamptz,
  referral_fee_percent numeric default 15,
  created_at      timestamptz default now()
);

-- API keys for Compliance API access
create table api_keys (
  id              uuid primary key default gen_random_uuid(),
  org_id          uuid not null references organisations(id) on delete cascade,
  key_hash        text not null unique,    -- SHA-256 of the API key (never store plaintext)
  key_prefix      text not null,           -- first 8 chars for identification: 'cs_live_xxxxxxxx'
  name            text not null,           -- customer-chosen name: "Production key"
  scopes          text[] not null default '{}', -- ['read:consent', 'write:rights', 'read:audit']
  last_used_at    timestamptz,
  expires_at      timestamptz,
  is_active       boolean not null default true,
  created_at      timestamptz default now()
);
```

### Phase 4 additions

```sql
-- ABDM facility registration
create table abdm_facilities (
  id                    uuid primary key default gen_random_uuid(),
  org_id                uuid not null references organisations(id) on delete cascade,
  facility_name         text not null,
  hip_id                text,              -- Health Information Provider ID (from NHA)
  hiu_id                text,              -- Health Information User ID
  abdm_registration_status text not null default 'pending', -- 'pending' | 'sandbox' | 'production'
  bridge_url            text,              -- ABDM bridge callback URL
  created_at            timestamptz default now(),
  updated_at            timestamptz default now()
);

-- Patient queue (daily clinic workflow)
create table patient_queue (
  id                uuid primary key default gen_random_uuid(),
  org_id            uuid not null references organisations(id) on delete cascade,
  facility_id       uuid not null references abdm_facilities(id) on delete cascade,
  patient_name      text not null,         -- displayed only, never exported
  abha_id           text,                  -- ABHA address (nullable — patient may not have one)
  queue_date        date not null default current_date,
  queue_position    integer not null,
  status            text not null default 'waiting', -- 'waiting' | 'in_consultation' | 'completed' | 'no_show'
  consent_status    text default 'not_requested',    -- 'not_requested' | 'granted' | 'denied'
  consent_artefact_id text,               -- ABDM consent artefact ID (if consent granted)
  records_pulled    boolean default false,
  prescription_uploaded boolean default false,
  created_at        timestamptz default now(),
  updated_at        timestamptz default now()
);

create index on patient_queue (org_id, facility_id, queue_date, queue_position);

-- ABDM consent artefacts (operational index — no clinical data)
create table abdm_consent_artefacts (
  id                    uuid primary key default gen_random_uuid(),
  org_id                uuid not null references organisations(id) on delete cascade,
  facility_id           uuid not null references abdm_facilities(id) on delete cascade,
  artefact_id           text not null,     -- ABDM consent artefact ID
  patient_abha_id_hash  text not null,     -- SHA-256 of ABHA ID
  purpose               text not null,     -- 'care_management' | 'break_the_glass'
  status                text not null default 'active', -- 'active' | 'revoked' | 'expired'
  granted_at            timestamptz not null,
  expires_at            timestamptz not null,
  revoked_at            timestamptz,
  created_at            timestamptz default now()
);

-- Prescription metadata (no clinical content stored)
create table prescription_metadata (
  id                    uuid primary key default gen_random_uuid(),
  org_id                uuid not null references organisations(id) on delete cascade,
  facility_id           uuid not null references abdm_facilities(id) on delete cascade,
  patient_queue_id      uuid references patient_queue(id),
  prescription_id       text,              -- ABDM document reference ID
  abdm_upload_status    text default 'pending', -- 'pending' | 'uploaded' | 'failed'
  abdm_upload_at        timestamptz,
  drug_interaction_checked boolean default false,
  interaction_flags     jsonb default '[]', -- severity flags only, no clinical content
  created_at            timestamptz default now()
);

-- Cross-border transfer declarations (DPDP Section 16)
create table cross_border_transfers (
  id                    uuid primary key default gen_random_uuid(),
  org_id                uuid not null references organisations(id) on delete cascade,
  destination_country   text not null,
  destination_entity    text not null,     -- name of the receiving organisation
  data_categories       text[] not null,
  legal_basis           text not null,     -- 'government_approved' | 'contractual' | 'consent'
  safeguards            text,              -- description of safeguards in place
  transfer_volume       text,              -- 'low' | 'medium' | 'high'
  auto_detected         boolean default false, -- true if detected by tracker system
  declared_by_user      boolean default false, -- true if manually declared
  status                text not null default 'active',
  created_at            timestamptz default now(),
  updated_at            timestamptz default now()
);

-- White-label configurations for enterprise/partner deployments
create table white_label_configs (
  id              uuid primary key default gen_random_uuid(),
  org_id          uuid not null references organisations(id) on delete cascade,
  brand_name      text not null,
  logo_url        text,
  primary_colour  text default '#1E40AF',
  banner_domain   text,                    -- custom domain for banner CDN
  portal_domain   text,                    -- custom domain for rights portal
  email_from_name text,
  email_from_domain text,
  is_active       boolean default true,
  created_at      timestamptz default now(),
  updated_at      timestamptz default now()
);
```

---

## 5. Banner Script v2 — The Monitoring Agent {#5-banner-script}

The v1 banner renders, captures the consent decision, and POSTs the event. The v2 banner does all of that plus observes what happens after and reports violations.

### Architecture

```
banner.js v2 loads on customer's website
    │
    ├─ Phase 1: Consent capture (unchanged)
    │   → Render banner → capture decision → POST consent event
    │
    └─ Phase 2: Monitoring (new)
        → MutationObserver on <head>/<body> for new <script> tags
        → PerformanceObserver for resource timing entries
        → 5-second initial window → classify against signature DB → POST observation
        → 60-second extended window → POST final observation
```

### Script size: ~26KB gzipped (v1 was ~8KB). For comparison, Google Analytics is ~45KB. Loads async, does not block rendering.

### Observation report payload

```typescript
interface ObservationReport {
  org_id: string;
  property_id: string;
  session_fingerprint: string;
  consent_state: Record<string, boolean>;
  observation_window_seconds: number;
  trackers_detected: TrackerDetection[];
  violations: Violation[];
  page_url_hash: string;
}
```

### New Cloudflare Worker route: `POST /v1/observations`

Follows the same pattern as consent event ingestion: validate, buffer, export to customer storage, return 202. Non-blocking.

### Privacy: monitors trackers, not users. No cookies read, no form inputs captured, no clickstream, no page content. Only tracker domain observations and consent state comparison.

---

# Part II — Phase 1: Enforcement MVP (Weeks 1–8)

## 6. Phase 1 Feature Set {#6-phase-1}

| Feature | What it does | DPDP section |
|---|---|---|
| **Consent banner builder with monitoring** | No-code banner with live preview. CDN-hosted script tag. Granular purpose consent. Embedded tracker detection reports violations in real time. | S.5 (Notice), S.6 (Consent) |
| **Tracker signature database** | Curated classification of top 30 third-party services on Indian websites. Embedded in banner script. Monthly updates. | Enforcement intelligence |
| **Enforcement monitor** | Real-time violation dashboard. Shows which trackers fire without consent, before consent, or after withdrawal. Trend lines. | Enforcement evidence |
| **Data flow map** | Auto-generated visual of where data flows based on tracker detection. Shows domestic vs cross-border. Flags discrepancies with data inventory. | S.16 (Cross-border) |
| **Privacy notice generator** | Guided wizard → plain-language notice with all DPDP-required disclosures. Hosted page + PDF. | S.5 (Notice) |
| **Data inventory (auto-seeded)** | Guided form pre-populated with services detected by tracker monitoring. Customer adds non-web data flows manually. Exportable PDF. | S.5, S.8 |
| **72-hour breach notification workflow** | Guided end-to-end: detect → log → categorise → assess → draft → approve → notify → remediate. Every step timestamped and attributed. | S.8 (Breach) |
| **Compliance dashboard v2** | Weighted composite score based on observed reality, not self-reported config. Score components: consent infrastructure (20%), consent enforcement (30%), rights (15%), data lifecycle (15%), security (10%), audit readiness (10%). | Overall posture |
| **Audit export package** | One-click PDF export: consent logs, tracker observations, violation history, processing records, data inventory snapshot. Formatted for DPB inspection. | S.8, S.10 |

### The Phase 1 demo moment

Show a founder their own website. Reveal which trackers load, which violate consent configuration, where data flows cross-border. Nobody wants to see red flags on their own site. This demo sells itself.

---

## 7. Phase 1 Data Flows {#7-phase-1-flows}

### Flow 1: Page Load → Consent → Monitoring → Observation

```
1.  Browser loads customer's website
2.  banner.js v2 loads from cdn.consentshield.in
3.  Checks localStorage for existing consent
4.  If none: render banner, wait for decision
5.  User clicks Accept/Reject/Customise → consent event POSTed
6.  Monitoring begins:
    a. MutationObserver watches DOM for <script> tags
    b. PerformanceObserver watches resource timing
    c. 5-second initial window
7.  Classify detected trackers against signature DB
8.  Compare categories against consent state
9.  POST observation report → Worker writes to buffer → exports to customer storage
10. Continue passive monitoring for 60 seconds → POST final report
```

### Flow 2: Signup → First Consent + First Enforcement Report

```
1.  User signs up (email/Google OAuth via Supabase Auth)
2.  Creates org, selects industry → sector template pre-populates data inventory
3.  Enters website URL → ConsentShield scans for existing trackers (preview of enforcement)
4.  Configures banner (3 pre-built templates or custom)
5.  Copies <script> tag → pastes into website <head>
6.  Banner goes live → first consent collected
7.  Dashboard shows: first consent + first tracker observation
8.  Compliance score calculated (typically 40–65% after setup)
9.  Action queue: "Fix these 4 gaps" with severity and estimated time
```

---

## 8. Phase 1 Dashboard {#8-phase-1-dashboard}

### Primary sections

**Compliance Score** — large circular gauge with weighted composite. Colour: red (<50), amber (50–80), green (>80). "Last updated: 2 hours ago."

**Enforcement Monitor** — most prominent section:
- Tracker violation count (24h, 7d)
- Specific violations: "Meta Pixel loaded before consent on 847 page views today"
- Trend line: violations over time

**Data Flow Map** — where data goes:
```
Your Website
  ├─→ Google Analytics (US) — analytics ✓
  ├─→ Meta Pixel (US) — marketing ✗ VIOLATION
  ├─→ Razorpay (IN) — functional ✓
  └─→ Hotjar (EU) — analytics ✓
Cross-border: US (2), EU (1). Inventory says "India only" ← DISCREPANCY
```

**Action Queue** — top 5 gaps to fix, severity + estimated time + single CTA

**Recent Activity** — timeline of last 7 days: banner deployed, consent events, violations

**Enforcement Clock** — "Days until full DPDP enforcement: 396"

---

# Part III — Phase 2: Enforcement Depth (Months 3–5)

## 9. Phase 2 Feature Set {#9-phase-2}

| Feature | What it does | DPDP section |
|---|---|---|
| **Data principal rights tracker** | Full lifecycle: erasure, access, correction, nomination. 30-day SLA timer. Auto-reminders at 7 days. Guided response workflow. Identity verification via OTP. Exportable audit trail. | S.11–S.14 |
| **Consent withdrawal verification loop** | After consent_withdrawn, schedules 3 server-side scans (T+15m, T+1h, T+24h). Verifies trackers actually stopped. Violations trigger red alerts. | S.6(3) |
| **Security posture scanning** | Nightly external scan per web property: SSL, headers, vulnerable libraries, mixed content, cookie flags. Signals feed into compliance score. | S.8 (Security safeguards) |
| **Deletion orchestration — generic webhook** | Standardised deletion request/receipt protocol. Customer configures webhook endpoint. ConsentShield sends deletion request, awaits confirmation callback. | S.12 (Erasure) |
| **Deletion orchestration — pre-built connectors** | Direct API integrations: Mailchimp, HubSpot, + 1 based on customer demand. OAuth setup. Automatic deletion with receipt logging. | S.12 |
| **Retention rules with auto-deletion** | Define retention period per data category. Link to connected systems. When period expires: auto-trigger deletion orchestration or alert. | S.8(7) (Retention) |
| **Processing log module** | Continuous append-only log of all processing activities. 1-year minimum retention (in customer storage). Queryable by purpose, category, date range. | DPDP Rules |
| **Multi-property support** | Manage consent across multiple websites/apps from one account. Per-property banners, separate tracker observations, unified compliance score. | Operational |
| **Gap assessment tool (47-question)** | Interactive scored assessment across 7 DPDP categories. Personalised gap report (red/amber/green). Email-gated before results. Primary lead acquisition tool. | Lead gen |
| **Tracker override management** | Customer marks specific domains as functional/exempt. Handles false positives from internal analytics, custom services. | Operational |

---

## 10. Scan Engine — Server-Side Verification {#10-scan-engine}

### What it handles

Two jobs: consent withdrawal verification (verify trackers stopped after withdrawal) and security posture scanning (nightly hygiene checks).

### Architecture choice: lightweight HTTP, not headless browser

Headless browsers (Puppeteer/Playwright) would be ideal but require a persistent server with Chrome. Doesn't fit Vercel's serverless model. Instead: HTTP-based checks that run as Vercel Cron Jobs or Supabase Edge Functions.

### Security posture checks

```
1. HTTP GET customer's URL
2. Inspect response headers (HSTS, CSP, X-Frame-Options, X-Content-Type-Options, Referrer-Policy)
3. Parse HTML for <script> tags, extract src URLs
4. For each external script: check version against known CVE database
5. Check SSL certificate via TLS handshake
6. Check for mixed content (HTTP resources on HTTPS page)
7. Inspect Set-Cookie headers for Secure, HttpOnly, SameSite flags
8. Store results in security_scans table
```

| Signal | Method | Severity if failed |
|---|---|---|
| SSL certificate expired | TLS handshake | Critical |
| Missing HSTS | Response header | Warning |
| Missing CSP | Response header | Warning |
| Vulnerable jQuery/Angular/Lodash | Script version vs CVE DB | Critical |
| Mixed content | HTML parse | Warning |
| Session cookie missing Secure flag | Set-Cookie header | Warning |

### Withdrawal verification

```
After consent_withdrawn event:
1. Schedule scans at T+15m, T+1h, T+24h
2. At each time: HTTP GET customer's page
3. Parse HTML for tracker scripts matching withdrawn purposes
4. Log result to withdrawal_verifications.scan_results
5. If trackers still present: violation alert + compliance score impact
```

Client-side (banner script) catches dynamic trackers. Server-side catches static hardcoded trackers. Together they cover the most important violation patterns.

### Rate: ~300 scans/night for security (200 customers × 1.5 properties), 10–50 withdrawal verifications/day. Well within free tier limits.

---

## 11. Deletion Orchestration {#11-deletion-orchestration}

### Two models

**Model A — Pre-built connectors:** Direct API integrations with OAuth setup.

| Service | API operation | Phase |
|---|---|---|
| Mailchimp | DELETE /lists/{id}/members/{hash} | 2 |
| HubSpot | DELETE /crm/v3/objects/contacts/{id} | 2 |
| Freshdesk | PUT /api/v2/contacts/{id} (anonymise) | 2 |
| Zoho CRM | DELETE /crm/v2/Contacts/{id} | 3 |
| Intercom | POST /user_delete_requests | 3 |
| Clevertap | POST /delete/profiles | 3 |
| WebEngage | DELETE /users/{id} | 3 |
| MoEngage | DELETE /v1/customer/{id} | 3 |
| Shopify | DELETE /customers/{id} | 3 |
| Razorpay | POST /customers/{id}/anonymize | 3 |
| Segment | POST /regulations | 3 |
| Freshworks CRM | DELETE /contacts/{id} | 3 |
| WooCommerce | POST /customers/{id}/anonymize | 3 |

**Model B — Generic webhook protocol:** Universal fallback for any system.

```json
// ConsentShield → Customer webhook
{
  "event": "deletion_request",
  "request_id": "uuid",
  "data_principal": { "identifier": "email_or_id", "identifier_type": "email" },
  "reason": "erasure_request | retention_expired | consent_withdrawn",
  "callback_url": "https://api.consentshield.in/v1/deletion-receipts/{request_id}",
  "deadline": "2026-05-15T00:00:00Z"
}

// Customer → ConsentShield callback
{
  "request_id": "uuid",
  "status": "completed | partial | failed",
  "records_deleted": 47,
  "systems_affected": ["postgres_main", "redis_cache"],
  "completed_at": "2026-05-01T14:32:00Z"
}
```

### Connector interface (standardised across all integrations)

```typescript
interface DeletionConnector {
  id: string;
  displayName: string;
  getAuthUrl(orgId: string): string;
  handleCallback(code: string, orgId: string): Promise<ConnectorConfig>;
  deleteUser(config: ConnectorConfig, identifier: UserIdentifier): Promise<DeletionResult>;
  checkHealth(config: ConnectorConfig): Promise<HealthStatus>;
}
```

### The deletion receipt is the evidence artefact. Every deletion produces an immutable receipt stored in customer storage: what was requested, which systems were contacted, what each confirmed, when.

---

## 12. Phase 2 Data Flows {#12-phase-2-flows}

### Flow 3: Consent Withdrawal → Verification Loop

```
1.  User withdraws marketing consent via banner
2.  consent_withdrawn event POSTed
3.  Banner monitoring: did marketing trackers stop? Immediate violation if not.
4.  Server-side: consent_withdrawn triggers database webhook
5.  Edge Function creates withdrawal_verifications row
6.  Schedules scans: T+15m, T+1h, T+24h
7.  At each time: HTTP GET → parse for trackers → log result
8.  Violations: red alert + email + score impact + audit log
9.  All pass: status = 'verified', audit log = "withdrawal enforced"
```

### Flow 4: Erasure Request → Deletion → Receipts

```
1.  Data principal submits erasure request via public form
2.  Rights request created (status: new, SLA: 30 days)
3.  Compliance manager verifies identity (OTP via Resend)
4.  Reviews data categories, checks retention locks
5.  Approves → clicks "Execute Deletion"
6.  For each connected system:
    a. Pre-built: API call → deletion receipt
    b. Webhook: POST request → await callback → receipt
7.  Dashboard: per-system status (✓ deleted / ✗ failed / ⏳ pending)
8.  All confirmed → rights request = completed → notify data principal
9.  Deletion receipts exported to customer storage
```

### Flow 5: Nightly Security Scan

```
1.  pg_cron at 02:00 IST → Edge Function
2.  For each active web property: HTTP GET → security checks → store results
3.  Compare vs yesterday: new critical → email alert
4.  Dashboard updates on next login
```

---

## 13. Phase 2 Dashboard Additions {#13-phase-2-dashboard}

**Rights Centre** — request inbox with SLA countdown per request. Columns: Name, Type, Date, Days Remaining, Status, Assignee. Guided response workflow.

**Connected Systems** — integration status per connector:
```
Mailchimp     ✓ Connected    Last health check: 2h ago
HubSpot       ✓ Connected    Last health check: 2h ago
Custom CRM    ⚡ Webhook      Last callback: 3d ago
```

**Deletion History** — timeline of all orchestrated deletions with per-system receipts.

**Security Posture** — signal list with severity and remediation:
```
SSL Certificate     ✓ Valid (expires Dec 2026)
HSTS Header         ✗ Missing — add Strict-Transport-Security
Vulnerable Libraries ✗ jQuery 3.3.1 — upgrade to 3.7.1+
```

**Retention Monitor** — data categories with defined retention, days remaining, auto-delete status.

---

# Part IV — Phase 3: Multi-Framework & Ecosystem (Months 6–12)

## 14. Phase 3 Feature Set {#14-phase-3}

| Feature | What it does | Revenue impact |
|---|---|---|
| **GDPR module** | Dual-framework DPDP + GDPR compliance. 60–70% shared infrastructure. GDPR-specific: legal basis documentation, DPIA support, EU representative, SCCs. | Upsell to Pro tier. Customers with EU exposure cannot cancel without losing both frameworks. |
| **Consent probe testing** | Automated synthetic compliance tests. Simulates users with specific consent states, verifies tracker behaviour matches expectations. Scheduled daily/weekly. | Enterprise differentiator. No competitor offers this in India. |
| **Compliance API (REST)** | API key-authenticated access to compliance data. Read consent logs, submit rights requests, query audit trail, trigger deletion. Scoped permissions. | Enables white-label for CA firms. Enterprise integration. |
| **DPO-as-a-Service matchmaking** | Marketplace of empanelled DPOs. Customer browses profiles, requests engagement. ConsentShield earns 15% referral fee. DPO carries legal liability. | Recurring referral revenue. Enterprise retention. |
| **Sector templates** | Pre-configured sets for SaaS, edtech, fintech, ecommerce, healthcare. Pre-mapped data categories, consent purposes, tracker allowlists, privacy notice language. | Reduces onboarding from hours to minutes. |
| **Expanded deletion connectors** | 10 additional pre-built connectors (see Phase 2 table). | Stickiness — more connected systems = harder to leave. |
| **Multi-team roles** | Admin, Compliance Manager, Viewer, Auditor roles. Activity attribution per user. | Enterprise requirement. |

---

## 15. GDPR Module Architecture {#15-gdpr}

### Why the build cost is low

The DPDP infrastructure is 60–70% shared with GDPR. What already exists (consent banner, data inventory, rights workflow, audit export) needs configuration changes, not rebuilds.

### What's GDPR-specific (the 30–40% delta)

**Legal basis documentation.** GDPR has six legal bases for processing (consent, contract, legal obligation, vital interests, public task, legitimate interest). DPDP has essentially two (consent and legitimate uses). The GDPR module adds a legal basis selector per processing purpose, with guided documentation for each basis. Legitimate interest requires a balancing test document — the module generates a template.

**Cookie banner compliance.** GDPR cookie requirements differ from DPDP consent. The banner needs to support: no pre-ticked boxes, equal prominence for accept/reject, granular purpose control, ability to withdraw as easily as to grant. The existing banner already supports most of this; the GDPR layer adds compliance validation rules.

**Data Protection Impact Assessment (DPIA).** For high-risk processing, GDPR requires a DPIA. The module provides a guided DPIA template with risk scoring. Not a full DPIA tool (those are separate products) but enough that a company can produce the document.

**Standard Contractual Clauses (SCCs).** For cross-border transfers outside approved countries, GDPR requires SCCs. The module provides SCC templates and tracks which transfers require them (linked to the cross-border detection from Phase 1).

**EU representative.** Non-EU companies processing EU residents' data must appoint an EU representative. The module tracks this designation and surfaces it in the compliance score.

### Data flow: GDPR rights request (DSAR)

```
1.  EU data subject submits DSAR via rights portal (same portal as DPDP, with framework auto-detection based on requestor location)
2.  ConsentShield identifies: this is a GDPR request (EU IP or explicit selection)
3.  GDPR-specific SLA applied: 30 days (vs DPDP's 30 days — same period, but different legal basis)
4.  Manager follows guided workflow — GDPR adds:
    a. Legal basis verification (what was the basis for processing this person's data?)
    b. Third-country transfer check (was data sent outside EEA without SCCs?)
    c. Automated systems check (was data subject to automated decision-making? GDPR Art. 22)
5.  Response sent. Full audit trail. GDPR-specific export format.
```

### Banner behaviour in dual-framework mode

When a customer enables the GDPR module, the consent banner detects the visitor's location (via Cloudflare's `CF-IPCountry` header, already available in the Worker) and applies the appropriate framework:

- EU visitor → GDPR rules (no pre-ticked boxes, explicit reject option, cookie wall prohibition)
- India visitor → DPDP rules
- Other → customer-configurable default

Both frameworks' consent events are logged separately and exported with framework tags.

---

## 16. Consent Probe Testing Engine {#16-consent-probes}

### What it does

The banner script monitors real user sessions. Consent probes test compliance synthetically — they simulate a user with a specific consent state and verify the website behaves correctly.

### Why it matters

Real-user monitoring is reactive — it detects violations after they happen. Probes are proactive — they test compliance on a schedule, even when no real users are visiting. This is the compliance equivalent of a CI/CD test suite.

### How it works

```
1.  Customer defines probe: "Test full-reject scenario on our marketing site"
    → consent_state: { analytics: false, marketing: false, personalisation: false }
    → schedule: weekly, Sunday 03:00 IST

2.  At scheduled time, Edge Function:
    a. HTTP GET the customer's page URL
    b. Parse HTML for all <script> tags and external resource references
    c. Classify each against tracker signature DB
    d. Evaluate: which of these trackers should NOT load given the consent state?
    e. For trackers embedded in static HTML (always load regardless of consent):
       → Flag as violation if they require consent that isn't granted
    f. Log result to consent_probe_runs table

3.  Result interpretation:
    - PASS: No non-functional trackers found that require ungiven consent
    - FAIL: [list of trackers that would load without required consent]
    - ERROR: Page unreachable, timeout, parse failure

4.  Dashboard: "Consent Probes" section
    - Last 10 run results with pass/fail
    - Trend: pass rate over time
    - Specific failures: "Full-reject probe failed: Google Analytics script in page source loads regardless of consent"
```

### Probe types

| Probe | What it tests | Consent state |
|---|---|---|
| Full accept | Baseline: no violations expected | All purposes: true |
| Full reject | Critical: nothing should fire except functional | All purposes: false |
| Marketing only | Marketing trackers load, analytics don't | analytics: false, marketing: true |
| Analytics only | Analytics load, marketing doesn't | analytics: true, marketing: false |
| Withdrawal | After consent revocation, relevant trackers stop | Transition from true → false |

### Limitation (honest)

Server-side probes check static HTML. They cannot detect dynamically injected trackers loaded via tag managers (GTM, Segment). For those, real-user monitoring (the banner script) is still required. Probes and monitoring are complementary, not redundant.

---

## 17. Compliance API — White-Label & Partner Access {#17-compliance-api}

### Purpose

Enable CA firms, legal tech platforms, and enterprise customers to embed ConsentShield's compliance data into their own systems.

### Authentication

API key-based. Keys are scoped to specific permissions and tied to an organisation.

```
Authorization: Bearer cs_live_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

### Endpoints

```
GET  /api/v1/consent/events          → List consent events (paginated, filterable)
GET  /api/v1/consent/score           → Current compliance score + component breakdown
GET  /api/v1/tracker/observations    → List tracker observations
GET  /api/v1/tracker/violations      → List violations (filterable by date, severity)
GET  /api/v1/rights/requests         → List DSR requests
POST /api/v1/rights/requests         → Create DSR request programmatically
GET  /api/v1/rights/requests/{id}    → Get request detail + event history
POST /api/v1/deletion/trigger        → Trigger deletion orchestration for a data principal
GET  /api/v1/deletion/receipts       → List deletion receipts
GET  /api/v1/audit/export            → Generate and download audit export package
GET  /api/v1/security/scans          → List security scan results
GET  /api/v1/inventory               → Get current data inventory
GET  /api/v1/probes/results          → List consent probe results
```

### Rate limits

Starter: 100 requests/hour. Growth: 1,000/hour. Pro: 10,000/hour. Enterprise: custom.

### Use cases

- **CA firm white-label:** CA firm uses the API to pull compliance status for their clients into their own dashboard. Client never sees ConsentShield branding.
- **Enterprise integration:** Large company pulls compliance data into their existing GRC platform (ServiceNow, Archer, etc.).
- **Automated monitoring:** CI/CD pipeline checks compliance score before deployment — if score drops below threshold, deployment is blocked.

---

## 18. DPO-as-a-Service Matchmaking {#18-dpo}

### The problem it solves

DPDP requires certain organisations to appoint a Data Protection Officer. Most startups and SMEs cannot justify a full-time hire. They need a fractional DPO — a qualified professional available on retainer.

### How it works

```
1.  Customer browses DPO marketplace inside ConsentShield
    → Profiles: name, firm, specialisations, languages, fee range, bio
2.  Customer requests engagement with preferred DPO
3.  ConsentShield sends introduction email to both parties
4.  DPO and customer negotiate terms directly
5.  Once engaged, DPO gets Auditor-role access to customer's ConsentShield dashboard
    → Read-only: compliance score, audit logs, rights requests, enforcement data
    → The DPO uses ConsentShield's data to fulfil their statutory responsibilities
6.  ConsentShield earns 15% referral fee on ongoing engagement
```

### Why this is structurally important

The DPO carries the legal liability for compliance advice. ConsentShield carries the software liability. This boundary is what makes the "compliance infrastructure, not legal advice" positioning defensible. Without a DPO pathway, customers who rely solely on ConsentShield and then face enforcement have nobody to blame but themselves and (by extension) ConsentShield's marketing.

### Onboarding DPOs

Initial target: 5–10 DPOs in Hyderabad/Bangalore with privacy law expertise. Source through the law firm partnership already planned in the design document. Each DPO signs a partner agreement, not an employment contract.

---

## 19. Sector Templates {#19-sector-templates}

### What they contain

Each template pre-configures:

| Component | What's pre-filled |
|---|---|
| Data inventory | Common data categories and flows for the sector |
| Consent purposes | Recommended purpose categories with descriptions |
| Privacy notice | Sector-appropriate language and disclosure sections |
| Tracker allowlist | Functional trackers typical for the sector (exempt from consent enforcement) |
| Risk categories | Highest-risk data categories with penalty exposure notes |
| Retention defaults | Suggested retention periods per data category |

### Template set

| Sector | Key differentiators |
|---|---|
| **SaaS** | API data flows, third-party processor inventory, multi-product consent, cross-border (EU/US customers) |
| **Edtech** | Children's data provisions (parental consent flows, no behavioural advertising, age verification), student record retention |
| **Fintech** | Financial data categories (KYC, transaction, credit), RBI retention requirements, payment processor integrations |
| **E-commerce** | Marketing consent (email, WhatsApp, push), cookie-heavy tracking, customer purchase data, delivery partner data sharing |
| **Healthcare** | Health data categories, ABDM integration points, patient consent specifics, medical record retention (linked to Phase 4) |

### Onboarding with templates

```
1.  Signup → select industry
2.  Template auto-applies:
    a. Data inventory pre-populated (customer reviews and adjusts)
    b. Consent purposes pre-configured (customer customises descriptions)
    c. Privacy notice pre-drafted (customer edits and publishes)
    d. Tracker allowlist applied (functional trackers exempt from enforcement)
3.  Customer goes from signup to first consent in under 30 minutes (vs 2–4 hours without template)
```

---

## 20. Phase 3 Data Flows {#20-phase-3-flows}

### Flow 6: GDPR Dual-Framework Consent

```
1.  Visitor loads customer's website
2.  Cloudflare Worker reads CF-IPCountry header
3.  EU country → banner applies GDPR rules (no pre-ticked, explicit reject)
4.  India → banner applies DPDP rules
5.  Consent event tagged with framework: { framework: 'gdpr' | 'dpdp' }
6.  Tracker monitoring applies framework-appropriate rules
7.  Dashboard shows framework-split analytics: "GDPR visitors: 12% | DPDP: 88%"
```

### Flow 7: Consent Probe Scheduled Run

```
1.  pg_cron fires at probe's scheduled time
2.  Edge Function fetches page, parses scripts, classifies against signature DB
3.  Evaluates against probe's consent state
4.  Writes result to consent_probe_runs
5.  If FAIL: email alert + dashboard notification
6.  Weekly summary: "4/5 probes passed. Full-reject probe failed: GA script hardcoded."
```

### Flow 8: API-Driven White-Label Rights Request

```
1.  CA firm's dashboard calls POST /api/v1/rights/requests
    → API key scoped to their client's org
2.  ConsentShield creates rights request, starts SLA timer
3.  CA firm's dashboard polls GET /api/v1/rights/requests/{id} for status
4.  Customer's compliance manager processes via ConsentShield dashboard
5.  CA firm's dashboard reflects status updates in real time
```

---

# Part V — Phase 4: Healthcare & Enterprise (Months 12–18)

## 21. Phase 4 Feature Set {#21-phase-4}

| Feature | What it does | Revenue impact |
|---|---|---|
| **ABDM healthcare bundle** | Unified DPDP + ABDM compliance for clinics. ABHA lookup, consent artefact, record pull, prescription upload, patient queue, drug interaction AI. | Premium pricing: ₹6,000–8,000/month per clinic. New vertical. |
| **Cross-border data transfer module** | Formal declaration and tracking of cross-border transfers. Auto-detected flows (from tracker data) merged with manual declarations. SCC tracking for GDPR. | Enterprise requirement. Audit completeness. |
| **Enterprise white-label platform** | Custom branding, custom domains (banner CDN + rights portal), custom email sender, multi-team roles with granular permissions. | Enterprise tier: ₹24,999+/month. CA firm white-label. |
| **Responsive compliance views** | Dashboard and rights inbox optimised for mobile browsers. Quick-glance compliance score, rights request approve/reject from a phone. No native app — no install friction, no app store dependency. | Accessible from any device without installation. |
| **Notification channels** | Email alerts (Resend), Slack/Teams/Discord webhook integrations, custom webhook for PagerDuty/OpsGenie. Configurable per alert type. Replaces push notifications without a native app. | Alerts reach founders where they already work. |
| **Expanded deletion connectors** | Full 13-connector set (see Phase 2 table). | Operational completeness. |

---

## 22. ABDM Healthcare Bundle Architecture {#22-abdm}

### Scope: Option B — Consent + Light Workflow

| Component | Description |
|---|---|
| ABHA ID lookup | Search patient by ABHA address or QR code scan |
| ABDM consent artefact | Generate and manage consent artefacts for health record access |
| Consent-gated record pull | 3 taps: ABHA → consent → records. FHIR R4 compliant. |
| ABDM-linked prescription writer | Auto-populates from pulled medication history. Not a general prescription writer — only functions after ABDM record pull. |
| Digital prescription upload | Upload back to ABDM, making the clinic a Health Information Provider (HIP) |
| Patient queue management | Daily queue with consent status per patient. Touch-optimised for clinic use. |
| Drug interaction AI check | Anthropic API (zero data retention tier). Checks pulled medication history against new prescription for interactions. |
| WhatsApp follow-up scheduler | Schedule follow-up messages via WhatsApp Business API |
| Unified DPDP + ABDM audit log | Single audit trail covering both compliance frameworks |

### Data architecture: zero persistence for health data

Health data (FHIR records) flows through ConsentShield in memory only. No schema, no table, no log ever holds FHIR content. The only durable writes from an ABDM session:

- Consent artefact index entries (artefact ID + validity state, no clinical data)
- Prescription metadata (document reference ID + upload status, no clinical content)
- Drug interaction flags (severity level only, no medication names)
- Audit entries (timestamps and purpose references only)

```
Patient's ABHA app → NHA Gateway → ConsentShield (in memory)
    → Display records to doctor (browser only, never persisted)
    → Drug interaction check via Anthropic API (zero retention)
    → Prescription generated → uploaded to ABDM via NHA Gateway
    → Audit entry written (timestamps only)
    → FHIR data released from memory
```

### ABDM integration flow

```
1.  Receptionist adds patient to queue (name + ABHA ID or QR scan)
2.  Doctor opens patient → taps "Pull Records"
3.  ConsentShield generates ABDM consent request
    → Sent to patient's ABHA app via NHA Gateway
4.  Patient approves on their phone
5.  NHA Gateway sends consent artefact to ConsentShield
6.  ConsentShield pulls health records via FHIR R4
    → Records displayed in browser, held in memory only
7.  Doctor reviews records. Taps "New Prescription"
8.  Prescription form auto-populates from medication history
9.  AI drug interaction check runs (Anthropic API, zero retention)
    → If interaction detected: warning displayed with severity
10. Doctor completes prescription → taps "Send to ABDM"
11. Prescription uploaded as FHIR document to NHA Gateway
12. Patient queue entry updated: consent ✓, records pulled ✓, prescription uploaded ✓
13. DPDP audit entry: timestamps, purpose, consent artefact reference. No clinical content.
```

### Clinic-Facing Web Interface

The ABDM workflow runs as a responsive web application optimised for tablet use at the clinic front desk. No native mobile app is required for Phases 1–3. A native app (React Native) enters scope only if Phase 4 clinic pilots validate that PWA camera limitations on iOS genuinely block the ABHA QR scan workflow in real clinic conditions. Until then, the web app handles:

- Patient queue management (touch-optimised for tablet)
- ABHA ID lookup (manual entry; QR scan via web camera API where browser supports it)
- Consent-gated record display
- Prescription workflow
- Compliance score at a glance

For alerts (rights requests, SLA warnings, breach events), the notification channel system (email + Slack/Teams webhooks) replaces push notifications. Clinic staff receive alerts wherever they already work — email for doctors, Slack/Teams for office managers.

### Competitive position

No existing product owns the intersection of full ABDM (consent artefact + record pull + HIP upload) + full DPDP (notice, consent, rights, breach workflow, audit log) + AI layer (drug interaction) — as of April 2026.

- **Practo Ray:** Partial ABHA integration (lookup only), no consent artefact flow, no DPDP layer
- **HealthPlix:** No ABDM consent artefacts, no DPDP. Free model makes premium compliance features structurally hard to add
- **Eka.Care:** Real ABDM integration but targets hospitals (10+ beds), not single-doctor clinics
- **Docon:** Basic ABHA ID support only, no DPDP

### Honest caveats from the critical examination

- Production readiness is 18–24 weeks, not 8–12. FHIR R4 compliance requires NHA review. Edge cases are numerous.
- The person using the software is likely a receptionist, not the doctor. The habit loop assumption needs field validation.
- Clinics don't know they need DPDP compliance. Sales cycle is longer and more expensive than projected.
- 3 clinics must commit to a paid pilot in writing before any code is written. Sales before code.

---

## 23. Cross-Border Data Transfer Module {#23-cross-border}

### What it does

DPDP Section 16 regulates data transfers outside India. This module formally tracks and documents all cross-border transfers — both auto-detected and manually declared.

### Auto-detection (from Phase 1 tracker system)

The tracker observation system already identifies third-party services and their data storage locations. This module formalises that data:

```
Tracker detection → Geographic classification → Auto-create cross_border_transfers row
    → Dashboard: "Auto-detected transfer: Google Analytics sends data to US"
    → Customer action: confirm, add safeguards description, or remove if inaccurate
```

### Manual declaration

For non-web data flows (API integrations, cloud hosting, third-party processors), customers declare transfers manually:

```
Add Transfer:
  Destination: United States
  Entity: Amazon Web Services (hosting)
  Data categories: [User accounts, Transaction logs]
  Legal basis: Government-approved country (if listed) / Contractual safeguards
  Safeguards: Standard data processing agreement, encryption at rest and in transit
```

### GDPR integration (Phase 3 customers)

For customers with the GDPR module enabled, cross-border transfers outside the EEA require Standard Contractual Clauses. The module:

1. Identifies which auto-detected transfers involve non-EEA destinations
2. Flags transfers that lack SCC documentation
3. Provides SCC templates (EU Commission's 2021 standard clauses)
4. Tracks SCC status per transfer: "SCC signed / SCC pending / SCC not required"

### Dashboard: Transfer Map

```
India (origin)
  ├─→ United States
  │   ├─ Google Analytics (auto-detected, analytics data)
  │   ├─ AWS us-east-1 (declared, all customer data)
  │   └─ Mailchimp (declared, marketing contacts)
  │   Safeguards: DPA signed with all three. SCC with Google and AWS.
  │
  ├─→ European Union
  │   └─ Hotjar (auto-detected, analytics data)
  │   Safeguards: GDPR-adequate jurisdiction. No SCC required.
  │
  └─→ Singapore
      └─ Cloudflare CDN (auto-detected, request logs)
      Safeguards: DPA signed. SCC pending.
```

---

## 24. Enterprise & White-Label Platform {#24-enterprise}

### Enterprise tier features

| Feature | Description |
|---|---|
| **Custom branding** | Logo, colours, email sender name. Dashboard shows customer's brand, not ConsentShield. |
| **Custom domains** | Banner CDN: `consent.clientdomain.com`. Rights portal: `privacy.clientdomain.com`. Requires Cloudflare CNAME setup. |
| **Multi-team roles** | Admin: full access. Compliance Manager: operational access. Viewer: read-only. Auditor: read-only + export. DPO: extended read + advisory notes. |
| **SSO integration** | SAML/OIDC for enterprise identity providers. Supabase Auth supports this via third-party providers. |
| **Custom SLA** | Guaranteed response times for support. Named account manager. |
| **Compliance API** | Full API access for integration with existing GRC tools. |
| **Dedicated export storage** | Customer provides their own S3/R2 bucket. ConsentShield writes with write-only credentials. |

### White-label for CA firms

The CA firm partner program uses the enterprise tier with additional configurations:

```
CA Firm's Dashboard (their branding)
    │
    ├─ Client 1 → ConsentShield org (CA has admin access)
    ├─ Client 2 → ConsentShield org
    ├─ Client 3 → ConsentShield org
    └─ Client N → ConsentShield org
    
CA sees: aggregate compliance across all clients
Client sees: their own dashboard with CA firm's branding
ConsentShield sees: revenue from all orgs, 30% share to CA firm
```

The Compliance API (Section 17) is the technical enabler. The CA firm's custom dashboard calls the API to pull compliance data for each client.

---

## 25. Phase 4 Data Flows {#25-phase-4-flows}

### Flow 9: ABDM Patient Consultation (full cycle)

```
1.  Receptionist opens patient queue on tablet
2.  Adds patient: name + ABHA ID (manual entry or QR scan via tablet camera)
3.  Patient appears in queue (status: waiting)
4.  Doctor opens patient → "Pull Records"
5.  ABDM consent request → patient's ABHA app
6.  Patient approves → consent artefact received
7.  FHIR records pulled → displayed in browser (memory only)
8.  Doctor reviews → "New Prescription"
9.  Auto-populated from medication history
10. Drug interaction check (Anthropic API, zero retention)
11. Doctor finalises → "Upload to ABDM"
12. Prescription uploaded as FHIR document
13. Queue entry: completed. Audit log: timestamped, no clinical data.
14. WhatsApp follow-up scheduled (if configured)
```

### Flow 10: Enterprise White-Label Setup

```
1.  Enterprise customer subscribes to Enterprise tier
2.  Configures white-label: brand name, logo, colours
3.  Sets up custom domains:
    a. consent.clientdomain.com → CNAME to ConsentShield Cloudflare
    b. privacy.clientdomain.com → CNAME to ConsentShield Vercel
4.  Provides export storage bucket (S3/R2) with write-only credentials
5.  Creates API key for GRC integration
6.  Configures team roles: assigns Compliance Manager, Viewer, DPO access
7.  All customer-facing surfaces show enterprise branding
```

---

# Part VI — Delivery

## 26. Complete Build Timeline — All Phases {#26-timeline}

### Phase 1: Enforcement MVP — Weeks 1–8

| Week | Development | Operations |
|---|---|---|
| 1–2 | Supabase schema (all Phase 1+2 tables) + RLS policies. Auth flow. Next.js shell. Razorpay integration. | Review every RLS policy. Set up Supabase, Vercel, Cloudflare, Resend. Register domain. |
| 2–4 | Cloudflare Worker (banner delivery, consent events, observations). Banner script v2 with monitoring. Banner builder UI. Snippet checker. | Curate tracker signature DB (visit 50 Indian sites). Test banner on 20+ sites. Calibrate false positives. |
| 4–6 | Dashboard with v2 scoring. Enforcement monitor. Data flow map. Data inventory (auto-seeded). Privacy notice generator. Breach workflow. | Write compliance copy. Test scoring formula. Design onboarding. |
| 6–8 | Audit export (PDF). Gap assessment tool. Landing page. Email templates. Responsive dashboard and rights inbox views. | End-to-end testing. Security review. Newsletter content. Soft launch outreach. |

### Phase 2: Enforcement Depth — Months 3–5

| Period | Development | Operations |
|---|---|---|
| Month 3 | Rights request management (SLA, guided workflow, OTP verification). Withdrawal verification loop (Edge Function, scheduling, scanning). Processing log module. | Customer conversations. Determine which deletion connector to build third. Monitor tracker false positives. |
| Month 4 | Security posture scanner. Generic webhook deletion protocol. Pre-built connectors (Mailchimp, HubSpot). Multi-property support. | Test deletion against real Mailchimp/HubSpot accounts. Calibrate security severity thresholds. Begin CA firm outreach. |
| Month 5 | Retention rules UI + scheduled checks. Tracker override UI. Third pre-built connector. Gap assessment lead capture integration. | Customer feedback integration. Adjust pricing if needed. Begin DPO partner recruitment. |

### Phase 3: Multi-Framework & Ecosystem — Months 6–12

| Period | Development | Operations |
|---|---|---|
| Month 6–7 | GDPR module (legal basis documentation, DPIA template, SCC tracking, dual-framework banner logic). Sector templates (SaaS, edtech, ecommerce). | Legal review of GDPR templates. Build sector template content (data categories, consent purposes, privacy notice language). |
| Month 8–9 | Consent probe testing engine. Compliance API (all endpoints, API key management, rate limiting). Multi-team roles. | Onboard first 5 DPO partners. Set up CA firm white-label pilot. Test consent probes on 20+ customer sites. |
| Month 10–12 | DPO marketplace UI. 5 additional deletion connectors. Cross-border transfer module (auto-detect + manual + SCC tracking). White-label configuration UI. | Expand DPO network. Customer case studies. Refine API documentation. Begin ABDM clinic conversations. |

### Phase 4: Healthcare & Enterprise — Months 12–18

| Period | Development | Operations |
|---|---|---|
| Month 12–14 | ABDM sandbox integration (ABHA lookup, consent artefact, record pull). Patient queue (tablet-optimised web). Enterprise white-label (custom domains, branding). | NHA sandbox onboarding. Identify 3 pilot clinics. Begin field testing. SSO integration testing with enterprise prospects. |
| Month 14–16 | ABDM production integration (FHIR R4, HIP upload, prescription writer). Drug interaction AI. WhatsApp follow-up. Notification channel webhooks (Slack, Teams, Discord). | NHA production review. Pilot clinic deployment. Debug FHIR edge cases. Support pilot clinics. |
| Month 16–18 | Remaining deletion connectors. Clinic web interface polish. Enterprise SSO. Final API endpoints. | Scale clinic sales (IMA-Telangana channel). Enterprise sales conversations. Full product documentation. Evaluate native app need based on pilot feedback. |

### The honest constraint across all phases

Code is never the bottleneck. The bottlenecks across all four phases are:

1. **Third-party integration testing** — every API has undocumented quirks
2. **Tracker signature curation** — editorial research, not engineering
3. **Security review** — every RLS policy, every data flow, every append-only constraint
4. **NHA/ABDM regulatory process** — sandbox to production takes months, not weeks
5. **Sales and customer conversations** — trust takes months, code ships in hours
6. **Legal review** — GDPR templates, DPIA content, SCC templates need legal eyes
7. **False positive calibration** — ongoing across all phases

---

## 27. Revised Pricing Across All Tiers {#27-pricing}

| | Starter ₹2,999/mo | Growth ₹5,999/mo | Pro ₹9,999/mo | Enterprise ₹24,999+/mo |
|---|---|---|---|---|
| **Web properties** | 1 | 3 | 10 | Unlimited |
| **Consent banner + monitoring** | ✓ | ✓ | ✓ | ✓ |
| **Tracker detection + enforcement** | ✓ | ✓ | ✓ | ✓ |
| **Privacy notice generator** | ✓ | ✓ | ✓ | ✓ |
| **Data inventory (auto-seeded)** | ✓ | ✓ | ✓ | ✓ |
| **Breach notification workflow** | ✓ | ✓ | ✓ | ✓ |
| **Compliance dashboard v2** | ✓ | ✓ | ✓ | ✓ |
| **Audit export** | Basic | Full | Full | Full |
| **Rights request tracker** | — | ✓ | ✓ | ✓ |
| **Withdrawal verification** | — | ✓ | ✓ | ✓ |
| **Security posture scanning** | — | ✓ | ✓ | ✓ |
| **Processing log (1-year)** | — | ✓ | ✓ | ✓ |
| **Deletion orchestration** | — | 3 connectors | 13 connectors | Unlimited |
| **Retention rules** | — | ✓ | ✓ | ✓ |
| **GDPR module** | — | — | ✓ | ✓ |
| **Consent probe testing** | — | — | ✓ | ✓ |
| **Sector templates** | — | — | ✓ | ✓ |
| **Compliance API** | — | — | ✓ (10K/hr) | ✓ (custom) |
| **Multi-team roles** | — | — | ✓ | ✓ |
| **DPO matchmaking** | — | — | — | ✓ |
| **White-label / custom domains** | — | — | — | ✓ |
| **Cross-border transfer module** | — | — | — | ✓ |
| **ABDM healthcare bundle** | — | — | — | Add-on ₹4,999/mo |
| **Support** | Email | Priority | Dedicated call | Named manager |

**ABDM standalone for clinics:** ₹4,999/mo (single-doctor) to ₹8,000/mo (group practice).

**CA/Legal firm white-label:** 30% revenue share on referred accounts. No upfront fee.

**Annual discount:** 20% off (2 months free) on any tier.

---

## 28. The Partner Proposition {#28-partner}

### What the solo developer brings

- Complete product: designed, architected, and built across all four phases
- Rapid development capability across all four phases
- Domain expertise: deep understanding of DPDP, GDPR, and ABDM technical requirements
- Technical architecture: stateless oracle model, multi-tenant isolation, enforcement engine

### What the partner company needs to bring

| Requirement | Why it's needed |
|---|---|
| **₹2 crore net worth** | Consent Manager registration under DPDP Rule 3 |
| **Indian incorporation** | Regulatory requirement for Consent Manager |
| **Customer-facing support team** | Solo developer cannot handle support at scale. Minimum 1 person from Month 5. |
| **Sales and marketing** | Content distribution, SaaSBoomi presence, CA firm partnerships, clinic outreach |
| **Legal entity for contracts** | DPAs, customer agreements, DPO partner agreements require a legal entity |
| **Regulatory liaison** | DPB interactions, NHA liaison for ABDM, compliance certifications |

### The arrangement

This is not a full merger or acquisition. It is a partnership where:

- Developer builds and maintains the platform
- Partner company operates the Consent Manager registration
- Partner company hires/manages support and sales
- Revenue split: negotiable, but the software is the product — the partner is the go-to-market engine
- IP ownership: negotiable, but code should have clear ownership from day one

### What the partner sees in this document

A complete platform specification — from database schema to UI flows to honest build timelines — covering DPDP compliance (the immediate market), GDPR (the expansion market), and ABDM healthcare (the premium vertical). The enforcement engine model is genuinely differentiated: no other India-focused tool monitors actual consent enforcement, orchestrates deletion across systems, and runs synthetic compliance probes.

The window to enter this market is approximately 12 months before large incumbents arrive. The product is designed to be built in 18 months across four phases, with paying customers from Month 3. The partner's investment is operational (team + registration), not R&D — the R&D is done.

---

## 29. What Remains Out of Scope {#29-out-of-scope}

| Capability | Why out of scope | Alternative |
|---|---|---|
| Database scanning | Trust barrier too high for non-enterprise product | Tracker detection (web) + self-reported (backend) |
| API middleware / traffic proxy | Changes integration model from "script tag" to "infrastructure dependency" | Webhook-based deletion protocol |
| Full security audit | Requires certified expertise and liability | External signals only; recommend third-party audits |
| Legal advice | Legal liability sits with qualified professionals | DPO matchmaking; tooling + disclaimer |
| Verifiable parental consent | Unsolved problem globally | Age-gating + separate flow; don't claim "verifiable" |
| Real-time processing block | Requires being in customer's critical path | Detect → alert → remediate, not block |
| Full EMR for clinics | Competing against funded 20+ person teams | Option B only: consent-gated workflow, not general EMR |
| Native mobile app (Phases 1–3) | No workflow justifies install friction for SaaS/edtech/ecommerce customers | Responsive web views + email/Slack/Teams notification channels. Native app enters scope only if Phase 4 clinic pilots prove web camera API is insufficient for ABHA QR scan. |
| Patient-facing app | ABDM consent already runs on patient's ABHA app | No duplicate app needed |

### The complete positioning

ConsentShield across all four phases is:

> *India's first compliance enforcement engine for the DPDP Act. We don't just document your compliance — we monitor it in real time, verify it with automated probes, orchestrate data deletion across your systems, and produce the enforcement evidence that proves it to the Data Protection Board. For companies with EU exposure: dual-framework DPDP + GDPR from a single dashboard. For clinics: unified ABDM + DPDP compliance with consent-gated health record access. For enterprises: white-label the platform under your brand. For CA firms: give your clients tooling, not just advice.*

---

*Document prepared April 2026. This is the complete product blueprint for ConsentShield, covering all four phases from enforcement MVP through healthcare and enterprise. Designed for partner evaluation and joint go-to-market planning.*
