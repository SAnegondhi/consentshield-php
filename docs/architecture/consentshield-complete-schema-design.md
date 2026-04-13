# ConsentShield — Complete Schema Design

*(c) 2026 Sudhindra Anegondhi a.d.sudhindra@gmail.com*
*Source of truth for all database objects · April 2026*
*Companion to: Definitive Architecture Reference*

---

## Document Purpose

This file contains every SQL statement required to create ConsentShield's database from scratch. It is ordered for execution — run it top to bottom on a fresh Supabase Postgres instance and the database is ready.

Every table, index, policy, trigger, function, and scheduled job is here. Nothing is implied. Nothing is "obvious." If it's not in this file, it doesn't exist.

---

## Execution Order

1. Extensions
2. Helper functions
3. Tables (operational state → buffer tables → enforcement tables → phase 3-4 tables)
4. Indexes
5. Row-Level Security — enable + policies
6. Restricted database roles (deny UPDATE/DELETE on buffer tables)
7. Triggers (updated_at, SLA deadlines, breach deadlines)
8. Buffer lifecycle functions (immediate delete, sweep, stuck detection)
9. Scheduled jobs (pg_cron)
10. Verification queries (run after setup to confirm guards are active)

---

## 1. Extensions

```sql
create extension if not exists "pgcrypto";     -- Encryption for sensitive fields
create extension if not exists "pg_cron";       -- Scheduled buffer cleanup and SLA checks
create extension if not exists "uuid-ossp";     -- UUID generation (backup for gen_random_uuid)
```

---

## 2. Helper Functions

```sql
-- Returns the current user's org_id from their JWT
create or replace function current_org_id()
returns uuid language sql stable as $$
  select (auth.jwt() ->> 'org_id')::uuid;
$$;

-- Returns true if current user is an admin of their org
create or replace function is_org_admin()
returns boolean language sql stable as $$
  select (auth.jwt() ->> 'org_role') = 'admin';
$$;

-- Auto-update updated_at on mutable tables
create or replace function set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- Auto-set SLA deadline: 30 calendar days from creation
create or replace function set_rights_request_sla()
returns trigger language plpgsql as $$
begin
  new.sla_deadline = new.created_at + interval '30 days';
  return new;
end;
$$;

-- Auto-set DPB deadline: 72 hours from discovery
create or replace function set_breach_deadline()
returns trigger language plpgsql as $$
begin
  new.dpb_notification_deadline = new.discovered_at + interval '72 hours';
  return new;
end;
$$;

-- JWT custom claims hook — injects org_id and org_role into every token
create or replace function public.custom_access_token_hook(event jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  claims jsonb;
  v_org_id uuid;
  v_org_role text;
begin
  claims := event -> 'claims';
  select om.org_id, om.role into v_org_id, v_org_role
  from organisation_members om
  where om.user_id = (event ->> 'user_id')::uuid
  limit 1;
  if v_org_id is not null then
    claims := jsonb_set(claims, '{org_id}', to_jsonb(v_org_id::text));
    claims := jsonb_set(claims, '{org_role}', to_jsonb(v_org_role));
  end if;
  return jsonb_set(event, '{claims}', claims);
end;
$$;

grant execute on function public.custom_access_token_hook to supabase_auth_admin;
```

---

## 3. Tables

### 3.1 Operational State Tables (Category A — permanent)

