# ConsentShield — Technical Architecture

*Build reference · April 2026 · Stack: Next.js 14 + Supabase + Cloudflare Workers + Resend + Razorpay + Vercel*

---

## Table of Contents

1. [Stack overview](#1-stack-overview)
2. [Database schema](#2-database-schema)
3. [Multi-tenant isolation — JWT claims and RLS](#3-multi-tenant-isolation)
4. [Cloudflare Worker — banner delivery and event ingestion](#4-cloudflare-worker)
5. [API surface — Next.js routes and Edge Functions](#5-api-surface)
6. [Key data flows](#6-key-data-flows)
7. [Security rules — non-negotiable](#7-security-rules)
8. [Environment variables](#8-environment-variables)

---

## 1. Stack Overview

| Layer | Technology | Purpose |
|---|---|---|
| Frontend | Next.js 14 + TypeScript + Tailwind + shadcn/ui | Web application |
| Auth | Supabase Auth | Email, magic link, Google OAuth — native RLS integration |
| Database | Supabase Postgres | All application data, RLS-enforced multi-tenancy |
| Edge Functions | Supabase Edge Functions (Deno) | Async jobs: SLA reminders, report generation, snippet verification |
| Banner delivery | Cloudflare Worker + KV | `cdn.consentshield.in` — edge-served JS + consent event ingestion |
| Email | Resend | Rights request alerts, SLA warnings, breach notifications, newsletter |
| Billing | Razorpay Subscriptions | INR plans, auto-renewal, webhook-driven plan gating |
| Hosting | Vercel | Next.js app |
| Monitoring | Sentry + Vercel Analytics | Error tracking, performance |

**The fundamental architecture decision:** Supabase Auth and Supabase Postgres are the same system. The `auth.uid()` and `auth.jwt()` functions are available inside every RLS policy. Multi-tenant isolation is enforced at the database level, not in application code. Every query runs the policy — there is no way to forget it.

---

## 2. Database Schema

All tables use UUIDs as primary keys (`gen_random_uuid()`). All tables have `created_at timestamptz default now()`. Tables that represent mutable state have `updated_at timestamptz default now()` maintained by a trigger. Tables that are legally required to be immutable (consent events, processing log, audit log) have no `updated_at` and no UPDATE or DELETE policies.

### 2.0 Data Classification Principles

**ConsentShield's database is an operational state store, not a compliance record store.**

Every table in this schema belongs to one of two categories. Understanding this distinction is the single most important thing to grasp before touching the schema.

| Category | What it contains | Who owns it | Retention policy |
|---|---|---|---|
| **Operational state** | Configuration, billing, consent artefact validity index, delivery buffer state | ConsentShield — this is ConsentShield's business data about how to run the service | As long as the service relationship exists |
| **User data buffer** | Consent events, audit log entries, processing log entries, rights request personal data | The Data Fiduciary (the customer) | Held only until confirmed delivery to customer-owned storage. Deleted from ConsentShield systems after delivery. |

The practical consequence: tables in the "User data buffer" category are **write-ahead log (WAL) buffers**, not systems of record. The canonical copy of all compliance data lives in the customer's own storage. ConsentShield holds a working copy only for the duration needed to guarantee delivery. When delivery is confirmed, ConsentShield's copy is eligible for deletion.

For customers on **Standard mode** (the default for early-stage customers without their own storage), ConsentShield provisions partitioned storage on their behalf, encrypted with a per-customer key that ConsentShield generates, delivers, and then does not retain. ConsentShield is the storage provider for these customers but not the data controller.

For customers on **Insulated mode** or **Zero-Storage mode**, the customer provides their own storage endpoint. ConsentShield holds write-only credentials. The canonical record exists only in the customer's storage from the moment of confirmed write.

### 2.1 organisations

The root of all multi-tenant data. One row per paying customer account.

```sql
create table organisations (
  id                        uuid primary key default gen_random_uuid(),
  name                      text not null,
  industry                  text,                        -- 'saas' | 'edtech' | 'healthcare' | 'ecommerce' | 'hrtech'
  plan                      text not null default 'trial', -- 'trial' | 'starter' | 'growth' | 'pro' | 'enterprise'
  plan_started_at           timestamptz default now(),
  trial_ends_at             timestamptz default (now() + interval '14 days'),
  razorpay_subscription_id  text unique,
  razorpay_customer_id      text unique,
  compliance_contact_email  text,
  dpo_name                  text,
  -- Data storage mode — determines where user data is held and whether ConsentShield can read it
  storage_mode              text not null default 'standard', -- 'standard' | 'insulated' | 'zero_storage'
  -- Points to export_configurations row. NULL = standard mode (ConsentShield-provisioned storage)
  export_config_id          uuid,
  created_at                timestamptz default now(),
  updated_at                timestamptz default now()
);
```

### 2.2 organisation_members

Links Supabase Auth users to organisations. A user can belong to one org in v1 (multi-org support is a v2 concern).

```sql
create table organisation_members (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references organisations(id) on delete cascade,
  user_id     uuid not null references auth.users(id) on delete cascade,
  role        text not null default 'member',  -- 'admin' | 'member' | 'readonly'
  created_at  timestamptz default now(),
  unique (org_id, user_id)
);
```

### 2.3 export_configurations

*Category: Operational state.*

Holds the customer-owned storage configuration for Insulated and Zero-Storage mode tenants. ConsentShield uses the credential here to write exports but cannot read from the destination bucket.

```sql
create table export_configurations (
  id                    uuid primary key default gen_random_uuid(),
  org_id                uuid not null references organisations(id) on delete cascade unique,
  provider              text not null,                   -- 'r2' (default provisioned) | 's3' | 'azure_blob' | 'gcs'
  -- R2 is the default for ConsentShield-provisioned buckets: no egress fees, same Cloudflare account as Workers.
  -- S3 / Azure / GCS are available for BYOS customers who already have approved cloud infrastructure.
  -- Regulated enterprise customers requiring verifiable CMK should use S3 + AWS KMS.
  bucket_name           text not null,
  endpoint_url          text,                            -- for R2 or non-AWS S3-compatible endpoints
  region                text,                            -- for AWS S3
  -- Write-only IAM credential. ConsentShield can PutObject only. Never GetObject, ListBucket, DeleteObject.
  write_credential_enc  text not null,                   -- encrypted at rest with ConsentShield's server-side key
  -- Encryption key reference. ConsentShield does NOT hold the actual key — only the key ID.
  -- Customer holds the actual encryption key. ConsentShield uses this ID to route to the right KMS policy.
  customer_key_id       text,
  -- For Standard mode: ConsentShield-provisioned bucket. ConsentShield holds write creds only.
  -- Key was generated, delivered to customer, and deleted from ConsentShield systems.
  is_consentshield_provisioned boolean not null default false,
  last_export_at        timestamptz,
  last_export_status    text,                            -- 'success' | 'failed' | 'partial'
  created_at            timestamptz default now(),
  updated_at            timestamptz default now()
);
```

### 2.4 consent_artefact_index

*Category: Operational state. Contains no personal data — only cryptographic references with TTLs.*

The active-state validity cache for consent artefacts. Used to answer "is this consent artefact valid right now?" in sub-millisecond time without a round-trip to customer storage. Contains no purpose content, no personal data, no health records — only the artefact ID, validity state, and expiry. When an artefact expires or is revoked, the row is deleted.

```sql
create table consent_artefact_index (
  id                  uuid primary key default gen_random_uuid(),
  org_id              uuid not null references organisations(id) on delete cascade,
  artefact_id         text not null,                     -- the consent artefact identifier from ABDM or ConsentShield
  artefact_type       text not null,                     -- 'abdm' | 'dpdp' | 'gdpr'
  validity_state      text not null default 'active',    -- 'active' | 'expired' | 'revoked'
  issued_at           timestamptz not null,
  expires_at          timestamptz not null,
  revoked_at          timestamptz,
  -- This index entry is deleted when the artefact expires or is revoked.
  -- It is not a compliance record — it is an operational cache.
  created_at          timestamptz default now(),
  unique (org_id, artefact_id)
);

create index on consent_artefact_index (org_id, artefact_id, validity_state);
create index on consent_artefact_index (expires_at) where validity_state = 'active';
-- pg_cron job deletes expired entries nightly (see Section 2.12 Triggers)
```

### 2.5 delivery_buffer

*Category: Operational state — a write-ahead log, not a data store.*

Holds user data events (consent events, audit entries, processing log entries) for the duration of delivery to customer-owned storage. An entry is created when an event is generated and deleted when delivery to customer storage is confirmed. Retention is hours, not months. The canonical copy of every entry lives in customer storage.

```sql
create table delivery_buffer (
  id                uuid primary key default gen_random_uuid(),
  org_id            uuid not null references organisations(id) on delete cascade,
  event_type        text not null,                       -- 'consent_event' | 'audit_entry' | 'processing_log' | 'rights_request'
  payload           jsonb not null,                      -- the full event payload to be exported
  export_config_id  uuid references export_configurations(id),
  attempt_count     integer not null default 0,
  first_attempted_at timestamptz,
  last_attempted_at  timestamptz,
  delivered_at      timestamptz,                         -- set when confirmed write to customer storage succeeds
  delivery_error    text,                                -- last error message if delivery failed
  created_at        timestamptz default now()
  -- Rows are hard-deleted after confirmed delivery (delivered_at is not null).
  -- Rows with attempt_count > 10 and no delivered_at trigger an alert and are held for manual review.
);

create index on delivery_buffer (org_id, delivered_at) where delivered_at is null;
create index on delivery_buffer (created_at) where delivered_at is null;
```

### 2.6 web_properties

*Category: Operational state.*

Each customer can have multiple websites or apps. Each property gets its own consent banner and snippet.

```sql
create table web_properties (
  id                    uuid primary key default gen_random_uuid(),
  org_id                uuid not null references organisations(id) on delete cascade,
  name                  text not null,                   -- e.g. "Main product", "Marketing site"
  url                   text not null,
  snippet_verified_at   timestamptz,                     -- null until verification passes
  snippet_last_seen_at  timestamptz,                     -- updated by Cloudflare Worker on each load
  created_at            timestamptz default now(),
  updated_at            timestamptz default now()
);
```

### 2.7 consent_banners

*Category: Operational state.*

Versioned banner configurations. Every change creates a new version; the active version is served by the Cloudflare Worker. Historical versions are retained so consent events can always reference the exact configuration the user consented to.

```sql
create table consent_banners (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references organisations(id) on delete cascade,
  property_id uuid not null references web_properties(id) on delete cascade,
  version     integer not null default 1,
  is_active   boolean not null default false,
  headline    text not null,
  body_copy   text not null,
  position    text not null default 'bottom-bar',        -- 'bottom-bar' | 'bottom-left' | 'bottom-right' | 'modal'
  purposes    jsonb not null default '[]',               -- see purpose schema below
  created_at  timestamptz default now(),
  unique (property_id, version)
);

-- Purpose object schema (stored in purposes jsonb array):
-- {
--   id: string,          -- 'analytics' | 'marketing' | 'personalisation' | custom
--   name: string,        -- display name
--   description: string, -- plain language description
--   required: boolean,   -- if true, always accepted, cannot be rejected
--   default: boolean     -- pre-checked state for optional purposes
-- }
```

### 2.8 consent_events

*Category: User data buffer. This table is a write-ahead log, not the system of record.*

Consent actions flow through this table on their way to customer-owned storage. A row is inserted when an event fires and deleted after confirmed delivery to the customer's export destination. The canonical compliance record lives in customer storage. ConsentShield holds the working copy only for the duration of guaranteed delivery.

For Standard mode customers (ConsentShield-provisioned R2), delivery happens within the same transaction. For Insulated and Zero-Storage mode customers, the delivery buffer (`delivery_buffer` table) tracks confirmed writes and cleans up on success.

Every consent action — accept, reject, withdraw, update — is an append-only row. The Cloudflare Worker writes to this table using the scoped `cs_worker` role; the application only reads it.

```sql
create table consent_events (
  id                  uuid primary key default gen_random_uuid(),
  org_id              uuid not null,                     -- denormalised — no join needed for RLS check
  property_id         uuid not null references web_properties(id),
  banner_id           uuid not null references consent_banners(id),
  banner_version      integer not null,                  -- denormalised — banner may be updated later
  session_fingerprint text not null,                     -- SHA-256 of (user_agent + truncated_ip + org_id). Not a user ID.
  event_type          text not null,                     -- 'consent_given' | 'consent_withdrawn' | 'purpose_updated' | 'banner_dismissed'
  purposes_accepted   jsonb not null default '[]',       -- array of purpose IDs accepted
  purposes_rejected   jsonb not null default '[]',       -- array of purpose IDs rejected
  ip_truncated        text,                              -- last octet removed: '103.21.244.0'
  user_agent_hash     text,                              -- hashed, not stored raw
  -- Delivery tracking — this table is a buffer, not a permanent store
  delivered_at        timestamptz,                       -- set on confirmed write to customer storage
  delivery_buffer_id  uuid references delivery_buffer(id), -- link to WAL buffer entry if async delivery
  created_at          timestamptz default now()
  -- NO updated_at. Append-only. No UPDATE or DELETE policy exists on this table for any role.
  -- Rows where delivered_at is not null are eligible for hard deletion on a nightly schedule.
);

create index on consent_events (org_id, property_id, created_at desc);
create index on consent_events (org_id, session_fingerprint, created_at desc);
create index on consent_events (delivered_at) where delivered_at is null; -- undelivered events
```

### 2.9 data_inventory

*Category: Operational state. This is the customer's description of their own data flows — it is configuration, not personal data of data principals.*

```sql
create table data_inventory (
  id                uuid primary key default gen_random_uuid(),
  org_id            uuid not null references organisations(id) on delete cascade,
  data_category     text not null,                       -- 'email_address' | 'payment_data' | 'usage_analytics' | etc.
  collection_source text,                                -- 'signup_form' | 'mobile_sdk' | 'checkout' | etc.
  purposes          text[] not null default '{}',        -- ['product', 'marketing', 'analytics']
  legal_basis       text not null default 'consent',     -- 'consent' | 'contract' | 'legal_obligation' | 'legitimate_interest'
  retention_period  text,                                -- '12 months' | '7 years (statutory)' | 'account_lifetime'
  third_parties     text[] not null default '{}',        -- ['Razorpay', 'Mixpanel']
  notes             text,
  is_complete       boolean not null default false,
  created_at        timestamptz default now(),
  updated_at        timestamptz default now()
);
```

### 2.10 rights_requests

*Category: User data buffer. Contains personal data of data principals (requestor name, email). Operational status fields (status, assignee, SLA deadline) are operational state; personal fields are buffer data.*

The personal data in a rights request — requestor name, email, message — follows the same delivery model as consent events. It is held in ConsentShield's DB for the duration of the workflow, exported to customer storage on completion (or on each status change for Insulated/Zero-Storage customers), and the personal fields are eligible for deletion from ConsentShield's systems once the workflow is closed and delivery is confirmed.

The operational fields — status, assignee_id, sla_deadline, response_sent_at — are retained as operational state for SLA tracking and are not personal data under DPDP.

One row per Data Principal rights request. The full audit trail is in `rights_request_events`.

```sql
create table rights_requests (
  id                      uuid primary key default gen_random_uuid(),
  org_id                  uuid not null references organisations(id) on delete cascade,
  request_type            text not null,                 -- 'erasure' | 'access' | 'correction' | 'nomination'
  requestor_name          text not null,
  requestor_email         text not null,
  requestor_message       text,
  identity_verified       boolean not null default false,
  identity_verified_at    timestamptz,
  identity_verified_by    uuid references auth.users(id),
  identity_method         text,                          -- 'otp' | 'document' | 'in_person'
  status                  text not null default 'new',   -- 'new' | 'in_progress' | 'completed' | 'rejected'
  assignee_id             uuid references auth.users(id),
  sla_deadline            timestamptz not null,          -- created_at + 30 days (set on insert via trigger)
  response_sent_at        timestamptz,
  closure_notes           text,
  created_at              timestamptz default now(),
  updated_at              timestamptz default now()
);

create index on rights_requests (org_id, status, sla_deadline asc);
```

### 2.11 rights_request_events

*Category: User data buffer. Append-only audit trail for every action taken on a rights request. Exported to customer storage on workflow close. This is the evidence file for a DPB inspection — its canonical home is customer storage, not ConsentShield's DB.*

```sql
create table rights_request_events (
  id           uuid primary key default gen_random_uuid(),
  request_id   uuid not null references rights_requests(id) on delete cascade,
  org_id       uuid not null,                            -- denormalised for RLS
  actor_id     uuid references auth.users(id),           -- null for automated events
  event_type   text not null,                            -- 'created' | 'assigned' | 'identity_verified' |
                                                         -- 'data_reviewed' | 'response_drafted' |
                                                         -- 'response_sent' | 'closed' | 'sla_warning_sent'
  notes        text,
  metadata     jsonb,                                    -- event-specific data
  created_at   timestamptz default now()
  -- Append-only. No UPDATE or DELETE policy.
);
```

### 2.12 processing_log

*Category: User data buffer. Minimum 1-year retention required by DPDP Rules — but that retention obligation sits with the Data Fiduciary (the customer), not with ConsentShield. ConsentShield generates the log, delivers it to customer storage, and holds a working copy only until delivery is confirmed.*

A continuous log of all data processing activities. Append-only.

```sql
create table processing_log (
  id                uuid primary key default gen_random_uuid(),
  org_id            uuid not null references organisations(id) on delete cascade,
  activity_name     text not null,                       -- 'email_marketing_send' | 'analytics_event_track' | etc.
  data_categories   text[] not null,
  purpose           text not null,
  legal_basis       text not null,
  processor_name    text,                                -- name of third party doing the processing, if any
  third_parties     text[] not null default '{}',
  data_subjects_count integer,                           -- estimated, nullable
  -- Delivery tracking
  delivered_at      timestamptz,                         -- set on confirmed write to customer storage
  delivery_buffer_id uuid references delivery_buffer(id),
  created_at        timestamptz default now()
  -- Append-only. No UPDATE or DELETE policy.
  -- Rows where delivered_at is not null are eligible for deletion on nightly schedule.
);

create index on processing_log (org_id, created_at desc);
create index on processing_log (delivered_at) where delivered_at is null;
```

### 2.13 breach_notifications

*Category: Mixed. The breach event metadata (discovered_at, affected_categories, DPB reference number, resolution status) is operational state. The description and incident details are user data buffer — exported to customer storage and eligible for deletion after confirmed delivery.*

```sql
create table breach_notifications (
  id                          uuid primary key default gen_random_uuid(),
  org_id                      uuid not null references organisations(id) on delete cascade,
  discovered_at               timestamptz not null,
  reported_by                 uuid not null references auth.users(id),
  dpb_notification_deadline   timestamptz not null,      -- discovered_at + 72 hours (set on insert)
  dpb_notified_at             timestamptz,
  affected_categories         text[] not null default '{}',
  estimated_affected_count    integer,
  description                 text,
  incident_reference          text,                      -- DPB reference number once filed
  status                      text not null default 'open', -- 'open' | 'notified' | 'closed'
  created_at                  timestamptz default now(),
  updated_at                  timestamptz default now()
);
```

### 2.14 audit_log

*Category: User data buffer. Every significant platform action is written here and delivered to customer storage. ConsentShield holds a working copy for the dashboard view; the canonical compliance record is in customer storage.*

System-wide audit trail. Every significant action — banner published, plan changed, report exported, breach triggered — writes a row here. Append-only.

```sql
create table audit_log (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null,
  actor_id     uuid,                                     -- null for automated/system events
  actor_email  text,                                     -- denormalised — user may be deleted later
  event_type   text not null,
  entity_type  text,                                     -- 'consent_banner' | 'rights_request' | 'organisation' | etc.
  entity_id    uuid,
  payload      jsonb,                                    -- before/after or relevant metadata
  ip_address   text,
  -- Delivery tracking
  delivered_at        timestamptz,                       -- set on confirmed write to customer storage
  delivery_buffer_id  uuid references delivery_buffer(id),
  created_at   timestamptz default now()
  -- Append-only. No UPDATE or DELETE policy.
  -- Rows where delivered_at is not null are eligible for deletion on nightly schedule.
);

create index on audit_log (org_id, created_at desc);
create index on audit_log (org_id, event_type, created_at desc);
create index on audit_log (delivered_at) where delivered_at is null;
```

### 2.15 Triggers

```sql
-- Auto-update updated_at on mutable tables
create or replace function set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- Apply to all mutable tables
create trigger set_updated_at before update on organisations
  for each row execute function set_updated_at();
create trigger set_updated_at before update on web_properties
  for each row execute function set_updated_at();
create trigger set_updated_at before update on data_inventory
  for each row execute function set_updated_at();
create trigger set_updated_at before update on rights_requests
  for each row execute function set_updated_at();
create trigger set_updated_at before update on breach_notifications
  for each row execute function set_updated_at();
create trigger set_updated_at before update on export_configurations
  for each row execute function set_updated_at();

-- Auto-set SLA deadline on rights request insert (30 days from creation)
create or replace function set_rights_request_sla()
returns trigger language plpgsql as $$
begin
  new.sla_deadline = new.created_at + interval '30 days';
  return new;
end;
$$;

create trigger set_rights_request_sla before insert on rights_requests
  for each row execute function set_rights_request_sla();

-- Auto-set DPB deadline on breach notification insert (72 hours from discovery)
create or replace function set_breach_deadline()
returns trigger language plpgsql as $$
begin
  new.dpb_notification_deadline = new.discovered_at + interval '72 hours';
  return new;
end;
$$;

create trigger set_breach_deadline before insert on breach_notifications
  for each row execute function set_breach_deadline();

-- Nightly cleanup: delete expired consent artefact index entries
-- Scheduled via pg_cron (see Section 5.3)
-- delete from consent_artefact_index where expires_at < now();

-- Nightly cleanup: hard-delete delivered buffer rows older than 48 hours
-- delete from delivery_buffer where delivered_at is not null and delivered_at < now() - interval '48 hours';
-- delete from consent_events where delivered_at is not null and delivered_at < now() - interval '48 hours';
-- delete from audit_log where delivered_at is not null and delivered_at < now() - interval '48 hours';
-- delete from processing_log where delivered_at is not null and delivered_at < now() - interval '48 hours';
```

---

## 3. Multi-Tenant Isolation

### 3.1 JWT Custom Claims Hook

After a user signs up and an org is created, the `org_id` and `org_role` must be injected into every JWT the user receives. Supabase supports a custom access token hook for this. Register this function in the Supabase dashboard under Authentication → Hooks → Custom Access Token.

```sql
create or replace function public.custom_access_token_hook(event jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  claims    jsonb;
  org_id    uuid;
  org_role  text;
begin
  claims := event -> 'claims';

  select om.org_id, om.role
  into org_id, org_role
  from organisation_members om
  where om.user_id = (event ->> 'user_id')::uuid
  limit 1;

  if org_id is not null then
    claims := jsonb_set(claims, '{org_id}',   to_jsonb(org_id::text));
    claims := jsonb_set(claims, '{org_role}', to_jsonb(org_role));
  end if;

  return jsonb_set(event, '{claims}', claims);
end;
$$;

-- Grant execute to the supabase_auth_admin role
grant execute on function public.custom_access_token_hook to supabase_auth_admin;
```

Every JWT now contains `org_id` and `org_role` as custom claims. RLS policies reference these claims directly without any application-level enforcement.

### 3.2 Helper Functions

```sql
-- Returns the current user's org_id from their JWT
create or replace function current_org_id()
returns uuid
language sql stable
as $$
  select (auth.jwt() ->> 'org_id')::uuid;
$$;

-- Returns true if current user is an admin of their org
create or replace function is_org_admin()
returns boolean
language sql stable
as $$
  select (auth.jwt() ->> 'org_role') = 'admin';
$$;
```

### 3.3 RLS Policies

Enable RLS on every table first:

```sql
alter table organisations            enable row level security;
alter table organisation_members     enable row level security;
alter table export_configurations    enable row level security;
alter table consent_artefact_index   enable row level security;
alter table delivery_buffer          enable row level security;
alter table web_properties           enable row level security;
alter table consent_banners          enable row level security;
alter table consent_events           enable row level security;
alter table data_inventory           enable row level security;
alter table rights_requests          enable row level security;
alter table rights_request_events    enable row level security;
alter table processing_log           enable row level security;
alter table breach_notifications     enable row level security;
alter table audit_log                enable row level security;
```

Policies by table:

```sql
-- organisations: read own org, admin-only update
create policy "members can view their org"
  on organisations for select
  using (id = current_org_id());

create policy "admins can update their org"
  on organisations for update
  using (id = current_org_id() and is_org_admin());

-- organisation_members: members can view their org's members, admin-only mutations
create policy "members can view org members"
  on organisation_members for select
  using (org_id = current_org_id());

create policy "admins can manage org members"
  on organisation_members for all
  using (org_id = current_org_id() and is_org_admin());

-- web_properties, consent_banners, data_inventory, rights_requests,
-- breach_notifications: standard org-scoped read + admin write
create policy "org scoped select"
  on web_properties for select using (org_id = current_org_id());
create policy "org scoped insert"
  on web_properties for insert with check (org_id = current_org_id());
create policy "org scoped update"
  on web_properties for update using (org_id = current_org_id());

-- (same pattern for consent_banners, data_inventory, breach_notifications)

-- rights_requests: all members read, all members can update (any member can respond)
create policy "org members can read rights requests"
  on rights_requests for select using (org_id = current_org_id());
create policy "org members can update rights requests"
  on rights_requests for update using (org_id = current_org_id());
-- public insert (no auth required — Data Principal submits from hosted form)
create policy "public can submit rights requests"
  on rights_requests for insert with check (true);

-- consent_events: org members can read, NO insert from application
-- Inserts come only from Cloudflare Worker via service role key (bypasses RLS)
create policy "org members can read consent events"
  on consent_events for select using (org_id = current_org_id());
-- NO insert, update, or delete policy for authenticated users

-- rights_request_events, processing_log, audit_log: read-only for members
-- Inserts via service role only (never from client)
create policy "org members can read request events"
  on rights_request_events for select using (org_id = current_org_id());
create policy "org members can read processing log"
  on processing_log for select using (org_id = current_org_id());
create policy "org members can read audit log"
  on audit_log for select using (org_id = current_org_id());
```

**Scoped database roles** replace the single service role key in all running application code:
- `cs_worker` — Cloudflare Worker writing consent events and tracker observations
- `cs_delivery` — Delivery Edge Function reading/deleting buffer rows
- `cs_orchestrator` — All other Edge Functions and API routes

The full service role key is retained for schema migrations and emergency admin only — never in running application code. Never exposed to the browser.

---

## 4. Cloudflare Worker

The Worker lives at `cdn.consentshield.in` and handles two responsibilities: serving the banner script and ingesting consent events. Both are latency-critical — the banner script must not delay page load and consent events must be acknowledged fast so the banner dismisses immediately.

### 4.1 KV Store Structure

```
banner:config:{propertyId}          → JSON banner config, TTL 300s
banner:script:{propertyId}:{version} → compiled banner.js string, TTL 3600s
snippet:verified:{propertyId}       → '1' written on each successful load, TTL 600s
```

### 4.2 Worker Routes

```
GET  /v1/banner.js          → serve compiled banner script
POST /v1/events             → ingest consent event
GET  /v1/health             → health check
```

### 4.3 Banner Script Delivery (`GET /v1/banner.js`)

```typescript
// Cloudflare Worker — banner.js delivery
export async function handleBannerScript(
  request: Request,
  env: Env
): Promise<Response> {
  const url = new URL(request.url);
  const propertyId = url.searchParams.get('prop');
  const orgId = url.searchParams.get('org');

  if (!propertyId || !orgId) {
    return new Response('Missing parameters', { status: 400 });
  }

  // 1. Try KV cache first
  const cacheKey = `banner:config:${propertyId}`;
  let config = await env.BANNER_KV.get(cacheKey, 'json');

  // 2. On cache miss, fetch from Supabase
  if (!config) {
    const res = await fetch(
      `${env.SUPABASE_URL}/rest/v1/consent_banners?property_id=eq.${propertyId}&is_active=eq.true&select=*`,
      {
        headers: {
          apikey: env.SUPABASE_WORKER_KEY,
          Authorization: `Bearer ${env.SUPABASE_WORKER_KEY}`,
        },
      }
    );
    const banners = await res.json();
    config = banners[0] ?? null;

    if (config) {
      // Cache for 5 minutes
      await env.BANNER_KV.put(cacheKey, JSON.stringify(config), { expirationTtl: 300 });
    }
  }

  if (!config) {
    return new Response('Banner not found', { status: 404 });
  }

  // 3. Update snippet_last_seen_at asynchronously (non-blocking)
  env.ctx.waitUntil(
    fetch(`${env.SUPABASE_URL}/rest/v1/web_properties?id=eq.${propertyId}`, {
      method: 'PATCH',
      headers: {
        apikey: env.SUPABASE_WORKER_KEY,
        Authorization: `Bearer ${env.SUPABASE_WORKER_KEY}`,
        'Content-Type': 'application/json',
        Prefer: 'return=minimal',
      },
      body: JSON.stringify({ snippet_last_seen_at: new Date().toISOString() }),
    })
  );

  // 4. Compile and return the banner script
  const script = compileBannerScript(config, orgId, propertyId);

  return new Response(script, {
    headers: {
      'Content-Type': 'application/javascript; charset=utf-8',
      'Cache-Control': 'public, max-age=60, stale-while-revalidate=300',
      'Access-Control-Allow-Origin': '*',
    },
  });
}
```

### 4.4 Consent Event Ingestion (`POST /v1/events`)

The event ingestion handler follows a dual-path write. The event is written to the `consent_events` buffer table and simultaneously dispatched to the organisation's export destination. For Standard mode (R2-provisioned), the export write is synchronous and delivery is confirmed before the 202 is returned. For Insulated and Zero-Storage mode, the export is dispatched asynchronously via the `delivery_buffer` table and a Supabase Edge Function handles confirmed delivery with retry logic.

```typescript
export async function handleConsentEvent(
  request: Request,
  env: Env
): Promise<Response> {
  if (request.method === 'OPTIONS') {
    return new Response(null, {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST',
        'Access-Control-Allow-Headers': 'Content-Type',
      },
    });
  }

  const body = await request.json() as ConsentEventPayload;

  if (!body.org_id || !body.property_id || !body.banner_id || !body.event_type) {
    return new Response('Invalid payload', { status: 400 });
  }

  const validEventTypes = ['consent_given', 'consent_withdrawn', 'purpose_updated', 'banner_dismissed'];
  if (!validEventTypes.includes(body.event_type)) {
    return new Response('Invalid event_type', { status: 400 });
  }

  const ip = request.headers.get('CF-Connecting-IP') ?? '';
  const ipTruncated = ip.split('.').slice(0, 3).join('.') + '.0';
  const userAgent = request.headers.get('User-Agent') ?? '';
  const fingerprint = await hashSHA256(`${userAgent}:${ipTruncated}:${body.org_id}`);
  const uaHash = await hashSHA256(userAgent);

  const event = {
    org_id:              body.org_id,
    property_id:         body.property_id,
    banner_id:           body.banner_id,
    banner_version:      body.banner_version,
    session_fingerprint: fingerprint,
    event_type:          body.event_type,
    purposes_accepted:   body.purposes_accepted ?? [],
    purposes_rejected:   body.purposes_rejected ?? [],
    ip_truncated:        ipTruncated,
    user_agent_hash:     uaHash,
  };

  // Step 1: Write to consent_events buffer (cs_worker scoped role)
  const bufferRes = await fetch(`${env.SUPABASE_URL}/rest/v1/consent_events`, {
    method: 'POST',
    headers: {
      apikey: env.SUPABASE_WORKER_KEY,
      Authorization: `Bearer ${env.SUPABASE_WORKER_KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
    },
    body: JSON.stringify(event),
  });

  if (!bufferRes.ok) {
    console.error('Buffer write failed', await bufferRes.text());
    // Return 202 regardless — do not break the user's browsing session
    return new Response(null, { status: 202, headers: { 'Access-Control-Allow-Origin': '*' } });
  }

  const [bufferedEvent] = await bufferRes.json();

  // Step 2: Dispatch export to customer storage (non-blocking)
  // The deliver-consent-events Edge Function handles confirmed write + sets delivered_at.
  // For Standard mode (R2-provisioned), delivery is fast and typically completes within seconds.
  // For failed deliveries, the delivery_buffer retry mechanism handles up to 10 attempts.
  env.ctx.waitUntil(
    fetch(`${env.SUPABASE_URL}/functions/v1/deliver-consent-events`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.SUPABASE_WORKER_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ event_id: bufferedEvent.id, org_id: body.org_id }),
    })
  );

  return new Response(null, {
    status: 202,
    headers: { 'Access-Control-Allow-Origin': '*' },
  });
}

async function hashSHA256(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const hash = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hash))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}
```

### 4.5 Compiled Banner Script Structure

The `compileBannerScript()` function produces a self-contained vanilla JS file. It has no external dependencies and no framework. When loaded, it:

1. Checks `localStorage` for an existing consent record for this `propertyId` + `bannerId` + `version`
2. If a valid record exists, does nothing (banner already dismissed)
3. If no record exists, injects the banner DOM into the page
4. On user action (accept / save / reject), POSTs the consent event to `https://cdn.consentshield.in/v1/events`, writes the record to `localStorage`, and removes the banner

