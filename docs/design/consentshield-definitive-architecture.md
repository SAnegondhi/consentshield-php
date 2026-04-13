# ConsentShield — Definitive Architecture Reference

*(c) 2026 Sudhindra Anegondhi a.d.sudhindra@gmail.com*
*Source of truth for all development · April 2026*
*Supersedes: consentshield-technical-architecture.md, consentshield-stateless-oracle-architecture.md*

---

## Document Purpose

This is the single authoritative technical document for ConsentShield. Every architectural decision, every data flow, every security rule, every integration contract is specified here. If something contradicts this document, this document wins.

---

## 1. Architectural Identity

ConsentShield is a **stateless compliance oracle**. It processes consent events, generates compliance evidence, and delivers the canonical record to the customer's own storage. It does not hold the compliance record — the customer does.

Three design principles flow from this identity:

**Principle 1 — Process, deliver, delete.** Every piece of user data that enters ConsentShield exits to customer storage within minutes. ConsentShield's buffer tables are write-ahead logs, not databases. A row that has been delivered and confirmed has zero reason to exist. It is deleted immediately, not on a schedule.

**Principle 2 — The customer is the system of record.** Dashboard views may read from buffer tables for real-time display. Compliance exports, audit packages, and any DPB-facing artefact must read from — or direct users to — customer-owned storage. Any code path that treats ConsentShield's buffer as the canonical record is architecturally wrong.

**Principle 3 — ConsentShield is a Data Processor, not a Data Fiduciary.** This is not a legal nicety. Under DPDP, a Fiduciary faces ₹250 crore per violation. A Processor that accumulates a centralised record of everything it processes starts looking like a Fiduciary. The stateless oracle architecture ensures ConsentShield never crosses that line.

---

## 2. Stack Overview

| Layer | Technology | Purpose | Access Level |
|---|---|---|---|
| Frontend | Next.js 14 + TypeScript + Tailwind + shadcn/ui | Web application | User-facing |
| Auth | Supabase Auth | Email, magic link, Google OAuth | Integrated with DB RLS |
| Database | Supabase Postgres | Operational state store | RLS-enforced multi-tenancy |
| Edge Functions | Supabase Edge Functions (Deno) | Async: delivery, SLA reminders, scans, deletion orchestration | Service role only |
| Banner + Monitoring | Cloudflare Worker + KV | cdn.consentshield.in — banner.js delivery, consent event ingestion, tracker observation ingestion | Public endpoints |
| Scan Engine | Vercel Cron + HTTP checks | Withdrawal verification, security posture scans | Service role only |
| Notification Channels | Resend (email) + Slack/Teams/Discord webhooks | Compliance alerts | Service role only |
| Tracker Signature DB | Versioned JSON, embedded in banner script | Tracker classification intelligence | Read-only, shipped in banner |
| Billing | Razorpay Subscriptions | INR plans, auto-renewal | Server-side only |
| Customer Storage | Cloudflare R2 (default) or AWS S3 (BYOS) | Canonical compliance record | Write-only from ConsentShield |
| Monitoring | Sentry + Vercel Analytics | Error tracking, performance | Server-side only |

### The fundamental architectural decision

Supabase Auth and Supabase Postgres are the same system. The `auth.uid()` and `auth.jwt()` functions are available inside every RLS policy. Multi-tenant isolation is enforced at the database level, not in application code. Every query runs the policy — there is no way to forget it.

---

## 3. Data Classification

Every table in ConsentShield's database belongs to exactly one of two categories. This distinction is the single most important thing to understand before touching any code.

### Category A — Operational State (permanent)

Data that ConsentShield needs to function. Organisation configs, banner settings, billing records, team membership, tracker signature definitions. This is standard SaaS business data — no different from what any B2B tool holds about its paying users. It stays in ConsentShield's database permanently.

**Org-scoped tables:** organisations, organisation_members, web_properties, consent_banners, data_inventory, tracker_overrides, integration_connectors, retention_rules, export_configurations, consent_artefact_index, api_keys, breach_notifications, rights_requests, consent_probes, cross_border_transfers, gdpr_configurations, dpo_engagements, white_label_configs, notification_channels

**Global reference tables (no org_id):** tracker_signatures, sector_templates, dpo_partners

### Category B — User Data Buffer (transient)

Personal data of data principals that flows through ConsentShield on its way to customer-owned storage. Consent events, audit log entries, tracker observations, deletion receipts, processing log entries, security scan results, withdrawal verification results. This data is buffered only to guarantee delivery. Once customer storage confirms the write, ConsentShield's copy is deleted.

**Tables:** consent_events, tracker_observations, audit_log, processing_log, delivery_buffer, rights_request_events, deletion_receipts, security_scans, withdrawal_verifications, consent_probe_runs

### Category C — Health Data (zero persistence)

FHIR records from ABDM. Never written to any table, any log, any file. Flows through ConsentShield's server in memory only. Processed (drug interaction check, prescription template), then released. Any code that attempts to persist FHIR content is rejected in review without exception.