```sql
-- ═══════════════════════════════════════════════════════════
-- ORGANISATIONS — root of all multi-tenant data
-- ═══════════════════════════════════════════════════════════
create table organisations (
  id                        uuid primary key default gen_random_uuid(),
  name                      text not null,
  industry                  text,                          -- 'saas' | 'edtech' | 'healthcare' | 'ecommerce' | 'hrtech' | 'fintech'
  plan                      text not null default 'trial', -- 'trial' | 'starter' | 'growth' | 'pro' | 'enterprise'
  storage_mode              text not null default 'standard', -- 'standard' | 'insulated' | 'zero_storage'
  plan_started_at           timestamptz default now(),
  trial_ends_at             timestamptz default (now() + interval '14 days'),
  razorpay_subscription_id  text unique,
  razorpay_customer_id      text unique,
  compliance_contact_email  text,
  dpo_name                  text,
  encryption_salt           text not null default encode(gen_random_bytes(16), 'hex'), -- per-org key derivation salt
  created_at                timestamptz default now(),
  updated_at                timestamptz default now()
);

-- ═══════════════════════════════════════════════════════════
-- ORGANISATION MEMBERS — links auth.users to organisations
-- ═══════════════════════════════════════════════════════════
create table organisation_members (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references organisations(id) on delete cascade,
  user_id     uuid not null references auth.users(id) on delete cascade,
  role        text not null default 'member',  -- 'admin' | 'member' | 'readonly' | 'auditor'
  created_at  timestamptz default now(),
  unique (org_id, user_id)
);

-- ═══════════════════════════════════════════════════════════
-- WEB PROPERTIES — each customer can have multiple sites/apps
-- ═══════════════════════════════════════════════════════════
create table web_properties (
  id                    uuid primary key default gen_random_uuid(),
  org_id                uuid not null references organisations(id) on delete cascade,
  name                  text not null,
  url                   text not null,
  allowed_origins       text[] not null default '{}',  -- validated origins for HMAC events, e.g. {'https://app.acme.com'}
  event_signing_secret  text not null default encode(gen_random_bytes(32), 'hex'), -- HMAC key compiled into banner
  snippet_verified_at   timestamptz,
  snippet_last_seen_at  timestamptz,
  created_at            timestamptz default now(),
  updated_at            timestamptz default now()
);

-- ═══════════════════════════════════════════════════════════
-- CONSENT BANNERS — versioned. Every change = new version.
-- ═══════════════════════════════════════════════════════════
create table consent_banners (
  id                  uuid primary key default gen_random_uuid(),
  org_id              uuid not null references organisations(id) on delete cascade,
  property_id         uuid not null references web_properties(id) on delete cascade,
  version             integer not null default 1,
  is_active           boolean not null default false,
  headline            text not null,
  body_copy           text not null,
  position            text not null default 'bottom-bar',
  purposes            jsonb not null default '[]',
  monitoring_enabled  boolean not null default true,
  created_at          timestamptz default now(),
  unique (property_id, version)
);

-- Purpose object schema: { id, name, description, required, default }

-- ═══════════════════════════════════════════════════════════
-- DATA INVENTORY — maps data flows
-- ═══════════════════════════════════════════════════════════
create table data_inventory (
  id                uuid primary key default gen_random_uuid(),
  org_id            uuid not null references organisations(id) on delete cascade,
  data_category     text not null,
  collection_source text,
  purposes          text[] not null default '{}',
  legal_basis       text not null default 'consent',
  retention_period  text,
  third_parties     text[] not null default '{}',
  data_locations    text[] not null default '{}',     -- ['IN', 'US', 'EU']
  source_type       text not null default 'manual',   -- 'manual' | 'auto_detected'
  notes             text,
  is_complete       boolean not null default false,
  created_at        timestamptz default now(),
  updated_at        timestamptz default now()
);

-- ═══════════════════════════════════════════════════════════
-- BREACH NOTIFICATIONS — one per breach event
-- ═══════════════════════════════════════════════════════════
create table breach_notifications (
  id                          uuid primary key default gen_random_uuid(),
  org_id                      uuid not null references organisations(id) on delete cascade,
  discovered_at               timestamptz not null,
  reported_by                 uuid not null references auth.users(id),
  dpb_notification_deadline   timestamptz not null,      -- auto-set: discovered_at + 72h
  dpb_notified_at             timestamptz,
  affected_categories         text[] not null default '{}',
  estimated_affected_count    integer,
  description                 text,
  incident_reference          text,
  status                      text not null default 'open',
  created_at                  timestamptz default now(),
  updated_at                  timestamptz default now()
);

-- ═══════════════════════════════════════════════════════════
-- RIGHTS REQUESTS — one per Data Principal request
-- ═══════════════════════════════════════════════════════════
create table rights_requests (
  id                      uuid primary key default gen_random_uuid(),
  org_id                  uuid not null references organisations(id) on delete cascade,
  request_type            text not null,             -- 'erasure' | 'access' | 'correction' | 'nomination'
  requestor_name          text not null,
  requestor_email         text not null,
  requestor_message       text,
  turnstile_verified      boolean not null default false,  -- Cloudflare Turnstile bot check passed
  email_verified          boolean not null default false,  -- OTP email verification passed
  email_verified_at       timestamptz,                     -- when OTP was confirmed
  identity_verified       boolean not null default false,
  identity_verified_at    timestamptz,
  identity_verified_by    uuid references auth.users(id),
  identity_method         text,
  status                  text not null default 'new',
  assignee_id             uuid references auth.users(id),
  sla_deadline            timestamptz not null,      -- auto-set: created_at + 30 days
  response_sent_at        timestamptz,
  closure_notes           text,
  created_at              timestamptz default now(),
  updated_at              timestamptz default now()
);

-- ═══════════════════════════════════════════════════════════
-- EXPORT CONFIGURATIONS — per-org storage destination
-- ═══════════════════════════════════════════════════════════
create table export_configurations (
  id                    uuid primary key default gen_random_uuid(),
  org_id                uuid not null references organisations(id) on delete cascade,
  storage_provider      text not null default 'r2',    -- 'r2' | 's3'
  bucket_name           text not null,
  path_prefix           text not null default '',
  region                text,
  write_credential_enc  bytea not null,                -- pgcrypto-encrypted IAM credential
  is_verified           boolean not null default false,
  last_export_at        timestamptz,
  created_at            timestamptz default now(),
  updated_at            timestamptz default now(),
  unique (org_id)
);

-- ═══════════════════════════════════════════════════════════
-- TRACKER SIGNATURES — reference data (not per-org)
-- ═══════════════════════════════════════════════════════════
create table tracker_signatures (
  id              uuid primary key default gen_random_uuid(),
  service_name    text not null,
  service_slug    text not null unique,
  category        text not null,             -- 'analytics' | 'marketing' | 'personalisation' | 'functional'
  detection_rules jsonb not null,
  data_locations  text[] not null default '{}',
  is_functional   boolean not null default false,
  version         integer not null default 1,
  created_at      timestamptz default now(),
  updated_at      timestamptz default now()
);

-- ═══════════════════════════════════════════════════════════
-- TRACKER OVERRIDES — per-org false positive config
-- ═══════════════════════════════════════════════════════════
create table tracker_overrides (
  id                uuid primary key default gen_random_uuid(),
  org_id            uuid not null references organisations(id) on delete cascade,
  property_id       uuid references web_properties(id) on delete cascade,
  domain_pattern    text not null,
  override_category text not null,
  reason            text,
  created_at        timestamptz default now(),
  updated_at        timestamptz default now(),
  unique (org_id, property_id, domain_pattern)
);

-- ═══════════════════════════════════════════════════════════
-- INTEGRATION CONNECTORS — deletion API connections
-- ═══════════════════════════════════════════════════════════
create table integration_connectors (
  id              uuid primary key default gen_random_uuid(),
  org_id          uuid not null references organisations(id) on delete cascade,
  connector_type  text not null,
  display_name    text not null,
  config          bytea not null,            -- pgcrypto-encrypted: OAuth tokens, webhook URLs
  status          text not null default 'active',
  last_health_check_at timestamptz,
  last_error      text,
  created_at      timestamptz default now(),
  updated_at      timestamptz default now()
);

-- ═══════════════════════════════════════════════════════════
-- RETENTION RULES — per-org data lifecycle
-- ═══════════════════════════════════════════════════════════
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

-- ═══════════════════════════════════════════════════════════
-- NOTIFICATION CHANNELS — alert delivery config
-- ═══════════════════════════════════════════════════════════
create table notification_channels (
  id              uuid primary key default gen_random_uuid(),
  org_id          uuid not null references organisations(id) on delete cascade,
  channel_type    text not null,             -- 'email' | 'slack' | 'teams' | 'discord' | 'webhook'
  config          jsonb not null,            -- webhook_url, channel, auth
  alert_types     text[] not null default '{}', -- which alert types this channel receives
  is_active       boolean not null default true,
  created_at      timestamptz default now(),
  updated_at      timestamptz default now()
);

-- ═══════════════════════════════════════════════════════════
-- CONSENT ARTEFACT INDEX — active consent validation cache
-- No personal data. TTL-based. Operational state only.
-- ═══════════════════════════════════════════════════════════
create table consent_artefact_index (
  id                  uuid primary key default gen_random_uuid(),
  org_id              uuid not null references organisations(id) on delete cascade,
  artefact_id         text not null,
  validity_state      text not null default 'active',  -- 'active' | 'revoked' | 'expired'
  expires_at          timestamptz not null,
  created_at          timestamptz default now(),
  unique (org_id, artefact_id)
);
```

### 3.2 Buffer Tables (Category B — transient, deliver then delete)

**CRITICAL: These tables use `bytea` for no fields that could hold personal data in plaintext. All personal data fields are hashed or transient. The buffer lifecycle (Section 8) enforces immediate deletion after confirmed delivery.**