```typescript
function compileBannerScript(config: BannerConfig, orgId: string, propertyId: string): string {
  return `
(function() {
  var STORAGE_KEY = 'cs_consent_${propertyId}_v${config.version}';
  if (localStorage.getItem(STORAGE_KEY)) return;

  var ENDPOINT = 'https://cdn.consentshield.in/v1/events';
  var ORG_ID = '${orgId}';
  var PROP_ID = '${propertyId}';
  var BANNER_ID = '${config.id}';
  var VERSION = ${config.version};
  var PURPOSES = ${JSON.stringify(config.purposes)};

  function sendEvent(type, accepted, rejected) {
    fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        org_id: ORG_ID, property_id: PROP_ID, banner_id: BANNER_ID,
        banner_version: VERSION, event_type: type,
        purposes_accepted: accepted, purposes_rejected: rejected
      })
    });
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ type: type, ts: Date.now() }));
    document.getElementById('cs-banner').remove();
  }

  // Inject banner DOM + styles
  // ... (banner HTML generated from config.headline, config.body_copy, config.purposes)
  // ... (inline styles — no external CSS dependency)
  // ... (accept all / save preferences / reject all buttons wired to sendEvent())
})();
  `.trim();
}
```

---

## 5. API Surface

### 5.1 Next.js API Routes