---

## 4. Processing Modes

The storage_mode on the organisations table determines the data handling path. This check runs at the API gateway level before any data write.

| Mode | What ConsentShield Holds | Customer Storage | Who Manages Storage |
|---|---|---|---|
| **Standard** | Operational config + encrypted buffer | ConsentShield-provisioned R2 bucket, per-customer encryption key (delivered once, discarded) | ConsentShield provisions; customer holds key |
| **Insulated** | Operational config only | Customer's own R2 or S3 bucket. Write-only credential from ConsentShield. Cannot read, list, or delete. | Customer manages |
| **Zero-Storage** | Consent artefact index (TTL) + delivery buffer (seconds) | Customer's own bucket. Data flows through memory only. | Customer manages |

Zero-Storage is mandatory for health data. Insulated is the default for Growth tier and above. Standard is for Starter tier customers who cannot provision their own bucket.

---

## 5. Multi-Tenant Isolation

### 5.1 JWT Custom Claims

After signup and org creation, `org_id` and `org_role` are injected into every JWT via Supabase's custom access token hook:

```sql
create or replace function public.custom_access_token_hook(event jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  claims jsonb; org_id uuid; org_role text;
begin
  claims := event -> 'claims';
  select om.org_id, om.role into org_id, org_role
  from organisation_members om where om.user_id = (event ->> 'user_id')::uuid limit 1;
  if org_id is not null then
    claims := jsonb_set(claims, '{org_id}', to_jsonb(org_id::text));
    claims := jsonb_set(claims, '{org_role}', to_jsonb(org_role));
  end if;
  return jsonb_set(event, '{claims}', claims);
end; $$;

grant execute on function public.custom_access_token_hook to supabase_auth_admin;
```

### 5.2 RLS Helper Functions

```sql
create or replace function current_org_id() returns uuid language sql stable as $$
  select (auth.jwt() ->> 'org_id')::uuid;
$$;

create or replace function is_org_admin() returns boolean language sql stable as $$
  select (auth.jwt() ->> 'org_role') = 'admin';
$$;
```

### 5.3 Isolation Enforcement Pattern

Every table follows one of three RLS patterns:

**Pattern 1 — Org-scoped read/write (operational tables):**
```sql
create policy "org select" on [table] for select using (org_id = current_org_id());
create policy "org insert" on [table] for insert with check (org_id = current_org_id());
create policy "org update" on [table] for update using (org_id = current_org_id());
```

**Pattern 2 — Org-scoped read-only (buffer tables written by service role):**
```sql
create policy "org select" on [table] for select using (org_id = current_org_id());
-- NO insert, update, or delete policy for authenticated users
-- Writes come exclusively from service role (bypasses RLS)
```

**Pattern 3 — Public insert, org-scoped read (rights requests):**
```sql
create policy "org select" on rights_requests for select using (org_id = current_org_id());
create policy "org update" on rights_requests for update using (org_id = current_org_id());
create policy "public insert" on rights_requests for insert with check (true);
-- Rate-limited at API layer: 5 requests/IP/hour
```

### 5.4 Scoped Database Roles (Principle of Least Privilege)

The previous architecture used a single service role key for all server-side operations. That is replaced with three scoped roles, each with the minimum permissions required for its function. The full service role key is retained only for schema migrations and manual admin operations — never in running application code.

**Role: cs_worker** (used by Cloudflare Worker)

```
CAN INSERT: consent_events, tracker_observations
CAN SELECT: consent_banners, web_properties (to serve banner config and verify signing secret)
CAN UPDATE: web_properties.snippet_last_seen_at only
CANNOT: read organisations, rights_requests, integration_connectors, audit_log, or any other table
```

If the Worker credential leaks, the attacker can insert garbage consent events but cannot read any customer data, any configuration, or any credentials. That is vandalism, not theft.

**Role: cs_delivery** (used by the delivery Edge Function)

```
CAN SELECT: all buffer tables (application-level convention: query WHERE delivered_at IS NULL)
CAN UPDATE: delivered_at column on all buffer tables
CAN DELETE: all buffer tables (application-level convention: only rows WHERE delivered_at IS NOT NULL)
CAN SELECT: export_configurations (to read storage credentials for delivery)
CAN DELETE: consent_artefact_index (expired entries)
CANNOT: read organisations, integration_connectors, consent_banners, or any operational table
```