```sql
-- ═══════════════════════════════════════════════════════════
-- DELIVERY BUFFER — write-ahead log for export pipeline
-- A row here means: "this event has been generated but not
-- yet confirmed delivered to customer storage."
-- Retention: seconds to minutes. NEVER hours.
-- ═══════════════════════════════════════════════════════════
create table delivery_buffer (
  id                 uuid primary key default gen_random_uuid(),
  org_id             uuid not null references organisations(id) on delete cascade,
  event_type         text not null,               -- 'consent_event' | 'audit_entry' | 'tracker_obs' | etc.
  payload            jsonb not null,              -- the event to export
  export_config_id   uuid references export_configurations(id),
  attempt_count      integer not null default 0,
  first_attempted_at timestamptz,
  last_attempted_at  timestamptz,
  delivered_at       timestamptz,                 -- set on confirmed write. Row deleted immediately after.
  delivery_error     text,
  created_at         timestamptz default now()
  -- NO updated_at. Buffer, not mutable state.
  -- Rows with delivered_at IS NOT NULL are deleted immediately by the delivery function.
  -- Rows with attempt_count > 10 trigger an alert and are held for manual review.
);

create index idx_delivery_buffer_undelivered on delivery_buffer (org_id, delivered_at) where delivered_at is null;
create index idx_delivery_buffer_stale on delivery_buffer (created_at) where delivered_at is null;

-- ═══════════════════════════════════════════════════════════
-- CONSENT EVENTS — the most important buffer in the system
-- Legally significant. Append-only for authenticated users.
-- Written by Cloudflare Worker via service role.
-- Delivered to customer storage, then DELETED.
-- ═══════════════════════════════════════════════════════════
create table consent_events (
  id                  uuid primary key default gen_random_uuid(),
  org_id              uuid not null,             -- denormalised, no FK (avoids join for RLS)
  property_id         uuid not null references web_properties(id),
  banner_id           uuid not null references consent_banners(id),
  banner_version      integer not null,
  session_fingerprint text not null,             -- SHA-256(user_agent + truncated_ip + org_id)
  event_type          text not null,             -- 'consent_given' | 'consent_withdrawn' | 'purpose_updated' | 'banner_dismissed'
  purposes_accepted   jsonb not null default '[]',
  purposes_rejected   jsonb not null default '[]',
  ip_truncated        text,                      -- last octet removed
  user_agent_hash     text,                      -- SHA-256, not raw
  delivered_at        timestamptz,               -- set on confirmed export. Row deleted immediately after.
  created_at          timestamptz default now()
  -- NO updated_at. APPEND-ONLY. No UPDATE or DELETE policy for any authenticated role.
);

create index idx_consent_events_org_time on consent_events (org_id, property_id, created_at desc);
create index idx_consent_events_undelivered on consent_events (delivered_at) where delivered_at is null;
create index idx_consent_events_delivered_stale on consent_events (delivered_at) where delivered_at is not null;

-- ═══════════════════════════════════════════════════════════
-- TRACKER OBSERVATIONS — what the banner script detected
-- ═══════════════════════════════════════════════════════════
create table tracker_observations (
  id                  uuid primary key default gen_random_uuid(),
  org_id              uuid not null references organisations(id) on delete cascade,
  property_id         uuid not null references web_properties(id) on delete cascade,
  session_fingerprint text not null,
  consent_state       jsonb not null,
  trackers_detected   jsonb not null,
  violations          jsonb not null default '[]',
  page_url_hash       text,                      -- SHA-256 of URL, not the URL itself
  observed_at         timestamptz default now(),
  delivered_at        timestamptz,
  created_at          timestamptz default now()
);

create index idx_tracker_obs_violations on tracker_observations (org_id, observed_at desc) where violations != '[]'::jsonb;
create index idx_tracker_obs_undelivered on tracker_observations (delivered_at) where delivered_at is null;
create index idx_tracker_obs_delivered_stale on tracker_observations (delivered_at) where delivered_at is not null;

-- ═══════════════════════════════════════════════════════════
-- AUDIT LOG — every significant action. Append-only buffer.
-- ═══════════════════════════════════════════════════════════
create table audit_log (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null,                   -- denormalised, no FK (same pattern as consent_events — avoids join for RLS)
  actor_id     uuid,
  actor_email  text,                            -- denormalised
  event_type   text not null,
  entity_type  text,
  entity_id    uuid,
  payload      jsonb,
  ip_address   text,
  delivered_at timestamptz,
  created_at   timestamptz default now()
  -- APPEND-ONLY. No UPDATE or DELETE policy.
);

create index idx_audit_log_org_time on audit_log (org_id, created_at desc);
create index idx_audit_log_undelivered on audit_log (delivered_at) where delivered_at is null;
create index idx_audit_log_delivered_stale on audit_log (delivered_at) where delivered_at is not null;

-- ═══════════════════════════════════════════════════════════
-- PROCESSING LOG — continuous record of processing activities
-- ═══════════════════════════════════════════════════════════
create table processing_log (
  id                uuid primary key default gen_random_uuid(),
  org_id            uuid not null references organisations(id) on delete cascade,
  activity_name     text not null,
  data_categories   text[] not null,
  purpose           text not null,
  legal_basis       text not null,
  processor_name    text,
  third_parties     text[] not null default '{}',
  data_subjects_count integer,
  delivered_at      timestamptz,
  created_at        timestamptz default now()
);

create index idx_processing_log_org_time on processing_log (org_id, created_at desc);
create index idx_processing_log_undelivered on processing_log (delivered_at) where delivered_at is null;
create index idx_processing_log_delivered_stale on processing_log (delivered_at) where delivered_at is not null;

-- ═══════════════════════════════════════════════════════════
-- RIGHTS REQUEST EVENTS — append-only workflow audit trail
-- ═══════════════════════════════════════════════════════════
create table rights_request_events (
  id           uuid primary key default gen_random_uuid(),
  request_id   uuid not null references rights_requests(id) on delete cascade,
  org_id       uuid not null,                   -- denormalised, no FK (same pattern as consent_events — avoids join for RLS)
  actor_id     uuid references auth.users(id),
  event_type   text not null,
  notes        text,
  metadata     jsonb,
  delivered_at timestamptz,
  created_at   timestamptz default now()
  -- APPEND-ONLY. No UPDATE or DELETE policy.
);

create index idx_rr_events_request on rights_request_events (request_id, created_at);
create index idx_rr_events_undelivered on rights_request_events (delivered_at) where delivered_at is null;

-- ═══════════════════════════════════════════════════════════
-- DELETION RECEIPTS — proof that data was actually deleted
-- ═══════════════════════════════════════════════════════════
create table deletion_receipts (
  id                uuid primary key default gen_random_uuid(),
  org_id            uuid not null references organisations(id) on delete cascade,
  trigger_type      text not null,             -- 'erasure_request' | 'retention_expired' | 'consent_withdrawn'
  trigger_id        uuid,
  connector_id      uuid references integration_connectors(id),
  target_system     text not null,
  identifier_hash   text not null,             -- SHA-256 of the data principal identifier
  status            text not null default 'pending',
  request_payload   jsonb,                     -- PII-redacted
  response_payload  jsonb,
  requested_at      timestamptz default now(),
  confirmed_at      timestamptz,
  failure_reason    text,
  retry_count       integer default 0,
  delivered_at      timestamptz,
  created_at        timestamptz default now()
);

create index idx_deletion_receipts_org on deletion_receipts (org_id, created_at desc);
create index idx_deletion_receipts_pending on deletion_receipts (status) where status = 'pending';
create index idx_deletion_receipts_undelivered on deletion_receipts (delivered_at) where delivered_at is null;

-- ═══════════════════════════════════════════════════════════
-- WITHDRAWAL VERIFICATIONS — consent withdrawal enforcement
-- ═══════════════════════════════════════════════════════════
create table withdrawal_verifications (
  id                    uuid primary key default gen_random_uuid(),
  org_id                uuid not null references organisations(id) on delete cascade,
  property_id           uuid not null references web_properties(id) on delete cascade,
  consent_event_id      uuid,
  withdrawn_purposes    text[] not null,
  scan_schedule         jsonb not null,
  scan_results          jsonb not null default '[]',
  overall_status        text not null default 'pending',
  delivered_at          timestamptz,
  created_at            timestamptz default now()
);

create index idx_withdrawal_ver_org on withdrawal_verifications (org_id, overall_status, created_at desc);

-- ═══════════════════════════════════════════════════════════
-- SECURITY SCANS — nightly posture check results
-- ═══════════════════════════════════════════════════════════
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
  delivered_at    timestamptz,
  created_at      timestamptz default now()
);

create index idx_security_scans_org on security_scans (org_id, property_id, scanned_at desc);

-- ═══════════════════════════════════════════════════════════
-- CONSENT PROBE RUNS — synthetic compliance test results
-- ═══════════════════════════════════════════════════════════
create table consent_probe_runs (
  id              uuid primary key default gen_random_uuid(),
  probe_id        uuid not null,              -- references consent_probes(id)
  org_id          uuid not null references organisations(id) on delete cascade,
  consent_state   jsonb not null,
  trackers_detected jsonb not null,
  violations      jsonb not null default '[]',
  page_html_hash  text,
  duration_ms     integer,
  status          text not null,
  error_message   text,
  run_at          timestamptz default now(),
  delivered_at    timestamptz
);

create index idx_probe_runs_org on consent_probe_runs (org_id, probe_id, run_at desc);
```