All routes under `/app/api/`. All authenticated routes validate the Supabase session server-side using `createServerClient` from `@supabase/ssr`. RLS does the actual data isolation.

```
POST  /api/auth/signup                    Create org + member after Supabase Auth signup
GET   /api/orgs/[orgId]/banners           List banners for org
POST  /api/orgs/[orgId]/banners           Create new banner version
PATCH /api/orgs/[orgId]/banners/[id]      Update banner (creates new version, deactivates old)
POST  /api/orgs/[orgId]/banners/[id]/publish  Activate a banner version + invalidate KV cache

GET   /api/orgs/[orgId]/properties        List web properties
POST  /api/orgs/[orgId]/properties        Create web property
POST  /api/orgs/[orgId]/properties/[id]/verify  Trigger snippet verification

GET   /api/orgs/[orgId]/inventory         List data inventory items
POST  /api/orgs/[orgId]/inventory         Create data inventory item
PATCH /api/orgs/[orgId]/inventory/[id]    Update data inventory item

GET   /api/orgs/[orgId]/rights-requests   List rights requests (filterable by status)
PATCH /api/orgs/[orgId]/rights-requests/[id]  Update request status, assignee, verified
POST  /api/orgs/[orgId]/rights-requests/[id]/events  Append event to request audit trail

POST  /api/orgs/[orgId]/breach            Create breach notification + trigger notifications

GET   /api/orgs/[orgId]/reports/audit     Generate audit package data (PDF via Edge Function)
GET   /api/orgs/[orgId]/reports/score     Calculate compliance score

POST  /api/webhooks/razorpay              Razorpay subscription lifecycle events
POST  /api/webhooks/resend                Resend email delivery events (bounce tracking)

-- Public endpoints — no auth required
POST  /api/public/rights-request          Data Principal submits rights request (hosted form)
GET   /api/public/privacy-notice/[orgId]  Hosted privacy notice page data
```