If the delivery credential leaks, the attacker can read in-flight buffer rows (minutes of data, hashed/truncated) and export configuration (encrypted credentials they can't decrypt). They cannot access any operational data.

**Role: cs_orchestrator** (used by all other Edge Functions)

The following is a summary of security-relevant permissions. See consentshield-complete-schema-design.md Section 5.1 for the complete GRANT list.

```
CAN INSERT: audit_log, processing_log, rights_request_events, deletion_receipts,
            withdrawal_verifications, security_scans, consent_probe_runs, delivery_buffer
CAN SELECT: organisations, organisation_members, web_properties, integration_connectors,
            retention_rules, notification_channels, rights_requests, consent_artefact_index,
            consent_probes, data_inventory
CAN UPDATE: rights_requests.status/assignee_id, consent_artefact_index.validity_state,
            organisations.plan/plan_started_at/razorpay fields,
            consent_probes scheduling fields, integration_connectors health fields,
            retention_rules check fields, deletion_receipts status fields,
            withdrawal_verifications scan fields
CANNOT: read consent_events, tracker_observations directly. Cannot delete any row.
```

**The full service_role key** is never used in running application code. It exists for:
- Schema migrations
- Manual database administration
- Emergency debugging (logged, audited, requires justification)

Each role gets its own Supabase database password stored as a separate environment variable.

---

## 6. The Consent Banner — Edge Architecture

### 6.1 Cloudflare Worker (cdn.consentshield.in)

The Worker handles three routes:

```
GET  /v1/banner.js          → Serve compiled banner script (with monitoring)
POST /v1/events             → Ingest consent event
POST /v1/observations       → Ingest tracker observation report
GET  /v1/health             → Health check
```

### 6.2 KV Store

```
banner:config:{propertyId}           → JSON banner config (includes allowed_origins), TTL 300s
banner:script:{propertyId}:{version} → Compiled banner.js string, TTL 3600s
banner:signing_secret:{propertyId}   → Current HMAC signing secret for event validation, TTL matches banner version
snippet:verified:{propertyId}        → '1' on each successful load, TTL 600s
```

### 6.3 Banner Script v2

The compiled script is a self-contained vanilla JS file (~26KB gzipped, zero npm dependencies). It performs two functions:

**Consent capture:** Render banner → capture user decision → compute HMAC signature → POST consent event → store in localStorage → dismiss banner.

**Tracker monitoring:** After consent resolves, start MutationObserver (DOM script injection) + PerformanceObserver (resource timing). 5-second initial observation window, 60-second extended window. Classify detected trackers against embedded signature database. Compare against consent state. POST observation report with any violations.

The compiled script includes the per-property HMAC signing secret (from `web_properties.event_signing_secret`). The secret rotates with each banner version. When a customer publishes a new banner, a new secret is generated, compiled into the new script, and the old secret is invalidated after a 1-hour grace period (to handle cached scripts).

### 6.4 Consent Event Ingestion

The Worker performs four validation steps before writing:

```
1. ORIGIN VALIDATION
   — Read Origin/Referer header from request
   — Compare against allowed_origins from banner config (cached in KV)
   — Match → proceed
   — Missing (server-side request) → proceed but flag payload as origin_unverified
   — Mismatch → reject with 403

2. HMAC VERIFICATION
   — Extract signature and timestamp from request body
   — Verify timestamp is within ±5 minutes of now (prevents replay attacks)
   — Compute HMAC-SHA256(org_id + property_id + timestamp, signing_secret)
   — Compare against provided signature
   — Match → proceed
   — Mismatch → reject with 403

3. PAYLOAD VALIDATION
   — Validate required fields: org_id, property_id, banner_id, event_type
   — Validate event_type is a known value
   — Truncate IP (remove last octet), hash user agent

4. WRITE (using cs_worker role — NOT service role)
   — INSERT into consent_events buffer
   — Return 202 immediately — a failed write must never break the user's browsing session
   — Dispatch delivery to customer storage asynchronously
```

### 6.5 Observation Report Ingestion

Same four-step validation as consent events (origin, HMAC, payload, write). HMAC uses the same per-property signing secret. Writes to tracker_observations buffer via cs_worker role.

### 6.6 Worker Rate Limiting

Configured in the Cloudflare dashboard (not in Worker code):

| Route | Limit | Action |
|---|---|---|
| POST /v1/events | 200 requests per IP per minute | Return 429 |
| POST /v1/observations | 100 requests per IP per minute | Return 429 |
| GET /v1/banner.js | 1000 requests per IP per minute | Return 429 |

These thresholds are generous for legitimate use (a single IP won't generate more than a handful of consent events). The HMAC signing (step 2 above) handles determined attackers who use distributed IPs — the rate limit handles casual abuse.

---

## 7. The Stateless Oracle Pipeline

This is the core data flow for all user data.

```
Event source (Worker, Edge Function, API route)
    │
    ▼
Buffer table (consent_events, audit_log, tracker_observations, etc.)
    │  Row created with delivered_at = null
    │
    ▼
Delivery Edge Function
    │  Reads undelivered rows
    │  Writes to customer storage (R2/S3)
    │  On confirmed write:
    │    → SET delivered_at = now() on the buffer row
    │    → Hard-delete the row immediately
    │  On failed write:
    │    → Increment attempt_count
    │    → Log delivery_error
    │    → Retry per backoff schedule
    │    → After 10 failures: alert, hold for manual review
    │
    ▼
Customer-owned storage (R2/S3)
    │  Canonical compliance record
    │  Encrypted with customer-held key
    │  Survives ConsentShield shutdown
    │
    ▼
DPB audit export (read from customer storage, not from ConsentShield)
```

### 7.1 Buffer Lifecycle — Zero Tolerance for Stale Data

The buffer tables are write-ahead logs. A row's lifecycle is measured in seconds to minutes, not hours or days.

**Immediate deletion path (preferred):**

```sql
-- Inside the delivery Edge Function, after confirmed write to customer storage:
-- Step 1: Mark delivered
UPDATE consent_events SET delivered_at = now() WHERE id = $1 AND delivered_at IS NULL;
-- Step 2: Delete immediately
DELETE FROM consent_events WHERE id = $1 AND delivered_at IS NOT NULL;
-- These two statements run in the same transaction.
```

The previous architecture used a "nightly purge" approach. That is wrong. A consent event that was successfully delivered at 14:32 has no reason to exist in ConsentShield's database at 14:33. The deletion is immediate, not scheduled.

**Superseded timing:** The earlier technical architecture document specified "hard-delete delivered buffer rows older than 48 hours." That 48-hour window is explicitly superseded. The correct timing is: immediate deletion on confirmed delivery, 5-minute threshold on the safety-net sweep, 1-hour threshold for stuck-row alerts, 24-hour threshold for P0 escalation. No buffer row should exist for 48 hours under any circumstance — that would represent a multi-day delivery pipeline failure.

**Fallback sweep (safety net):**

Even with immediate deletion, edge cases can leave orphaned rows (process crash between mark and delete, delivery confirmation received but delete failed). A pg_cron job runs every 15 minutes to catch these:

```sql
-- Every 15 minutes: delete any rows delivered more than 5 minutes ago
-- This should find 0 rows in normal operation. If it finds rows, something went wrong.
DELETE FROM consent_events WHERE delivered_at IS NOT NULL AND delivered_at < now() - interval '5 minutes';
DELETE FROM tracker_observations WHERE delivered_at IS NOT NULL AND delivered_at < now() - interval '5 minutes';
DELETE FROM audit_log WHERE delivered_at IS NOT NULL AND delivered_at < now() - interval '5 minutes';
DELETE FROM processing_log WHERE delivered_at IS NOT NULL AND delivered_at < now() - interval '5 minutes';
DELETE FROM delivery_buffer WHERE delivered_at IS NOT NULL AND delivered_at < now() - interval '5 minutes';
```

**Stuck row detection (alert, don't silently lose data):**

```sql
-- Every hour: alert on rows that have been undelivered for > 1 hour
-- These represent delivery failures that need investigation
SELECT count(*) FROM consent_events WHERE delivered_at IS NULL AND created_at < now() - interval '1 hour';
-- If count > 0: fire alert via notification channels
```

**Hard limit (compliance emergency):**

```sql
-- Any row in a buffer table older than 24 hours is a compliance emergency.
-- It means the delivery pipeline has been broken for a full day.
-- This should NEVER fire in normal operation.
SELECT count(*) FROM consent_events WHERE created_at < now() - interval '24 hours';
-- If count > 0: page the developer. This is a P0.
```

### 7.2 Export Storage Configuration

Stored in `export_configurations` per organisation. Credentials are encrypted at rest using pgcrypto with a server-side encryption key.

**Write-only access pattern:** The IAM credential stored permits `PutObject` only. Cannot read, list, or delete. If compromised, the attacker gains write access to an encrypted bucket they cannot decrypt.

**Default (Standard mode):** ConsentShield provisions a Cloudflare R2 bucket within its own account, scoped to a per-customer path prefix. A per-customer encryption key is generated, delivered to the customer once, and discarded. ConsentShield cannot read the exported data.

**BYOS (Insulated/Zero-Storage mode):** Customer provides their own bucket and a write-only credential. ConsentShield validates the credential on setup (test write + verify), stores it encrypted, and uses it for all exports.

---

## 8. Enforcement Engine

### 8.1 Tracker Detection

The banner script's monitoring module observes third-party requests after the consent decision. Each detected request is classified against the embedded tracker signature database (JSON, ~15KB, covering 40+ services common on Indian websites).

Classification produces:
```
Detected domain → Known service → Purpose category → Consent required?
    → Compare against user's actual consent state
    → Match = compliant | Mismatch = violation
```

Violations are included in the observation report POSTed to the Worker.

**False positive mitigation:**
1. Functional allowlist — payment gateways, CAPTCHA, essential chat widgets are never flagged
2. 60-second grace period after consent change (cached scripts may fire)
3. Customer-configurable overrides via tracker_overrides table

### 8.2 Consent Withdrawal Verification

On `consent_withdrawn` event, the delivery Edge Function schedules three verification scans:

| Scan | Delay | Catches |
|---|---|---|
| Scan 1 | T + 15 minutes | Immediate enforcement failures |
| Scan 2 | T + 1 hour | Cached script issues |
| Scan 3 | T + 24 hours | Persistent violations |

Each scan: HTTP GET customer's page → parse HTML for tracker scripts → compare against withdrawn consent purposes → log result.

Client-side monitoring (banner script) catches dynamic trackers in real user sessions. Server-side scans catch hardcoded scripts at any time. Together they cover the most important violation patterns.

### 8.3 Security Posture Scanning

Nightly Vercel Cron (02:00 IST) per web property:

| Check | Method | Severity |
|---|---|---|
| SSL certificate | TLS handshake | Critical if expired |
| HSTS header | HTTP response | Warning if missing |
| CSP header | HTTP response | Warning if missing/partial |
| X-Frame-Options | HTTP response | Info |
| Vulnerable JS libraries | Script version vs CVE DB | Critical |
| Mixed content | HTML parse | Warning |
| Cookie flags | Set-Cookie inspection | Warning |

### 8.4 Deletion Orchestration

Triggered by: erasure request approved, retention period expired, or consent withdrawn.

**Generic webhook protocol (universal):**
```json
POST customer's endpoint:
{
  "event": "deletion_request",
  "request_id": "uuid",
  "data_principal": { "identifier": "...", "identifier_type": "email" },
  "reason": "erasure_request",
  "callback_url": "https://api.consentshield.in/v1/deletion-receipts/{request_id}?sig={HMAC}",
  "deadline": "ISO timestamp"
}

Customer callback:
{
  "request_id": "uuid",
  "status": "completed | partial | failed",
  "records_deleted": 47,
  "completed_at": "ISO timestamp"
}
```

The callback URL includes an HMAC signature: `HMAC-SHA256(request_id, DELETION_CALLBACK_SECRET)`. The callback endpoint verifies the signature before accepting the confirmation. An attacker who discovers a request_id cannot forge a valid callback URL without the secret.

**Pre-built connectors:** Direct API integrations (OAuth). Each follows the standard DeletionConnector interface: `getAuthUrl()`, `handleCallback()`, `deleteUser()`, `checkHealth()`.

Every deletion produces an immutable receipt in the deletion_receipts table, exported to customer storage as DPB evidence.

### 8.5 Consent Probe Testing Engine (Phase 3)

Consent probes are synthetic compliance tests. ConsentShield loads a customer's website in a controlled environment, sets a specific consent state, and verifies that the site respects it. This is the automated equivalent of a human auditor visiting the site and checking whether trackers fire after consent is denied.

**How probes work:**

```
1. Probe definition (stored in consent_probes table):
   — Target: web property URL
   — Consent state to simulate: e.g. { analytics: false, marketing: false }
   — Schedule: weekly | daily | on-demand

2. Probe execution (Vercel Cron → Edge Function):
   — HTTP GET the target URL with a headless browser or HTTP client
   — Inject the simulated consent state (bypass the banner, set consent directly)
   — Wait for page to fully load (5 seconds)
   — Collect all third-party resource requests (same technique as banner script monitoring)
   — Classify each detected tracker against the signature database
   — Compare classifications against the simulated consent state

3. Result (stored in consent_probe_runs buffer table):
   — List of trackers detected
   — List of violations (tracker loaded that should have been blocked by the simulated consent state)
   — Duration, status, error message if probe failed
   — Delivered to customer storage, then deleted from buffer

4. Alerting:
   — Violations → alert via notification channels
   — Compliance score impacted by probe failures
```

**What probes catch that real-time monitoring doesn't:**

Real-time monitoring (banner script v2) depends on actual user visits. A page that gets 10 visits per day may take weeks to accumulate enough observations for statistical confidence. Probes test every consent state combination on a schedule, regardless of traffic.

Probes also catch server-side rendering issues: a tracker script hardcoded in a Next.js `<Head>` component that loads before the banner script can intervene. Real-time monitoring misses this because the banner script can only observe what happens after it loads. The probe loads the page from scratch and sees everything.

**Limitations:**

Probes use HTTP-level inspection, not a full browser. They catch script tags and resource URLs but cannot execute JavaScript to detect dynamically injected trackers that load via `createElement('script')`. For dynamic trackers, the banner script's MutationObserver in real user sessions remains the primary detection mechanism. Probes and real-time monitoring are complementary — neither alone is sufficient.

---

## 9. Platform Strategy and Notification Architecture

### 9.1 No Native Mobile App (Phases 1–3)

No workflow in Phases 1–3 justifies the install friction, app store dependency, and maintenance burden of a native mobile app. ConsentShield's customers are SaaS founders and compliance managers who work at desks. The dashboard is a responsive web application. The rights request inbox is optimised for mobile browsers.

For alerts (tracker violations, SLA warnings, breach events), notification channels replace push notifications. Alerts reach users wherever they already work — email for founders, Slack for engineering teams, Teams for enterprise compliance officers.

A native app (React Native) enters scope only if Phase 4 clinic pilots validate that Progressive Web App camera limitations on iOS genuinely block the ABHA QR scan workflow in real clinic conditions. Until then, the tablet-optimised clinic web interface handles patient queue management, ABHA lookup (manual entry + web camera), and consent-gated record display.

### 9.2 Notification Channels

All alerts delivered through configurable channels:

| Channel | Method | Delivery guarantee |
|---|---|---|
| Email (Resend) | Transactional email to compliance contact | Always on, primary channel |
| Slack | Incoming webhook to configured channel | Configurable per alert type |
| Microsoft Teams | Incoming webhook | Configurable per alert type |
| Discord | Webhook | Configurable per alert type |
| Custom webhook | POST to customer endpoint | For PagerDuty, OpsGenie, etc. |

Alert types (each independently configurable per channel):
- Tracker violations detected
- New rights request received
- SLA warning (7 days remaining)
- SLA overdue
- Consent withdrawal verification failure
- Security scan: new critical finding
- Retention period expired
- Deletion orchestration failure
- Consent probe failure
- Compliance score change (daily summary)

---

## 10. API Surface

### 10.1 Public Endpoints (no auth)

| Route | Method | Handler | Protection |
|---|---|---|---|
| cdn.consentshield.in/v1/banner.js | GET | Cloudflare Worker — serve banner | Rate limit: 1000/IP/min |
| cdn.consentshield.in/v1/events | POST | Cloudflare Worker — ingest consent event | HMAC signature + origin validation + rate limit: 200/IP/min |
| cdn.consentshield.in/v1/observations | POST | Cloudflare Worker — ingest tracker observation | HMAC signature + origin validation + rate limit: 100/IP/min |
| /api/public/rights-request | POST | Next.js API — submit rights request | Cloudflare Turnstile + email OTP + rate limit: 5/IP/hour |
| /api/v1/deletion-receipts/{id} | POST | Next.js API — deletion callback | HMAC-signed callback URL |

**Rights request submission flow (hardened):**

```
1. Data Principal fills form on customer's privacy page
2. Cloudflare Turnstile validates the browser environment (invisible, no puzzle)
   → If Turnstile fails: reject, do not create any database row
3. Server sends OTP to the provided email address (via Resend)
   → Row created in rights_requests with email_verified = false
   → No notification sent to compliance contact yet
4. Data Principal enters OTP
   → Server verifies OTP, sets email_verified = true
   → NOW: notification email sent to compliance contact
   → SLA 30-day clock starts from the original submission time (not OTP verification time)
5. If OTP is not verified within 24 hours: row is auto-deleted (abandoned submission)
```

This ensures the notification email — the one that could be used as a spam vector — only fires after a verified human with access to the provided email address submitted the request.

### 10.2 Authenticated Endpoints (Supabase JWT)

| Route | Method | Purpose |
|---|---|---|
| /api/orgs/[orgId]/banners | GET, POST | List/create consent banners |
| /api/orgs/[orgId]/banners/[id]/publish | POST | Activate banner, invalidate KV |
| /api/orgs/[orgId]/inventory | GET, POST, PATCH | Data inventory CRUD |
| /api/orgs/[orgId]/rights-requests | GET | List rights requests |
| /api/orgs/[orgId]/rights-requests/[id] | PATCH | Update request (assign, verify, respond) |
| /api/orgs/[orgId]/rights-requests/[id]/events | POST | Append workflow event |
| /api/orgs/[orgId]/breaches | GET, POST | List/create breach notifications |
| /api/orgs/[orgId]/audit/export | POST | Generate audit package |
| /api/orgs/[orgId]/settings | GET, PATCH | Organisation settings |
| /api/orgs/[orgId]/integrations | GET, POST, DELETE | Manage connectors |
| /api/orgs/[orgId]/integrations/[id]/delete | POST | Trigger deletion via connector |
| /api/orgs/[orgId]/notifications | GET, PATCH | Notification channel config |

### 10.3 Compliance API (API key auth — Pro/Enterprise)

```
Authorization: Bearer cs_live_xxxxxxxxxxxxxxxx
```

| Route | Method | Scopes |
|---|---|---|
| /api/v1/consent/events | GET | read:consent |
| /api/v1/consent/score | GET | read:score |
| /api/v1/tracker/violations | GET | read:tracker |
| /api/v1/rights/requests | GET, POST | read:rights, write:rights |
| /api/v1/deletion/trigger | POST | write:deletion |
| /api/v1/deletion/receipts | GET | read:deletion |
| /api/v1/audit/export | GET | read:audit |
| /api/v1/security/scans | GET | read:security |
| /api/v1/probes/results | GET | read:probes |

---

## 11. Security Rules — Non-Negotiable

These are architectural constraints, not feature decisions. They cannot be relaxed without rebuilding significant parts of the product.

**Rule 1 — No single key unlocks everything.** Three scoped database roles (cs_worker, cs_delivery, cs_orchestrator) replace the single service role key in all running application code. Each role has the minimum permissions for its function. The full service role is for migrations and emergency admin only — never in running code.

**Rule 2 — Buffer tables are append-only for authenticated users.** No UPDATE or DELETE RLS policy exists on any buffer table for any user role. No INSERT privilege for the `authenticated` role on critical buffers (consent_events, tracker_observations, audit_log, processing_log, delivery_buffer). Only the scoped service roles can write. Delivered rows are deleted by the cs_delivery role immediately after confirmed delivery.

**Rule 3 — Health data (ABDM) is never stored.** FHIR records flow through memory only. No schema, no table, no log ever holds clinical content. Any code that persists FHIR content is rejected in review without exception.

**Rule 4 — org_id is validated at two levels.** API routes check the session's org_id against the resource. RLS policies enforce the same check at the database level. Both must pass.

**Rule 5 — Razorpay webhooks are signature-verified before processing.** Rejected if `X-Razorpay-Signature` doesn't match `HMAC-SHA256(body, RAZORPAY_WEBHOOK_SECRET)`.

**Rule 6 — Public endpoints are protected against abuse.** The rights request endpoint requires Cloudflare Turnstile + email OTP verification before creating a request and notifying the compliance contact. Worker endpoints validate HMAC signatures and check origin headers. All public endpoints are rate-limited.

**Rule 7 — ConsentShield's database is an operational state store, not a compliance record store.** Any feature that treats buffer tables as the system of record is architecturally wrong.

**Rule 8 — Export credentials are write-only and never logged.** The IAM credential permits `PutObject` only. Stored encrypted at rest with per-org key derivation. Never in any log, error message, or audit trail.

**Rule 9 — Processing modes are enforced at the API gateway.** The `storage_mode` check runs before any data write. An organisation in Zero-Storage mode must never have data written to any persistent table.

**Rule 10 — RLS policies are the first code committed.** Written and tested before any customer data exists. Before any UI.

**Rule 11 — Buffer rows do not persist after delivery.** Deletion is immediate on confirmed delivery. The 15-minute sweep is a safety net. Any row older than 1 hour is a pipeline failure. Any row older than 24 hours is a P0 incident.

**Rule 12 — Credentials are encrypted with per-org key derivation.** `org_key = HMAC-SHA256(MASTER_ENCRYPTION_KEY, org_id || encryption_salt)`. Rotating one org's credentials requires only regenerating that org's salt. A master key leak does not provide direct access — the attacker still needs the per-org derivation.

**Rule 13 — Consent events are HMAC-signed.** The banner script computes `HMAC-SHA256(org_id + property_id + timestamp, signing_secret)` for every event. The Worker rejects events with invalid or expired signatures. The signing secret rotates with each banner version.

**Rule 14 — Deletion callbacks are signature-verified.** The callback URL includes `HMAC-SHA256(request_id, DELETION_CALLBACK_SECRET)`. The endpoint rejects callbacks with invalid signatures.

**Rule 15 — Origin validation on all Worker endpoints.** The Worker checks the Origin/Referer header against the registered web property URL. Mismatches are rejected. Missing origins are flagged.

**Rule 16 — Sentry captures no sensitive data.** Request bodies, headers, cookies, query parameters, and breadcrumb data are stripped before sending to Sentry. Only stack traces and error messages are captured.

**Rule 17 — All infrastructure accounts use hardware security keys.** Supabase, Vercel, Cloudflare, GitHub, domain registrar, Razorpay, Resend — all require hardware 2FA. Not SMS. Not TOTP app.

**Rule 18 — The Cloudflare Worker has zero npm dependencies.** It is vanilla TypeScript. This is a policy. Every dependency added to the Worker runs on every page load of every customer's website and is a supply chain risk surface.

---

## 12. Environment Variables

### Vercel (server-side only — never NEXT_PUBLIC_)

```bash
SUPABASE_URL=https://<project>.supabase.co
SUPABASE_ANON_KEY=<anon key>                         # Client-side Supabase client

# Scoped database roles (replace single service key)
SUPABASE_DELIVERY_ROLE_KEY=<cs_delivery password>    # Delivery Edge Function only
SUPABASE_ORCHESTRATOR_ROLE_KEY=<cs_orchestrator pw>  # All other Edge Functions + API routes
SUPABASE_SERVICE_ROLE_KEY=<service role key>          # Migrations and emergency admin ONLY

RAZORPAY_KEY_ID=<key id>
RAZORPAY_KEY_SECRET=<key secret>
RAZORPAY_WEBHOOK_SECRET=<webhook secret>

RESEND_API_KEY=<resend api key>

CLOUDFLARE_ACCOUNT_ID=<cf account id>
CLOUDFLARE_API_TOKEN=<cf api token>                  # KV cache invalidation — scoped to KV namespace only
CLOUDFLARE_KV_NAMESPACE_ID=<kv namespace id>

CLOUDFLARE_R2_ACCESS_KEY_ID=<r2 access key>          # Write-only, scoped to provisioned buckets
CLOUDFLARE_R2_SECRET_ACCESS_KEY=<r2 secret>

MASTER_ENCRYPTION_KEY=<32-byte hex>                  # Per-org key derivation base. Rotate annually.
DELETION_CALLBACK_SECRET=<32-byte hex>               # HMAC signing for deletion callbacks. Rotate annually.

TURNSTILE_SITE_KEY=<cf turnstile site key>           # Can be public (used in client form)
TURNSTILE_SECRET_KEY=<cf turnstile secret>           # Server-side verification only

SENTRY_DSN=<sentry dsn>
```

### Vercel (client-safe)

```bash
NEXT_PUBLIC_SUPABASE_URL=https://<project>.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=<anon key>
NEXT_PUBLIC_APP_URL=https://app.consentshield.in
NEXT_PUBLIC_CDN_URL=https://cdn.consentshield.in
NEXT_PUBLIC_TURNSTILE_SITE_KEY=<cf turnstile site key>
```

### Cloudflare Worker

```bash
SUPABASE_URL=<same as above>
SUPABASE_WORKER_KEY=<cs_worker password>             # Scoped: INSERT consent_events + tracker_observations only
BANNER_KV=<KV namespace binding>
```

---

## 13. Sentry Configuration

Sentry captures stack traces and error messages only. All sensitive data is stripped.

```javascript
Sentry.init({
  dsn: process.env.SENTRY_DSN,
  beforeSend(event) {
    if (event.request) {
      delete event.request.headers;       // May contain Authorization tokens
      delete event.request.cookies;       // Session tokens
      delete event.request.data;          // Request body — may contain personal data
      delete event.request.query_string;  // May contain signing secrets
    }
    return event;
  },
  beforeBreadcrumb(breadcrumb) {
    if (breadcrumb.category === 'http') {
      if (breadcrumb.data) {
        delete breadcrumb.data.request_body;
        delete breadcrumb.data.response_body;
      }
    }
    return breadcrumb;
  },
});
```

**Policy:** No environment variable, no request header, no request body, no cookie, and no query parameter is ever sent to Sentry. If a developer needs to debug a specific request, they add temporary structured logging (never including credentials) and remove it after investigation.

---

## 14. Infrastructure Security

### Account Protection

All infrastructure accounts require:
- Hardware security key (YubiKey or equivalent) for 2FA. Not SMS. Not TOTP app alone.
- Dedicated email address (infra@consentshield.in) not used for any other purpose.
- Unique password per service via password manager.

### Account Inventory

| Service | Purpose | 2FA Required | Critical Level |
|---|---|---|---|
| Supabase | Database, auth, edge functions | Hardware key | Catastrophic — full data access |
| Vercel | Next.js hosting, cron jobs, env vars | Hardware key | Critical — env var access |
| Cloudflare | Workers, KV, R2, DNS, rate limiting | Hardware key | Critical — banner script control |
| GitHub | Source code, CI/CD | Hardware key + signed commits | Critical — code integrity |
| Domain registrar | consentshield.in DNS delegation | Hardware key | Critical — DNS hijack = full control |
| Razorpay | Billing, customer payments | Hardware key | High — financial |
| Resend | Email delivery | Hardware key | High — notification channel |
| Sentry | Error tracking | Standard 2FA | Medium — no sensitive data (per Section 13) |

### Domain and DNS

- Enable registrar lock and transfer lock on consentshield.in.
- Enable DNSSEC on Cloudflare.
- Monitor DNS records for unauthorized changes (Cloudflare notifications).

### GitHub

- Branch protection on `main`: require PR review, require signed commits.
- Enable GitHub secret scanning (detects committed API keys).
- Enable Dependabot for automated dependency update PRs.

---

## 15. Dependency Management

```
All package.json dependencies use exact versions. No ^ or ~ prefixes.
npm ci (not npm install) in all CI/CD and deployment pipelines.
npm audit runs on every commit. Critical vulnerabilities block deployment.
The Cloudflare Worker has zero npm dependencies. Vanilla TypeScript only. This is policy.
No new dependency added without explicit justification in the PR description.
Dependabot or Renovate enabled for automated update PRs.
```

### Dependency Review Checklist (for every new package)

1. Does this package need network access? If yes, why?
2. Does this package access the file system? If yes, why?
3. What is the package's download count and maintenance status?
4. Has this package had any security incidents? (Check Socket.dev or Snyk DB)
5. Can this functionality be implemented in 1 day of coding and testing?

If question 5 is yes, write it yourself. A day of work eliminates a permanent supply chain risk surface. The dependency doesn't just run once — it runs on every build, every deploy, and every customer interaction for the lifetime of the product. One day of effort to remove that ongoing exposure is always worth it.

---

*Document prepared April 2026. This is the definitive architecture reference. All development decisions defer to this document. Security hardening changes integrated April 2026.*