### 3.3 Phase 3 Tables (operational state)

```sql
-- Consent probes — scheduled synthetic tests
create table consent_probes (
  id                uuid primary key default gen_random_uuid(),
  org_id            uuid not null references organisations(id) on delete cascade,
  property_id       uuid not null references web_properties(id) on delete cascade,
  probe_type        text not null,
  consent_state     jsonb not null,
  schedule          text not null default 'weekly',
  last_run_at       timestamptz,
  last_result       jsonb,
  next_run_at       timestamptz,
  is_active         boolean not null default true,
  created_at        timestamptz default now(),
  updated_at        timestamptz default now()
);

-- API keys
create table api_keys (
  id              uuid primary key default gen_random_uuid(),
  org_id          uuid not null references organisations(id) on delete cascade,
  key_hash        text not null unique,        -- SHA-256 of the key (never store plaintext)
  key_prefix      text not null,               -- first 8 chars: 'cs_live_xxxxxxxx'
  name            text not null,
  scopes          text[] not null default '{}',
  last_used_at    timestamptz,
  expires_at      timestamptz,
  is_active       boolean not null default true,
  created_at      timestamptz default now()
);

-- GDPR configuration
create table gdpr_configurations (
  id                    uuid primary key default gen_random_uuid(),
  org_id                uuid not null references organisations(id) on delete cascade,
  enabled               boolean not null default false,
  legal_bases           jsonb not null default '[]',
  dpa_contacts          jsonb default '[]',
  representative_name   text,
  representative_email  text,
  dpia_required         boolean default false,
  created_at            timestamptz default now(),
  updated_at            timestamptz default now(),
  unique (org_id)
);

-- Sector templates
create table sector_templates (
  id              uuid primary key default gen_random_uuid(),
  sector          text not null unique,
  display_name    text not null,
  privacy_notice_template jsonb not null,
  data_inventory_defaults jsonb not null,
  tracker_allowlist jsonb not null,
  consent_purposes jsonb not null,
  risk_categories jsonb not null,
  parental_consent_required boolean default false,
  created_at      timestamptz default now(),
  updated_at      timestamptz default now()
);

-- DPO marketplace
create table dpo_partners (
  id              uuid primary key default gen_random_uuid(),
  name            text not null,
  firm_name       text,
  email           text not null,
  phone           text,
  specialisations text[] default '{}',
  languages       text[] default '{}',
  monthly_fee_range jsonb,
  bio             text,
  is_active       boolean default true,
  created_at      timestamptz default now()
);

create table dpo_engagements (
  id              uuid primary key default gen_random_uuid(),
  org_id          uuid not null references organisations(id) on delete cascade,
  dpo_id          uuid not null references dpo_partners(id),
  status          text not null default 'requested',
  started_at      timestamptz,
  ended_at        timestamptz,
  referral_fee_percent numeric default 15,
  created_at      timestamptz default now()
);

-- Cross-border transfer declarations
create table cross_border_transfers (
  id                    uuid primary key default gen_random_uuid(),
  org_id                uuid not null references organisations(id) on delete cascade,
  destination_country   text not null,
  destination_entity    text not null,
  data_categories       text[] not null,
  legal_basis           text not null,
  safeguards            text,
  transfer_volume       text,
  auto_detected         boolean default false,
  declared_by_user      boolean default false,
  scc_status            text,                  -- 'signed' | 'pending' | 'not_required'
  status                text not null default 'active',
  created_at            timestamptz default now(),
  updated_at            timestamptz default now()
);

-- White-label config
create table white_label_configs (
  id              uuid primary key default gen_random_uuid(),
  org_id          uuid not null references organisations(id) on delete cascade,
  brand_name      text not null,
  logo_url        text,
  primary_colour  text default '#1E40AF',
  banner_domain   text,
  portal_domain   text,
  email_from_name text,
  email_from_domain text,
  is_active       boolean default true,
  created_at      timestamptz default now(),
  updated_at      timestamptz default now()
);
```

---

## 4. Row-Level Security

### 4.1 Enable RLS on ALL tables

```sql
-- No table is exempt. If it has data, it has RLS.
alter table organisations            enable row level security;
alter table organisation_members     enable row level security;
alter table web_properties           enable row level security;
alter table consent_banners          enable row level security;
alter table consent_events           enable row level security;
alter table data_inventory           enable row level security;
alter table rights_requests          enable row level security;
alter table rights_request_events    enable row level security;
alter table processing_log           enable row level security;
alter table breach_notifications     enable row level security;
alter table audit_log                enable row level security;
alter table delivery_buffer          enable row level security;
alter table export_configurations    enable row level security;
alter table consent_artefact_index   enable row level security;
alter table tracker_observations     enable row level security;
alter table tracker_overrides        enable row level security;
alter table integration_connectors   enable row level security;
alter table retention_rules          enable row level security;
alter table notification_channels    enable row level security;
alter table deletion_receipts        enable row level security;
alter table withdrawal_verifications enable row level security;
alter table security_scans           enable row level security;
alter table consent_probes           enable row level security;
alter table consent_probe_runs       enable row level security;
alter table api_keys                 enable row level security;
alter table gdpr_configurations      enable row level security;
alter table dpo_engagements          enable row level security;
alter table cross_border_transfers   enable row level security;
alter table white_label_configs      enable row level security;
-- tracker_signatures, sector_templates, dpo_partners: public reference data — RLS allows select for all authenticated
alter table tracker_signatures       enable row level security;
alter table sector_templates         enable row level security;
alter table dpo_partners             enable row level security;
```

### 4.2 Policies — Operational Tables (read/write by org)

```sql
-- Pattern: org members can read and write their own org's data
-- Apply this macro to: web_properties, consent_banners, data_inventory,
-- breach_notifications, tracker_overrides, integration_connectors,
-- retention_rules, notification_channels, export_configurations,
-- consent_artefact_index, consent_probes, api_keys, gdpr_configurations,
-- dpo_engagements, cross_border_transfers, white_label_configs

-- organisations
create policy "members can view own org" on organisations for select using (id = current_org_id());
create policy "admins can update own org" on organisations for update using (id = current_org_id() and is_org_admin());

-- organisation_members
create policy "members can view org members" on organisation_members for select using (org_id = current_org_id());
create policy "admins can manage members" on organisation_members for all using (org_id = current_org_id() and is_org_admin());

-- Standard org-scoped CRUD (generate for each operational table)
-- Using web_properties as example; apply same pattern to all operational tables listed above:
create policy "org_select" on web_properties for select using (org_id = current_org_id());
create policy "org_insert" on web_properties for insert with check (org_id = current_org_id());
create policy "org_update" on web_properties for update using (org_id = current_org_id());
create policy "org_delete" on web_properties for delete using (org_id = current_org_id() and is_org_admin());

-- Repeat for: consent_banners, data_inventory, breach_notifications, tracker_overrides,
-- integration_connectors, retention_rules, notification_channels, export_configurations,
-- consent_artefact_index, consent_probes, api_keys, gdpr_configurations,
-- dpo_engagements, cross_border_transfers, white_label_configs
```

### 4.3 Policies — Buffer Tables (read-only for users, written by service role)