### 5.2 Key Route Implementation Patterns

**Signup → org creation:**

```typescript
// POST /api/auth/signup
// Called after Supabase Auth creates the user (via Auth webhook or client-side)
export async function POST(request: Request) {
  const supabase = createServerClient(); // service role
  const { userId, orgName, industry } = await request.json();

  // Create org
  const { data: org } = await supabase
    .from('organisations')
    .insert({ name: orgName, industry })
    .select()
    .single();

  // Link user as admin
  await supabase
    .from('organisation_members')
    .insert({ org_id: org.id, user_id: userId, role: 'admin' });

  // Write to audit_log
  await supabase
    .from('audit_log')
    .insert({
      org_id: org.id,
      actor_id: userId,
      event_type: 'org_created',
      entity_type: 'organisation',
      entity_id: org.id,
    });

  return Response.json({ org });
}
```

**Banner publish (invalidate KV cache):**

```typescript
// POST /api/orgs/[orgId]/banners/[id]/publish
export async function POST(request: Request, { params }) {
  const supabase = createServerClient(); // uses user's JWT — RLS applies

  // Deactivate all other banners for this property
  await supabase
    .from('consent_banners')
    .update({ is_active: false })
    .eq('property_id', params.propertyId)
    .eq('org_id', params.orgId);

  // Activate this one
  await supabase
    .from('consent_banners')
    .update({ is_active: true })
    .eq('id', params.id);

  // Invalidate Cloudflare KV cache so new version is served immediately
  await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${env.CF_ACCOUNT_ID}/storage/kv/namespaces/${env.CF_KV_NAMESPACE}/values/banner:config:${params.propertyId}`,
    {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${env.CF_API_TOKEN}` },
    }
  );

  return Response.json({ ok: true });
}
```

### 5.3 Supabase Edge Functions

```
send-sla-reminders      Runs daily via pg_cron. Finds rights requests with sla_deadline
                        within 7 days and 1 day. Sends email via Resend. Appends
                        'sla_warning_sent' event to rights_request_events.

deliver-consent-events  Triggered by Cloudflare Worker after each consent event write.
                        Reads the org's export_configuration, writes the event payload
                        to the customer's R2 bucket (or S3/Azure/GCS for BYOS).
                        On confirmed write: sets consent_events.delivered_at, hard-deletes
                        the delivery_buffer entry. On failure: increments attempt_count,
                        schedules retry. After 10 failed attempts: alerts via Sentry and
                        holds the entry for manual review. Never silently drops an event.

deliver-audit-log       Same pattern as deliver-consent-events, runs on audit_log entries.
                        Triggered by service-role inserts to audit_log. Delivers to the
                        same customer storage destination. Ensures the compliance record
                        in customer storage is complete and current.

purge-delivered-buffers Runs nightly via pg_cron. Hard-deletes rows in consent_events,
                        audit_log, processing_log, and delivery_buffer where delivered_at
                        is not null and delivered_at < now() - interval '48 hours'.
                        Also deletes expired consent_artefact_index entries.
                        This is the mechanism that keeps ConsentShield's DB an operational
                        state store rather than an accumulating data warehouse.

generate-audit-report   Triggered by user request. For Standard mode: queries buffer tables
                        for recent undelivered data + directs user to customer storage for
                        historical data. For Insulated/Zero-Storage: generates a manifest
                        pointing to customer storage — the report data is not in ConsentShield.

verify-snippet          Triggered when a user tests their integration. Fetches their website
                        URL and checks the response HTML for the ConsentShield script tag.
                        Updates snippet_verified_at on web_properties if found.

process-rights-request  Triggered on insert to rights_requests. Sends email to compliance
                        contact via Resend. Appends 'created' event to rights_request_events.
                        Writes to audit_log. Dispatches to deliver-audit-log.
```

**`send-sla-reminders` in detail** (most critical Edge Function):

```typescript
// supabase/functions/send-sla-reminders/index.ts
Deno.serve(async () => {
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  );

  const now = new Date();
  const in7Days = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
  const in1Day  = new Date(now.getTime() + 1 * 24 * 60 * 60 * 1000);

  // Find requests needing 7-day warning
  const { data: week7 } = await supabase
    .from('rights_requests')
    .select('*, organisations(compliance_contact_email, name)')
    .eq('status', 'in_progress')
    .gte('sla_deadline', now.toISOString())
    .lte('sla_deadline', in7Days.toISOString())
    .is('response_sent_at', null);

  // Find requests needing 1-day warning
  const { data: day1 } = await supabase
    .from('rights_requests')
    .select('*, organisations(compliance_contact_email, name)')
    .eq('status', 'in_progress')
    .gte('sla_deadline', now.toISOString())
    .lte('sla_deadline', in1Day.toISOString())
    .is('response_sent_at', null);

  // Send emails via Resend for each, append events to rights_request_events
  // ...

  return new Response(JSON.stringify({ sent: (week7?.length ?? 0) + (day1?.length ?? 0) }));
});
```

Schedule via `pg_cron` (enable in Supabase dashboard):

```sql
select cron.schedule(
  'sla-reminders-daily',
  '0 8 * * *',  -- 8 AM IST daily
  $$
  select net.http_post(
    url := 'https://<project>.supabase.co/functions/v1/send-sla-reminders',
    headers := '{"Authorization": "Bearer <service_role_key>"}'::jsonb
  );
  $$
);
```

---

## 6. Key Data Flows

### Flow 1: Signup → First Consent Collected

```
1.  User visits consentshield.in, enters email
2.  Supabase Auth sends magic link or OTP
3.  User confirms → Supabase Auth creates auth.users record
4.  Client calls POST /api/auth/signup with { userId, orgName, industry }
5.  Server creates organisations row + organisation_members row (role: admin)
6.  custom_access_token_hook fires on next token refresh → injects org_id into JWT
7.  User completes onboarding wizard:
    a. Creates web_properties row
    b. Creates consent_banners row (version 1, is_active: false)
    c. POSTs to /api/orgs/[orgId]/banners/[id]/publish → activates banner, invalidates KV
8.  User copies snippet: <script src="cdn.consentshield.in/v1/banner.js?org=…&prop=…">
9.  User pastes snippet into their website <head>
10. Browser on customer's site loads banner.js from Cloudflare Worker
    → Worker checks KV (miss) → fetches from Supabase → compiles JS → caches in KV
    → Returns banner script in <50ms
11. Banner renders on customer's site
12. Site visitor clicks "Accept all"
13. Banner JS POSTs to cdn.consentshield.in/v1/events
14. Cloudflare Worker validates, hashes fingerprint, writes to consent_events via service role
15. Worker returns 202, banner dismisses
16. ConsentShield dashboard shows "First consent collected at 14:32 today" ✓
```

### Flow 2: Rights Request Received → Responded → Closed

```
1.  Data Principal visits customer's privacy notice page
    → finds "Exercise your rights" link → navigates to
      app.consentshield.in/rights/{orgId}
2.  Data Principal fills form: name, email, request type (erasure), message
3.  POST /api/public/rights-request
    → creates rights_requests row (status: 'new', sla_deadline: now + 30 days)
    → triggers process-rights-request Edge Function
4.  Edge Function:
    → sends email to compliance_contact_email via Resend
    → appends 'created' event to rights_request_events
    → writes to audit_log
5.  Compliance manager receives email (or push notification on mobile)
6.  Opens Rights Centre → clicks request
7.  PATCH /api/orgs/[orgId]/rights-requests/[id]
    → updates status to 'in_progress', assignee_id to current user
    → POST /api/orgs/[orgId]/rights-requests/[id]/events { event_type: 'assigned' }
8.  Manager verifies identity (OTP to requestor's email — implemented via Resend)
    → PATCH to set identity_verified: true, identity_verified_at, identity_method
    → event appended: 'identity_verified'
9.  Manager reviews data categories from data_inventory
    → flags retention locks (payment records cannot be erased)
    → event appended: 'data_reviewed'
10. Manager drafts response using template
    → event appended: 'response_drafted'
11. Manager sends response email to requestor via Resend
    → PATCH to set response_sent_at
    → event appended: 'response_sent'
12. Manager marks complete
    → PATCH to set status: 'completed'
    → event appended: 'closed'
    → audit_log entry written
13. Full audit trail available for export in Audit & Reports
```

### Flow 3: Razorpay Subscription Lifecycle

```
1.  User selects Growth plan on billing page
2.  Client creates Razorpay checkout session via server-side API
    → POST to Razorpay API with plan amount (₹5,999), org email
    → Returns checkout session id
3.  Client opens Razorpay checkout modal
4.  User completes payment
5.  Razorpay sends webhook: subscription.activated
6.  POST /api/webhooks/razorpay
    → Verify webhook signature using RAZORPAY_WEBHOOK_SECRET
    → PATCH organisations SET plan = 'growth', razorpay_subscription_id = ...
    → Write to audit_log: 'plan_activated'
    → Send confirmation email via Resend
7.  RLS policies remain unchanged — plan gating is enforced at the API route level
    (check org.plan before returning certain features, not at DB level)
8.  On subscription.cancelled or payment_failed:
    → PATCH organisations SET plan = 'trial'
    → Send dunning email via Resend
    → Write to audit_log: 'plan_downgraded'
```

---

## 7. Security Rules — Non-Negotiable

These rules are architectural constraints, not feature decisions. They cannot be relaxed later without rebuilding significant parts of the product.

**1. The service role key never touches the browser.** It lives in Vercel environment variables (server-side only) and in the Cloudflare Worker environment. Never in `NEXT_PUBLIC_` variables. Never in client-side code.

**2. consent_events is append-only.** No UPDATE or DELETE RLS policy exists on this table for any role. The only way to write is via the service role key from the Cloudflare Worker. The application can only SELECT. Delivered rows are hard-deleted on a nightly schedule — this is not a violation of immutability, it is the correct behaviour for a buffer that has completed its purpose.

**3. audit_log and processing_log are append-only.** Same as above. Writes only via service role from Edge Functions or server-side API routes. No client can write to these tables. Delivered rows are hard-deleted on nightly schedule.

**4. Health data (ABDM bundle, Month 6+) is never stored.** FHIR records pulled from NHA flow through ConsentShield's server in memory only — the drug interaction check fires, the prescription template populates, and the rendered output is returned to the clinic's screen. FHIR records are not written to any database table, any log, or any file. The only durable writes from an ABDM session are consent artefact index entries (artefact ID + validity state, no health content) and audit entries (timestamps and purpose references, no clinical data). Any future code that attempts to persist FHIR content must be rejected in code review without exception.

**5. org_id is always validated at two levels.** API routes check the session's org_id against the resource being requested. RLS policies enforce the same check at the database level. Both must pass. One is the application layer; the other is the database layer. Belt and braces.

**6. Razorpay webhooks are signature-verified before processing.** Every incoming webhook is rejected if the `X-Razorpay-Signature` header does not match `HMAC-SHA256(body, RAZORPAY_WEBHOOK_SECRET)`. This is implemented before any database write.

**7. The public rights request endpoint is rate-limited.** `POST /api/public/rights-request` accepts submissions without authentication. Rate limit at 5 requests per IP per hour via Vercel's edge middleware to prevent spam. Validate email format server-side. Do not trust any field from the client payload to set `org_id` — take it from the URL parameter and validate it against the organisations table.

**8. ConsentShield's database is an operational state store, not a compliance record store.** The canonical copy of every consent event, audit log entry, processing log entry, and rights request record lives in customer-owned storage. ConsentShield holds working copies in buffer tables only until confirmed delivery. Any feature, query, or report that treats ConsentShield's buffer tables as the system of record is architecturally wrong and must be corrected. Dashboard views that read from buffer tables are acceptable; compliance exports must always read from — or direct users to — customer storage.

**9. Export credentials are write-only and never logged.** The IAM credentials stored in `export_configurations.write_credential_enc` permit `PutObject` only. They are stored encrypted at rest. They are never written to any log, any error message, or any audit trail. If an export credential is compromised, the attacker gains write access to an encrypted bucket they cannot decrypt — they cannot read, list, or delete the customer's compliance records. This is the intended threat model.

**10. Processing modes are enforced at the API gateway, not in application logic.** The `storage_mode` on the `organisations` table determines the processing path for every API call. This check runs before any data is written. An organisation in Zero-Storage mode must never have FHIR content written to any table, regardless of the code path that triggered the request. This is a gateway-level rule, not a best-effort application convention.

---

## 8. Environment Variables

### Vercel (server-side only)

```bash
SUPABASE_URL=https://<project>.supabase.co
SUPABASE_ANON_KEY=<anon key>                    # Used in client-side Supabase client
SUPABASE_SERVICE_ROLE_KEY=<service role key>    # Server-side only — never NEXT_PUBLIC_

RAZORPAY_KEY_ID=<key id>
RAZORPAY_KEY_SECRET=<key secret>                # Server-side only
RAZORPAY_WEBHOOK_SECRET=<webhook secret>        # Server-side only

RESEND_API_KEY=<resend api key>                 # Server-side only

CLOUDFLARE_ACCOUNT_ID=<cf account id>
CLOUDFLARE_API_TOKEN=<cf api token>             # For KV cache invalidation from Next.js
CLOUDFLARE_KV_NAMESPACE_ID=<kv namespace id>

# R2 — default provisioned storage for Standard mode customers
CLOUDFLARE_R2_ACCESS_KEY_ID=<r2 access key>     # Write-only token scoped to provisioned buckets
CLOUDFLARE_R2_SECRET_ACCESS_KEY=<r2 secret>     # Server-side only

# Export credential encryption — used to encrypt BYOS credentials at rest
EXPORT_CREDENTIAL_ENCRYPTION_KEY=<32-byte hex>  # Server-side only. Rotate annually.
```

### Vercel (client-safe)

```bash
NEXT_PUBLIC_SUPABASE_URL=https://<project>.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=<anon key>
NEXT_PUBLIC_APP_URL=https://app.consentshield.in
NEXT_PUBLIC_CDN_URL=https://cdn.consentshield.in
```

### Cloudflare Worker

```bash
SUPABASE_URL=https://<project>.supabase.co
SUPABASE_WORKER_KEY=<cs_worker password>        # Scoped: INSERT consent_events + tracker_observations only
CF_ACCOUNT_ID=<account id>
BANNER_KV=<KV namespace binding>               # Bound in wrangler.toml, not an env var
```

### Supabase (set in dashboard, not in code)

```bash
RESEND_API_KEY=<resend api key>                 # Used by Edge Functions
APP_URL=https://app.consentshield.in
```

---

*Document prepared April 2026. All schema decisions are v1-final. Re-evaluate foreign key indexes and partitioning strategy when consent_events exceeds 10 million rows.*