```sql
-- consent_events: org members can READ. NO insert/update/delete for any user role.
create policy "org_read_consent_events" on consent_events for select using (org_id = current_org_id());

-- tracker_observations
create policy "org_read_tracker_obs" on tracker_observations for select using (org_id = current_org_id());

-- audit_log
create policy "org_read_audit_log" on audit_log for select using (org_id = current_org_id());

-- processing_log
create policy "org_read_processing_log" on processing_log for select using (org_id = current_org_id());

-- rights_request_events
create policy "org_read_rr_events" on rights_request_events for select using (org_id = current_org_id());

-- deletion_receipts
create policy "org_read_deletion_receipts" on deletion_receipts for select using (org_id = current_org_id());

-- withdrawal_verifications
create policy "org_read_withdrawal_ver" on withdrawal_verifications for select using (org_id = current_org_id());

-- security_scans
create policy "org_read_security_scans" on security_scans for select using (org_id = current_org_id());

-- consent_probe_runs
create policy "org_read_probe_runs" on consent_probe_runs for select using (org_id = current_org_id());

-- delivery_buffer
create policy "org_read_delivery_buffer" on delivery_buffer for select using (org_id = current_org_id());

-- NO insert, update, or delete policies on ANY of the above tables.
-- All writes come through the service role key which bypasses RLS.
```

### 4.4 Policies — Special Cases

```sql
-- rights_requests: public insert (Data Principal submits from hosted form)
create policy "org_read_rights_requests" on rights_requests for select using (org_id = current_org_id());
create policy "org_update_rights_requests" on rights_requests for update using (org_id = current_org_id());
create policy "public_insert_rights_requests" on rights_requests for insert with check (true);

-- Reference data: any authenticated user can read
create policy "auth_read_tracker_sigs" on tracker_signatures for select using (auth.role() = 'authenticated');
create policy "auth_read_sector_templates" on sector_templates for select using (auth.role() = 'authenticated');
create policy "auth_read_dpo_partners" on dpo_partners for select using (auth.role() = 'authenticated');
```

---

## 5. Scoped Database Roles

Three custom roles replace the single service role key in all running application code. The full `service_role` is retained for migrations and emergency admin only.

### 5.1 Role Creation

```sql
-- ═══════════════════════════════════════════════════════════
-- ROLE: cs_worker — used by Cloudflare Worker ONLY
-- Principle: can write consent events and tracker observations.
-- Cannot read any other table. If this credential leaks,
-- the attacker can insert garbage but cannot read any data.
-- ═══════════════════════════════════════════════════════════
create role cs_worker with login password '<generate-strong-password>';

grant usage on schema public to cs_worker;

-- Can INSERT into consent event and observation buffers
grant insert on consent_events to cs_worker;
grant insert on tracker_observations to cs_worker;

-- Can SELECT banner config and web property info (to serve banners and verify HMAC)
grant select on consent_banners to cs_worker;
grant select on web_properties to cs_worker;

-- Can UPDATE snippet_last_seen_at on web_properties (non-blocking async update)
grant update (snippet_last_seen_at) on web_properties to cs_worker;

-- Can SELECT sequences (required for INSERT with gen_random_uuid)
grant usage on all sequences in schema public to cs_worker;

-- EXPLICITLY DENY everything else
-- (PostgreSQL denies by default, but being explicit for documentation)
revoke all on organisations from cs_worker;
revoke all on organisation_members from cs_worker;
revoke all on rights_requests from cs_worker;
revoke all on audit_log from cs_worker;
revoke all on processing_log from cs_worker;
revoke all on integration_connectors from cs_worker;
revoke all on export_configurations from cs_worker;
revoke all on delivery_buffer from cs_worker;

-- ═══════════════════════════════════════════════════════════
-- ROLE: cs_delivery — used by delivery Edge Function ONLY
-- Principle: can read undelivered buffer rows, mark them delivered,
-- and delete them. Can read export config (to know where to deliver).
-- Cannot read any operational data.
-- ═══════════════════════════════════════════════════════════
create role cs_delivery with login password '<generate-strong-password>';

grant usage on schema public to cs_delivery;

-- Can SELECT undelivered rows from all buffer tables
grant select on consent_events to cs_delivery;
grant select on tracker_observations to cs_delivery;
grant select on audit_log to cs_delivery;
grant select on processing_log to cs_delivery;
grant select on delivery_buffer to cs_delivery;
grant select on rights_request_events to cs_delivery;
grant select on deletion_receipts to cs_delivery;
grant select on withdrawal_verifications to cs_delivery;
grant select on security_scans to cs_delivery;
grant select on consent_probe_runs to cs_delivery;

-- Can UPDATE delivered_at on all buffer tables
grant update (delivered_at) on consent_events to cs_delivery;
grant update (delivered_at) on tracker_observations to cs_delivery;
grant update (delivered_at) on audit_log to cs_delivery;
grant update (delivered_at) on processing_log to cs_delivery;
grant update (delivered_at) on delivery_buffer to cs_delivery;
grant update (delivered_at) on rights_request_events to cs_delivery;
grant update (delivered_at) on deletion_receipts to cs_delivery;
grant update (delivered_at) on withdrawal_verifications to cs_delivery;
grant update (delivered_at) on security_scans to cs_delivery;
grant update (delivered_at) on consent_probe_runs to cs_delivery;

-- Can DELETE delivered rows from all buffer tables
grant delete on consent_events to cs_delivery;
grant delete on tracker_observations to cs_delivery;
grant delete on audit_log to cs_delivery;
grant delete on processing_log to cs_delivery;
grant delete on delivery_buffer to cs_delivery;
grant delete on rights_request_events to cs_delivery;
grant delete on deletion_receipts to cs_delivery;
grant delete on withdrawal_verifications to cs_delivery;
grant delete on security_scans to cs_delivery;
grant delete on consent_probe_runs to cs_delivery;

-- Can read export configuration (encrypted credentials — needs master key to decrypt)
grant select on export_configurations to cs_delivery;

-- Can clean expired artefact index entries
grant delete on consent_artefact_index to cs_delivery;
grant select on consent_artefact_index to cs_delivery;

grant usage on all sequences in schema public to cs_delivery;

-- EXPLICITLY DENY operational tables
revoke all on organisations from cs_delivery;
revoke all on organisation_members from cs_delivery;
revoke all on consent_banners from cs_delivery;
revoke all on integration_connectors from cs_delivery;

-- ═══════════════════════════════════════════════════════════
-- ROLE: cs_orchestrator — used by all other Edge Functions
-- Principle: can write to audit/processing/deletion tables,
-- can read operational data needed for orchestration.
-- Cannot directly read or delete consent_events.
-- ═══════════════════════════════════════════════════════════
create role cs_orchestrator with login password '<generate-strong-password>';

grant usage on schema public to cs_orchestrator;

-- Can INSERT into orchestration-written buffer tables
grant insert on audit_log to cs_orchestrator;
grant insert on processing_log to cs_orchestrator;
grant insert on rights_request_events to cs_orchestrator;
grant insert on deletion_receipts to cs_orchestrator;
grant insert on withdrawal_verifications to cs_orchestrator;
grant insert on security_scans to cs_orchestrator;
grant insert on consent_probe_runs to cs_orchestrator;
grant insert on delivery_buffer to cs_orchestrator;

-- Can read operational tables needed for orchestration
grant select on organisations to cs_orchestrator;
grant select on organisation_members to cs_orchestrator;
grant select on web_properties to cs_orchestrator;
grant select on integration_connectors to cs_orchestrator;
grant select on retention_rules to cs_orchestrator;
grant select on notification_channels to cs_orchestrator;
grant select on rights_requests to cs_orchestrator;
grant select on consent_artefact_index to cs_orchestrator;
grant select on consent_probes to cs_orchestrator;
grant select on data_inventory to cs_orchestrator;

-- Can update specific fields for automated workflows
grant update (status) on rights_requests to cs_orchestrator;
grant update (assignee_id) on rights_requests to cs_orchestrator;
grant update (plan, plan_started_at, razorpay_subscription_id, razorpay_customer_id) on organisations to cs_orchestrator;
grant update (validity_state) on consent_artefact_index to cs_orchestrator;
grant update (last_run_at, last_result, next_run_at) on consent_probes to cs_orchestrator;
grant update (last_health_check_at, last_error, status) on integration_connectors to cs_orchestrator;
grant update (last_checked_at, next_check_at) on retention_rules to cs_orchestrator;
grant update (status, confirmed_at, response_payload, failure_reason, retry_count) on deletion_receipts to cs_orchestrator;
grant update (scan_results, overall_status) on withdrawal_verifications to cs_orchestrator;

grant usage on all sequences in schema public to cs_orchestrator;

-- EXPLICITLY DENY direct access to consent events (Worker's domain)
revoke all on consent_events from cs_orchestrator;
revoke all on tracker_observations from cs_orchestrator;
```

### 5.2 Authenticated Role Restrictions (unchanged from before)

RLS prevents cross-tenant access. Role-level REVOKE prevents the application from modifying buffer tables even within the current org.

```sql
-- REVOKE UPDATE and DELETE on all buffer tables for the authenticated role
revoke update, delete on consent_events from authenticated;
revoke update, delete on tracker_observations from authenticated;
revoke update, delete on audit_log from authenticated;
revoke update, delete on processing_log from authenticated;
revoke update, delete on rights_request_events from authenticated;
revoke update, delete on delivery_buffer from authenticated;
revoke update, delete on deletion_receipts from authenticated;
revoke update, delete on withdrawal_verifications from authenticated;
revoke update, delete on security_scans from authenticated;
revoke update, delete on consent_probe_runs from authenticated;

-- REVOKE INSERT on critical buffers (written only by scoped roles)
revoke insert on consent_events from authenticated;
revoke insert on tracker_observations from authenticated;
revoke insert on audit_log from authenticated;
revoke insert on processing_log from authenticated;
revoke insert on delivery_buffer from authenticated;
```

---

## 6. Triggers

```sql
-- Auto-update updated_at on all mutable operational tables
create trigger trg_updated_at_organisations before update on organisations for each row execute function set_updated_at();
create trigger trg_updated_at_web_properties before update on web_properties for each row execute function set_updated_at();
create trigger trg_updated_at_data_inventory before update on data_inventory for each row execute function set_updated_at();
create trigger trg_updated_at_rights_requests before update on rights_requests for each row execute function set_updated_at();
create trigger trg_updated_at_breach_notifications before update on breach_notifications for each row execute function set_updated_at();
create trigger trg_updated_at_export_configs before update on export_configurations for each row execute function set_updated_at();
create trigger trg_updated_at_tracker_overrides before update on tracker_overrides for each row execute function set_updated_at();
create trigger trg_updated_at_integration_connectors before update on integration_connectors for each row execute function set_updated_at();
create trigger trg_updated_at_retention_rules before update on retention_rules for each row execute function set_updated_at();
create trigger trg_updated_at_notification_channels before update on notification_channels for each row execute function set_updated_at();
create trigger trg_updated_at_consent_probes before update on consent_probes for each row execute function set_updated_at();
create trigger trg_updated_at_gdpr_configs before update on gdpr_configurations for each row execute function set_updated_at();
create trigger trg_updated_at_cross_border before update on cross_border_transfers for each row execute function set_updated_at();
create trigger trg_updated_at_white_label before update on white_label_configs for each row execute function set_updated_at();

-- Auto-set legal deadlines
create trigger trg_sla_deadline before insert on rights_requests for each row execute function set_rights_request_sla();
create trigger trg_breach_deadline before insert on breach_notifications for each row execute function set_breach_deadline();
```

---

## 7. Buffer Lifecycle Functions

These functions implement the "process, deliver, delete" pipeline. They are called by Edge Functions using the service role key.

```sql
-- ═══════════════════════════════════════════════════════════
-- FUNCTION: Mark a buffer row as delivered and delete it
-- Called immediately after confirmed write to customer storage.
-- Two-step: SET delivered_at, then DELETE. Both in one function call.
-- This matches the definitive architecture Section 7.1 specification.
-- ═══════════════════════════════════════════════════════════
create or replace function mark_delivered_and_delete(
  p_table_name text,
  p_row_id uuid
) returns void language plpgsql security definer as $$
begin
  execute format(
    'UPDATE %I SET delivered_at = now() WHERE id = $1 AND delivered_at IS NULL',
    p_table_name
  ) using p_row_id;

  execute format(
    'DELETE FROM %I WHERE id = $1 AND delivered_at IS NOT NULL',
    p_table_name
  ) using p_row_id;
end;
$$;

-- ═══════════════════════════════════════════════════════════
-- FUNCTION: Sweep — safety net for rows that survived immediate delete
-- Should find 0 rows in normal operation. Finding rows = investigate.
-- ═══════════════════════════════════════════════════════════
create or replace function sweep_delivered_buffers()
returns jsonb language plpgsql security definer as $$
declare
  counts jsonb := '{}';
  c integer;
begin
  delete from consent_events where delivered_at is not null and delivered_at < now() - interval '5 minutes';
  get diagnostics c = row_count; counts := counts || jsonb_build_object('consent_events', c);

  delete from tracker_observations where delivered_at is not null and delivered_at < now() - interval '5 minutes';
  get diagnostics c = row_count; counts := counts || jsonb_build_object('tracker_observations', c);

  delete from audit_log where delivered_at is not null and delivered_at < now() - interval '5 minutes';
  get diagnostics c = row_count; counts := counts || jsonb_build_object('audit_log', c);

  delete from processing_log where delivered_at is not null and delivered_at < now() - interval '5 minutes';
  get diagnostics c = row_count; counts := counts || jsonb_build_object('processing_log', c);

  delete from delivery_buffer where delivered_at is not null and delivered_at < now() - interval '5 minutes';
  get diagnostics c = row_count; counts := counts || jsonb_build_object('delivery_buffer', c);

  delete from rights_request_events where delivered_at is not null and delivered_at < now() - interval '5 minutes';
  get diagnostics c = row_count; counts := counts || jsonb_build_object('rights_request_events', c);

  delete from deletion_receipts where delivered_at is not null and delivered_at < now() - interval '5 minutes';
  get diagnostics c = row_count; counts := counts || jsonb_build_object('deletion_receipts', c);

  delete from withdrawal_verifications where delivered_at is not null and delivered_at < now() - interval '5 minutes';
  get diagnostics c = row_count; counts := counts || jsonb_build_object('withdrawal_verifications', c);

  delete from security_scans where delivered_at is not null and delivered_at < now() - interval '5 minutes';
  get diagnostics c = row_count; counts := counts || jsonb_build_object('security_scans', c);

  delete from consent_probe_runs where delivered_at is not null and delivered_at < now() - interval '5 minutes';
  get diagnostics c = row_count; counts := counts || jsonb_build_object('consent_probe_runs', c);

  -- Clean expired consent artefact index entries
  delete from consent_artefact_index where expires_at < now();
  get diagnostics c = row_count; counts := counts || jsonb_build_object('expired_artefacts', c);

  return counts;
end;
$$;

-- ═══════════════════════════════════════════════════════════
-- FUNCTION: Stuck row detection — alert if anything is undelivered for > 1 hour
-- Returns a table of (table_name, stuck_count). Empty = healthy.
-- ═══════════════════════════════════════════════════════════
create or replace function detect_stuck_buffers()
returns table(buffer_table text, stuck_count bigint, oldest_created timestamptz) language plpgsql security definer as $$
begin
  return query
  select 'consent_events'::text, count(*), min(created_at)
  from consent_events where delivered_at is null and created_at < now() - interval '1 hour'
  union all
  select 'tracker_observations', count(*), min(created_at)
  from tracker_observations where delivered_at is null and created_at < now() - interval '1 hour'
  union all
  select 'audit_log', count(*), min(created_at)
  from audit_log where delivered_at is null and created_at < now() - interval '1 hour'
  union all
  select 'processing_log', count(*), min(created_at)
  from processing_log where delivered_at is null and created_at < now() - interval '1 hour'
  union all
  select 'delivery_buffer', count(*), min(created_at)
  from delivery_buffer where delivered_at is null and created_at < now() - interval '1 hour'
  union all
  select 'rights_request_events', count(*), min(created_at)
  from rights_request_events where delivered_at is null and created_at < now() - interval '1 hour'
  union all
  select 'deletion_receipts', count(*), min(created_at)
  from deletion_receipts where delivered_at is null and created_at < now() - interval '1 hour'
  union all
  select 'withdrawal_verifications', count(*), min(created_at)
  from withdrawal_verifications where delivered_at is null and created_at < now() - interval '1 hour'
  union all
  select 'security_scans', count(*), min(created_at)
  from security_scans where delivered_at is null and created_at < now() - interval '1 hour'
  union all
  select 'consent_probe_runs', count(*), min(created_at)
  from consent_probe_runs where delivered_at is null and created_at < now() - interval '1 hour';
end;
$$;
```

---

## 8. Scheduled Jobs (pg_cron)

**Key choice:** All Edge Function invocations from pg_cron use the `cs_orchestrator` key, not the service role key. The sweep function (`sweep_delivered_buffers`) runs as a `security definer` function within PostgreSQL and does not call Edge Functions — it operates directly on the database. The service role key is never used in running application code, including scheduled jobs.

```sql
-- ═══════════════════════════════════════════════════════════
-- SWEEP: every 15 minutes — clean up any rows that survived
-- immediate deletion. Should find 0 rows in normal operation.
-- ═══════════════════════════════════════════════════════════
select cron.schedule(
  'buffer-sweep-15min',
  '*/15 * * * *',
  $$ select sweep_delivered_buffers(); $$
);

-- ═══════════════════════════════════════════════════════════
-- STUCK DETECTION: every hour — alert if delivery pipeline is broken
-- ═══════════════════════════════════════════════════════════
select cron.schedule(
  'stuck-buffer-detection-hourly',
  '0 * * * *',
  $$
  -- Call Edge Function to check and alert
  select net.http_post(
    url := 'https://<project>.supabase.co/functions/v1/check-stuck-buffers',
    headers := '{"Authorization": "Bearer <cs_orchestrator_key>"}'::jsonb
  );
  $$
);

-- ═══════════════════════════════════════════════════════════
-- SLA REMINDERS: daily at 08:00 IST
-- ═══════════════════════════════════════════════════════════
select cron.schedule(
  'sla-reminders-daily',
  '30 2 * * *',  -- 02:30 UTC = 08:00 IST
  $$
  select net.http_post(
    url := 'https://<project>.supabase.co/functions/v1/send-sla-reminders',
    headers := '{"Authorization": "Bearer <cs_orchestrator_key>"}'::jsonb
  );
  $$
);

-- ═══════════════════════════════════════════════════════════
-- SECURITY SCAN: daily at 02:00 IST
-- ═══════════════════════════════════════════════════════════
select cron.schedule(
  'security-scan-nightly',
  '30 20 * * *',  -- 20:30 UTC = 02:00 IST
  $$
  select net.http_post(
    url := 'https://<project>.supabase.co/functions/v1/run-security-scans',
    headers := '{"Authorization": "Bearer <cs_orchestrator_key>"}'::jsonb
  );
  $$
);

-- ═══════════════════════════════════════════════════════════
-- RETENTION CHECK: daily at 03:00 IST
-- ═══════════════════════════════════════════════════════════
select cron.schedule(
  'retention-check-daily',
  '30 21 * * *',  -- 21:30 UTC = 03:00 IST
  $$
  select net.http_post(
    url := 'https://<project>.supabase.co/functions/v1/check-retention-rules',
    headers := '{"Authorization": "Bearer <cs_orchestrator_key>"}'::jsonb
  );
  $$
);
```

---

## 9. Post-Setup Verification Queries

Run these after initial setup to confirm all guards are active. Every query must return the expected result. If any fails, do not proceed with development.

```sql
-- ═══════════════════════════════════════════════════════════
-- VERIFY 1: RLS is enabled on every table
-- Expected: every table in the list. If any is missing, RLS is not active.
-- ═══════════════════════════════════════════════════════════
select tablename, rowsecurity
from pg_tables
where schemaname = 'public'
  and tablename in (
    'organisations', 'organisation_members', 'web_properties', 'consent_banners',
    'consent_events', 'data_inventory', 'rights_requests', 'rights_request_events',
    'processing_log', 'breach_notifications', 'audit_log', 'delivery_buffer',
    'export_configurations', 'consent_artefact_index', 'tracker_observations',
    'tracker_overrides', 'integration_connectors', 'retention_rules',
    'notification_channels', 'deletion_receipts', 'withdrawal_verifications',
    'security_scans', 'consent_probes', 'consent_probe_runs', 'api_keys',
    'gdpr_configurations', 'dpo_partners', 'dpo_engagements',
    'cross_border_transfers', 'white_label_configs', 'tracker_signatures',
    'sector_templates'
  )
order by tablename;
-- EXPECTED: rowsecurity = true for EVERY row

-- ═══════════════════════════════════════════════════════════
-- VERIFY 2: Buffer tables have no UPDATE/DELETE grants for authenticated role
-- ═══════════════════════════════════════════════════════════
select grantee, table_name, privilege_type
from information_schema.table_privileges
where table_schema = 'public'
  and grantee = 'authenticated'
  and table_name in (
    'consent_events', 'tracker_observations', 'audit_log', 'processing_log',
    'rights_request_events', 'delivery_buffer', 'deletion_receipts',
    'withdrawal_verifications', 'security_scans', 'consent_probe_runs'
  )
  and privilege_type in ('UPDATE', 'DELETE');
-- EXPECTED: 0 rows. No UPDATE or DELETE privilege for authenticated on any buffer table.

-- ═══════════════════════════════════════════════════════════
-- VERIFY 3: Buffer tables have no INSERT grants for authenticated role
-- ═══════════════════════════════════════════════════════════
select grantee, table_name, privilege_type
from information_schema.table_privileges
where table_schema = 'public'
  and grantee = 'authenticated'
  and table_name in ('consent_events', 'tracker_observations', 'audit_log', 'processing_log', 'delivery_buffer')
  and privilege_type = 'INSERT';
-- EXPECTED: 0 rows.

-- ═══════════════════════════════════════════════════════════
-- VERIFY 4: SLA deadline trigger is active
-- ═══════════════════════════════════════════════════════════
select trigger_name, event_manipulation, action_timing
from information_schema.triggers
where event_object_table = 'rights_requests' and trigger_name = 'trg_sla_deadline';
-- EXPECTED: 1 row, INSERT, BEFORE

-- ═══════════════════════════════════════════════════════════
-- VERIFY 5: Breach deadline trigger is active
-- ═══════════════════════════════════════════════════════════
select trigger_name, event_manipulation, action_timing
from information_schema.triggers
where event_object_table = 'breach_notifications' and trigger_name = 'trg_breach_deadline';
-- EXPECTED: 1 row, INSERT, BEFORE

-- ═══════════════════════════════════════════════════════════
-- VERIFY 6: pg_cron jobs are scheduled
-- ═══════════════════════════════════════════════════════════
select jobname, schedule, active from cron.job;
-- EXPECTED: buffer-sweep-15min, stuck-buffer-detection-hourly,
-- sla-reminders-daily, security-scan-nightly, retention-check-daily
-- All active = true

-- ═══════════════════════════════════════════════════════════
-- VERIFY 7: No buffer tables contain stale data (should be 0 on fresh setup)
-- ═══════════════════════════════════════════════════════════
select * from detect_stuck_buffers() where stuck_count > 0;
-- EXPECTED: 0 rows

-- ═══════════════════════════════════════════════════════════
-- VERIFY 8: Scoped roles exist and have correct privileges
-- ═══════════════════════════════════════════════════════════
-- 8a: cs_worker role exists
select rolname from pg_roles where rolname = 'cs_worker';
-- EXPECTED: 1 row

-- 8b: cs_worker CANNOT select from organisations
-- (run as cs_worker)
-- SET ROLE cs_worker;
-- SELECT count(*) FROM organisations;
-- EXPECTED: permission denied

-- 8c: cs_worker CAN insert into consent_events
-- SET ROLE cs_worker;
-- INSERT INTO consent_events (org_id, property_id, banner_id, banner_version, session_fingerprint, event_type)
--   VALUES (gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), 1, 'test', 'consent_given');
-- EXPECTED: success (row will fail FK check but permission is granted)

-- 8d: cs_delivery CANNOT select from organisations
-- SET ROLE cs_delivery;
-- SELECT count(*) FROM organisations;
-- EXPECTED: permission denied

-- 8e: cs_delivery CAN delete from consent_events
-- SET ROLE cs_delivery;
-- DELETE FROM consent_events WHERE id = '<test_id>' AND delivered_at IS NOT NULL;
-- EXPECTED: success (0 rows affected on fresh DB, but permission is granted)

-- 8f: cs_orchestrator CANNOT select from consent_events
-- SET ROLE cs_orchestrator;
-- SELECT count(*) FROM consent_events;
-- EXPECTED: permission denied

-- 8g: cs_orchestrator CAN insert into audit_log
-- SET ROLE cs_orchestrator;
-- INSERT INTO audit_log (org_id, event_type) VALUES (gen_random_uuid(), 'test');
-- EXPECTED: success

-- RESET ROLE; after all scoped role tests

-- ═══════════════════════════════════════════════════════════
-- VERIFY 9: Event signing secrets exist on all web properties
-- ═══════════════════════════════════════════════════════════
select count(*) from web_properties where event_signing_secret is null or length(event_signing_secret) < 32;
-- EXPECTED: 0 rows (all properties have a signing secret)

-- ═══════════════════════════════════════════════════════════
-- VERIFY 10: All organisations have encryption salts
-- ═══════════════════════════════════════════════════════════
select count(*) from organisations where encryption_salt is null or length(encryption_salt) < 16;
-- EXPECTED: 0 rows

-- ═══════════════════════════════════════════════════════════
-- VERIFY 11: Cross-tenant isolation test
-- Run as authenticated user with org_id = 'org_A':
-- ═══════════════════════════════════════════════════════════
-- select count(*) from consent_events where org_id = 'org_B_id';
-- EXPECTED: 0
-- insert into consent_events (org_id, ...) values ('org_B_id', ...);
-- EXPECTED: new row violates row-level security policy (or permission denied)
```

---

## 10. Guard Summary

| Guard | What it protects | How it's enforced | Failure mode |
|---|---|---|---|
| RLS on every table | Cross-tenant data access | PostgreSQL RLS policies | Query returns 0 rows for wrong org |
| Revoked UPDATE/DELETE on buffer tables | Compliance record immutability | PostgreSQL role-level REVOKE | Permission denied error |
| Revoked INSERT on critical buffers | Preventing app-level writes to audit tables | PostgreSQL role-level REVOKE | Permission denied error |
| Append-only (no UPDATE/DELETE policy) | Consent event integrity | No RLS policy exists for UPDATE/DELETE | No policy = denied by default |
| SLA deadline trigger | Legal deadline accuracy | PostgreSQL trigger on INSERT | Deadline auto-set, cannot be forgotten |
| Breach deadline trigger | 72-hour DPB notification | PostgreSQL trigger on INSERT | Deadline auto-set, cannot be forgotten |
| Immediate deletion after delivery | Buffer tables don't accumulate personal data | mark_delivered_and_delete() function | Row deleted in same transaction as delivery confirmation |
| 15-minute sweep | Safety net for orphaned delivered rows | pg_cron job | Catches edge cases (crash between mark and delete) |
| 1-hour stuck detection | Delivery pipeline health | pg_cron → Edge Function → alert | Fires notification if pipeline is broken |
| Scoped role: cs_worker | Worker credential leak → vandalism not theft | PostgreSQL role with INSERT on 2 tables only | Attacker can insert garbage, cannot read data |
| Scoped role: cs_delivery | Delivery credential leak → read in-flight data only | PostgreSQL role with SELECT/DELETE on buffers only | Attacker sees minutes of hashed/truncated data |
| Scoped role: cs_orchestrator | Orchestration credential leak → limited operational access | PostgreSQL role without consent_events access | Attacker cannot read consent data |
| HMAC-signed consent events | Fake event injection from curl/bots | Banner script computes HMAC, Worker verifies | Invalid signature → 403 |
| Origin validation on Worker | Cross-origin event injection | Worker checks Origin/Referer vs registered URL | Mismatch → 403 |
| Worker rate limiting | Brute-force abuse of public endpoints | Cloudflare rate limiting rules | Excess requests → 429 |
| Signed deletion callbacks | Forged deletion confirmations | HMAC signature in callback URL | Invalid signature → rejected |
| Cloudflare Turnstile on rights requests | Bot spam flooding rights requests | Invisible CAPTCHA on submission form | Failed challenge → rejected |
| Email OTP on rights requests | Spam via fake email addresses | OTP verification before notification fires | Unverified → no compliance contact notification |
| Per-org encryption key derivation | Single master key leak exposing all credentials | HMAC-SHA256(master_key, org_id + salt) | Master key leak → still need per-org derivation |
| Event signing secret per property | Replay attacks on consent events | Timestamp ±5 min window + HMAC | Expired timestamp or wrong secret → 403 |
| Write-only export credentials | Customer data cannot be read back | IAM scoped to PutObject only | Compromise = write to encrypted bucket you can't decrypt |
| Encrypted connector credentials | OAuth tokens for deletion APIs | pgcrypto encryption with per-org derived key | Stored as bytea, never in logs |
| Sentry scrubbing | Credential/PII leak via error tracking | beforeSend strips headers/body/cookies/params | Only stack traces reach Sentry |
| Hardware 2FA on infrastructure | Social engineering / credential stuffing | YubiKey required on all admin accounts | Cannot authenticate without physical key |
| Zero Worker dependencies | Supply chain attack via npm | Vanilla TypeScript policy | No third-party code in banner delivery path |
| Processing mode enforcement | Zero-Storage orgs never persist data | Checked at API gateway before any write | Wrong mode = data persisted that should be in-memory only |

---

*Document prepared April 2026. This is the complete schema design. Run top to bottom on a fresh Supabase Postgres instance. Every guard must be verified before any customer data enters the system. Security hardening changes integrated April 2026.*
