# ConsentShield — Admin Platform Schema Design

*(c) 2026 Sudhindra Anegondhi a.d.sudhindra@gmail.com*
*Source of truth for the `admin` Postgres schema · April 2026*
*Companion to: [`consentshield-admin-platform.md`](./consentshield-admin-platform.md)*

---

## 0. Reading order

This document defines every database object that supports the operator-facing admin platform. Read [`consentshield-admin-platform.md`](./consentshield-admin-platform.md) first for the architectural context (cs_admin role, audit-logging contract, impersonation lifecycle, Rules 21–25). This document is the implementation contract that ports those rules into SQL.

All objects live in a dedicated `admin` Postgres schema. Customer-facing tables in `public` are unchanged. Where admin RPCs operate on `public` tables, the table name is qualified explicitly.

---

## 1. Schema bootstrap

```sql
-- Migration: <YYYYMMDDNNNNNN>_admin_schema.sql

create schema if not exists admin;

-- Only the cs_admin role can use the admin schema. Migration role retains
-- ownership for future ALTERs.
revoke all on schema admin from public;
grant usage on schema admin to cs_admin;
grant create on schema admin to postgres;

comment on schema admin is
  'Operator-facing admin platform. cs_admin role only. Every write to '
  'tables here goes through admin.* security-definer RPCs that audit-log '
  'in the same transaction (Rule 22 — see consentshield-admin-platform.md).';
```

---

## 2. The new scoped role: `cs_admin`

```sql
-- Migration: <YYYYMMDDNNNNNN>_cs_admin_role.sql

-- Create the role with BYPASSRLS for SELECT on public.* (admin reads all orgs)
-- but no inherent write privilege; writes go through security-definer RPCs.
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'cs_admin') then
    create role cs_admin nologin noinherit bypassrls;
  end if;
end $$;

-- Postgres 16 GRANT ROLE separation — admin pooler connection assumes the
-- role per session.
grant cs_admin to authenticator with set true;

-- Allow cs_admin to use the same helpers cs_orchestrator uses (current_uid,
-- current_org_id), but not to write directly to customer tables.
grant select on all tables in schema public to cs_admin;
grant usage on schema public to cs_admin;

-- All admin tables and admin RPCs are owned by cs_admin (see migrations
-- below).
```

The role does NOT receive `INSERT/UPDATE/DELETE` on any `public.*` table. All admin writes to customer data go through security-definer RPCs in the `admin` schema (defined in §10).

---

## 3. Tables

### 3.1 `admin.admin_users`

Extends `auth.users` with admin-specific metadata. One row per admin operator.

```sql
create table admin.admin_users (
  id                          uuid        primary key references auth.users(id) on delete cascade,
  display_name                text        not null,
  admin_role                  text        not null check (admin_role in ('platform_operator','support','read_only')),
  status                      text        not null default 'active' check (status in ('active','disabled','suspended')),
  hardware_keys_registered    int         not null default 0,
  bootstrap_admin             boolean     not null default false,  -- the first admin
  created_at                  timestamptz not null default now(),
  created_by                  uuid        references admin.admin_users(id),
  disabled_at                 timestamptz,
  disabled_reason             text,
  last_admin_action_at        timestamptz,
  notes                       text
);

create unique index admin_users_one_bootstrap_idx
  on admin.admin_users (bootstrap_admin) where bootstrap_admin = true;

alter table admin.admin_users enable row level security;
create policy admin_users_admin_only on admin.admin_users
  for all to authenticated
  using ((auth.jwt() -> 'app_metadata' ->> 'is_admin')::boolean = true)
  with check ((auth.jwt() -> 'app_metadata' ->> 'is_admin')::boolean = true);
```

The `bootstrap_admin` flag marks the first operator (Sudhindra). Exactly one admin may carry the flag (enforced by partial unique index). Bootstrap admin cannot be disabled by another admin — only by themselves with platform_operator role still active.

### 3.2 `admin.admin_audit_log`

Permanent, append-only record of every admin action (Rule 22).

```sql
create table admin.admin_audit_log (
  id                       bigserial   primary key,
  occurred_at              timestamptz not null default now(),
  admin_user_id            uuid        not null references admin.admin_users(id),
  action                   text        not null,                    -- e.g., 'update_customer_setting', 'impersonate_start', 'publish_template'
  target_table             text,                                    -- 'public.organisations' / 'admin.sectoral_templates' / NULL
  target_id                uuid,                                    -- the row primary key affected
  target_pk                text,                                    -- additional key (e.g., setting key, version number)
  org_id                   uuid        references public.organisations(id),  -- if action affects a specific customer org
  impersonation_session_id uuid        references admin.impersonation_sessions(id),
  old_value                jsonb,
  new_value                jsonb,
  reason                   text        not null check (length(reason) >= 10),
  request_ip               inet,
  request_ua               text,
  api_route                text                                     -- e.g., 'POST /api/admin/orgs/[id]/suspend'
)
partition by range (occurred_at);

-- First partition for current month; subsequent partitions auto-created by
-- monthly cron (admin.create_next_audit_partition()).
create table admin.admin_audit_log_2026_04
  partition of admin.admin_audit_log
  for values from ('2026-04-01') to ('2026-05-01');

create index admin_audit_log_admin_idx on admin.admin_audit_log (admin_user_id, occurred_at desc);
create index admin_audit_log_org_idx   on admin.admin_audit_log (org_id, occurred_at desc) where org_id is not null;
create index admin_audit_log_action_idx on admin.admin_audit_log (action, occurred_at desc);
create index admin_audit_log_session_idx on admin.admin_audit_log (impersonation_session_id) where impersonation_session_id is not null;

alter table admin.admin_audit_log enable row level security;
-- Read for admins; no INSERT/UPDATE/DELETE policy at all (writes go through
-- security-definer RPCs that bypass RLS for the audit insert).
create policy admin_audit_log_read on admin.admin_audit_log
  for select to authenticated
  using ((auth.jwt() -> 'app_metadata' ->> 'is_admin')::boolean = true);

revoke insert, update, delete on admin.admin_audit_log from authenticated, cs_admin;
```

**Why no INSERT policy for cs_admin even though cs_admin owns admin tables?** Because the application code never INSERTs into the audit log directly. Inserts happen only inside security-definer RPCs that run as the function owner (postgres or a dedicated owner role). This means even a malicious admin RPC cannot bypass the audit log just by writing INSERTs from app code — the path is blocked at the RLS layer.

### 3.3 `admin.impersonation_sessions`

Every impersonation event (Rule 23).

```sql
create table admin.impersonation_sessions (
  id                       uuid        primary key default gen_random_uuid(),
  admin_user_id            uuid        not null references admin.admin_users(id),
  target_org_id            uuid        not null references public.organisations(id),
  reason                   text        not null check (reason in ('bug_investigation','data_correction','compliance_query','partner_demo','other')),
  reason_detail            text        not null check (length(reason_detail) >= 10),
  started_at               timestamptz not null default now(),
  expires_at               timestamptz not null,
  ended_at                 timestamptz,
  ended_reason             text check (ended_reason in ('manual','expired','force_ended','admin_logout')),
  customer_notified_at     timestamptz,
  status                   text        not null default 'active' check (status in ('active','completed','expired','force_ended')),
  actions_summary          jsonb,                                  -- populated on session end: { read_pages: int, writes: int, last_url: text }
  ended_by_admin_user_id   uuid        references admin.admin_users(id)
);

create index impersonation_sessions_admin_idx on admin.impersonation_sessions (admin_user_id, started_at desc);
create index impersonation_sessions_org_idx   on admin.impersonation_sessions (target_org_id, started_at desc);
create index impersonation_sessions_active_idx on admin.impersonation_sessions (status) where status = 'active';

alter table admin.impersonation_sessions enable row level security;
-- Admin reads anything. Customer-side read (for the customer's own org's
-- support sessions) is via a public.* view defined separately so customer
-- RLS can target it without touching admin.* directly.
create policy impersonation_sessions_admin_all on admin.impersonation_sessions
  for all to authenticated
  using ((auth.jwt() -> 'app_metadata' ->> 'is_admin')::boolean = true)
  with check ((auth.jwt() -> 'app_metadata' ->> 'is_admin')::boolean = true);
```

A read-through view in `public` for the customer-side "Support sessions" tab:

```sql
create view public.org_support_sessions
  with (security_invoker = true) as
  select
    id, admin_user_id, target_org_id as org_id, reason, reason_detail,
    started_at, ended_at, status, actions_summary
  from admin.impersonation_sessions;

-- RLS on the view defers to the underlying table; we re-add an org-scoped
-- policy via a wrapper:
create policy org_support_sessions_org_view on admin.impersonation_sessions
  for select to authenticated
  using (
    target_org_id = public.current_org_id()  -- customer can see sessions targeting their own org
  );
```

The two policies on `admin.impersonation_sessions` (`admin_all` and `org_view`) are OR'd — admin sees all, customer sees only their org's sessions.

### 3.4 `admin.sectoral_templates`

Sector-specific purpose-definition seed packs.

```sql
create table admin.sectoral_templates (
  id                   uuid        primary key default gen_random_uuid(),
  template_code        text        not null,                       -- 'dpdp_minimum', 'dpdp_extended', 'bfsi_starter', 'healthcare_starter'
  display_name         text        not null,
  description          text        not null,
  sector               text        not null,                       -- 'general', 'bfsi', 'healthcare', 'edtech'
  version              int         not null default 1,
  status               text        not null default 'draft' check (status in ('draft','published','deprecated')),
  purpose_definitions  jsonb       not null,                       -- array of { purpose_code, display_name, description, framework, data_scope[], default_expiry_days, auto_delete_on_expiry }
  notes                text,
  default_storage_mode text        check (default_storage_mode in ('standard','insulated','zero_storage')), -- ADR-1003 Sprint 4.1. Nullable. When set, public.apply_sectoral_template refuses to apply unless the org's storage_mode already matches (errcode P0004). NULL = mode-agnostic (BFSI Starter, DPDP Minimum).
  connector_defaults   jsonb,                                      -- ADR-1003 Sprint 4.1. Nullable. Vendor-category placeholders surfaced by the admin templates detail page — informational metadata of the shape { <slot>: { category, examples[], rationale } }. Not referenced by purpose_connector_mappings; actual deletion-connector wiring stays per-org.
  created_at           timestamptz not null default now(),
  created_by           uuid        not null references admin.admin_users(id),
  published_at         timestamptz,
  published_by         uuid        references admin.admin_users(id),
  deprecated_at        timestamptz,
  superseded_by_id     uuid        references admin.sectoral_templates(id),
  unique (template_code, version)
);

create index sectoral_templates_published_idx on admin.sectoral_templates (sector, status, version desc) where status = 'published';

alter table admin.sectoral_templates enable row level security;
create policy sectoral_templates_admin on admin.sectoral_templates
  for all to authenticated
  using ((auth.jwt() -> 'app_metadata' ->> 'is_admin')::boolean = true)
  with check ((auth.jwt() -> 'app_metadata' ->> 'is_admin')::boolean = true);

-- Customer onboarding (W9 in customer alignment) reads published templates
-- via a security-definer function, not directly:
create or replace function public.list_sectoral_templates_for_sector(p_sector text)
returns table (
  template_code text, display_name text, description text, version int,
  purpose_definitions jsonb
)
language sql security definer set search_path = admin, public
as $$
  select template_code, display_name, description, version, purpose_definitions
    from admin.sectoral_templates
   where status = 'published' and sector in (p_sector, 'general')
   order by sector desc, version desc;
$$;

grant execute on function public.list_sectoral_templates_for_sector(text) to authenticated;
```

### 3.5 `admin.connector_catalogue`

Global catalogue of pre-built deletion connectors. Maps to the existing customer-side ADR-0018 pre-built connectors (Mailchimp, HubSpot) and any future addition.

```sql
create table admin.connector_catalogue (
  id                          uuid        primary key default gen_random_uuid(),
  connector_code              text        not null,                  -- 'mailchimp_v1', 'hubspot_v1', 'mixpanel_v1'
  display_name                text        not null,                  -- 'Mailchimp'
  vendor                      text        not null,
  version                     text        not null,                  -- 'v1'
  status                      text        not null default 'active' check (status in ('active','deprecated','retired')),
  supported_purpose_codes     text[]      not null,                  -- ['marketing','analytics']
  required_credentials_schema jsonb       not null,                  -- JSON Schema describing required fields
  webhook_endpoint_template   text        not null,                  -- e.g., 'https://api.mailchimp.com/3.0/lists/{list_id}/members/{subscriber_hash}'
  documentation_url           text,
  retention_lock_supported    boolean     not null default false,    -- whether the connector reports retention locks
  created_at                  timestamptz not null default now(),
  created_by                  uuid        not null references admin.admin_users(id),
  deprecated_at               timestamptz,
  deprecated_replacement_id   uuid        references admin.connector_catalogue(id),
  cutover_deadline            timestamptz,
  unique (connector_code, version)
);

create index connector_catalogue_active_idx on admin.connector_catalogue (status, connector_code) where status = 'active';

alter table admin.connector_catalogue enable row level security;
create policy connector_catalogue_admin on admin.connector_catalogue
  for all to authenticated
  using ((auth.jwt() -> 'app_metadata' ->> 'is_admin')::boolean = true)
  with check ((auth.jwt() -> 'app_metadata' ->> 'is_admin')::boolean = true);

-- Customer integrations table (existing) gains a foreign key to this catalogue
-- in a separate migration coordinated with ADR-0018 follow-up:
--   alter table public.integrations add column connector_catalogue_id uuid
--     references admin.connector_catalogue(id);
```

### 3.6 `admin.tracker_signature_catalogue`

Promotes the seed file `supabase/seed/tracker_signatures.sql` to a managed table the operator can edit live.

```sql
create table admin.tracker_signature_catalogue (
  id                  uuid        primary key default gen_random_uuid(),
  signature_code      text        not null unique,                  -- 'google_analytics_4', 'meta_pixel'
  display_name        text        not null,
  vendor              text        not null,
  signature_type      text        not null check (signature_type in ('script_src','cookie_name','localstorage_key','dom_attribute')),
  pattern             text        not null,                         -- the regex / substring matcher
  category            text        not null check (category in ('analytics','marketing','functional','social','advertising','other')),
  severity            text        not null default 'info' check (severity in ('info','warn','critical')),
  status              text        not null default 'active' check (status in ('active','deprecated')),
  created_at          timestamptz not null default now(),
  created_by          uuid        not null references admin.admin_users(id),
  notes               text
);

create index tracker_signature_catalogue_active_idx on admin.tracker_signature_catalogue (status, category) where status = 'active';

alter table admin.tracker_signature_catalogue enable row level security;
create policy tracker_signatures_admin on admin.tracker_signature_catalogue
  for all to authenticated
  using ((auth.jwt() -> 'app_metadata' ->> 'is_admin')::boolean = true)
  with check ((auth.jwt() -> 'app_metadata' ->> 'is_admin')::boolean = true);

-- Worker reads via Cloudflare KV (synced by an Edge Function on every
-- catalogue write); existing tracker_observations table in public is
-- unchanged.
```

### 3.7 `admin.support_tickets` + `admin.support_ticket_messages`

```sql
create table admin.support_tickets (
  id                       uuid        primary key default gen_random_uuid(),
  org_id                   uuid        references public.organisations(id),
  subject                  text        not null,
  status                   text        not null default 'open' check (status in ('open','awaiting_customer','awaiting_operator','resolved','closed')),
  priority                 text        not null default 'normal' check (priority in ('low','normal','high','urgent')),
  category                 text,                                  -- 'billing','technical','compliance','other'
  assigned_admin_user_id   uuid        references admin.admin_users(id),
  reporter_email           text        not null,                  -- customer's email (does not need to be a customer auth user)
  reporter_name            text,
  created_at               timestamptz not null default now(),
  resolved_at              timestamptz,
  resolution_summary       text
);

create table admin.support_ticket_messages (
  id           uuid        primary key default gen_random_uuid(),
  ticket_id    uuid        not null references admin.support_tickets(id) on delete cascade,
  author_kind  text        not null check (author_kind in ('admin','customer','system')),
  author_id    uuid,                                  -- admin_user_id when author_kind='admin', auth.users.id when 'customer', NULL when 'system'
  body         text        not null,
  attachments  jsonb,                                 -- array of { filename, r2_key, size_bytes, content_type }
  created_at   timestamptz not null default now()
);

create index support_tickets_status_idx on admin.support_tickets (status, priority desc, created_at desc) where status not in ('resolved','closed');
create index support_tickets_org_idx    on admin.support_tickets (org_id, created_at desc) where org_id is not null;
create index support_ticket_messages_ticket_idx on admin.support_ticket_messages (ticket_id, created_at);

alter table admin.support_tickets enable row level security;
alter table admin.support_ticket_messages enable row level security;

create policy support_tickets_admin on admin.support_tickets
  for all to authenticated
  using ((auth.jwt() -> 'app_metadata' ->> 'is_admin')::boolean = true)
  with check ((auth.jwt() -> 'app_metadata' ->> 'is_admin')::boolean = true);

create policy support_ticket_messages_admin on admin.support_ticket_messages
  for all to authenticated
  using ((auth.jwt() -> 'app_metadata' ->> 'is_admin')::boolean = true)
  with check ((auth.jwt() -> 'app_metadata' ->> 'is_admin')::boolean = true);
```

Customer-side support ticket creation flows through a public endpoint (`/api/public/support-ticket` on the customer app) that calls a security-definer RPC `admin.create_support_ticket(...)` — defined in §10. The customer never queries `admin.support_tickets` directly.

### 3.8 `admin.org_notes`

```sql
create table admin.org_notes (
  id              uuid        primary key default gen_random_uuid(),
  org_id          uuid        not null references public.organisations(id) on delete cascade,
  admin_user_id   uuid        not null references admin.admin_users(id),
  body            text        not null,
  pinned          boolean     not null default false,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index org_notes_org_idx on admin.org_notes (org_id, pinned desc, created_at desc);

alter table admin.org_notes enable row level security;
create policy org_notes_admin on admin.org_notes
  for all to authenticated
  using ((auth.jwt() -> 'app_metadata' ->> 'is_admin')::boolean = true)
  with check ((auth.jwt() -> 'app_metadata' ->> 'is_admin')::boolean = true);
```

### 3.9 `admin.feature_flags`

Global + per-org feature flag store. Both apps read this; only admin writes.

```sql
create table admin.feature_flags (
  flag_key        text        not null,
  scope           text        not null check (scope in ('global','org')),
  org_id          uuid        references public.organisations(id),
  value           jsonb       not null,                            -- typically true/false but JSONB allows experiments
  description     text        not null,
  set_by          uuid        not null references admin.admin_users(id),
  set_at          timestamptz not null default now(),
  expires_at      timestamptz,
  primary key (flag_key, scope, coalesce(org_id, '00000000-0000-0000-0000-000000000000'::uuid))
);

create index feature_flags_org_idx on admin.feature_flags (org_id) where org_id is not null;

alter table admin.feature_flags enable row level security;
create policy feature_flags_admin_all on admin.feature_flags
  for all to authenticated
  using ((auth.jwt() -> 'app_metadata' ->> 'is_admin')::boolean = true)
  with check ((auth.jwt() -> 'app_metadata' ->> 'is_admin')::boolean = true);

-- Customer app reads its own org's overrides + global via SECURITY DEFINER:
create or replace function public.get_feature_flag(p_flag_key text)
returns jsonb
language sql security definer set search_path = admin, public
as $$
  select coalesce(
    (select value from admin.feature_flags
       where flag_key = p_flag_key and scope = 'org'
         and org_id = public.current_org_id()
         and (expires_at is null or expires_at > now())),
    (select value from admin.feature_flags
       where flag_key = p_flag_key and scope = 'global'
         and (expires_at is null or expires_at > now()))
  );
$$;

grant execute on function public.get_feature_flag(text) to authenticated;
```

### 3.10 `admin.kill_switches`

```sql
create table admin.kill_switches (
  switch_key    text        primary key,                         -- 'banner_delivery', 'depa_processing', 'deletion_dispatch', 'rights_request_intake'
  display_name  text        not null,
  description   text        not null,
  enabled       boolean     not null default false,              -- when true, the named subsystem is DISABLED (semantics: 'kill is engaged')
  reason        text,
  set_by        uuid        references admin.admin_users(id),
  set_at        timestamptz not null default now()
);

alter table admin.kill_switches enable row level security;
-- Read: all admins. Write: platform_operator only.
create policy kill_switches_read on admin.kill_switches
  for select to authenticated
  using ((auth.jwt() -> 'app_metadata' ->> 'is_admin')::boolean = true);

create policy kill_switches_write on admin.kill_switches
  for all to authenticated
  using (
    (auth.jwt() -> 'app_metadata' ->> 'is_admin')::boolean = true
    and (auth.jwt() -> 'app_metadata' ->> 'admin_role') = 'platform_operator'
  )
  with check (
    (auth.jwt() -> 'app_metadata' ->> 'is_admin')::boolean = true
    and (auth.jwt() -> 'app_metadata' ->> 'admin_role') = 'platform_operator'
  );

-- Worker + Edge Functions read kill_switches via KV (synced by an Edge
-- Function on every kill_switches write — see §11 cron + sync).
```

### 3.11 `admin.platform_metrics_daily`

Materialised system-wide stats for the operations dashboard. Refreshed nightly.

```sql
create table admin.platform_metrics_daily (
  metric_date                 date        primary key,
  total_orgs                  int         not null,
  active_orgs                 int         not null,             -- orgs with banner activity in last 7d
  total_consents              bigint      not null,             -- sum of consent_events (delivered)
  total_artefacts_active      bigint      not null,             -- sum of consent_artefacts WHERE status='active' (DEPA)
  total_artefacts_revoked     bigint      not null,             -- sum of artefact_revocations in last 24h (DEPA)
  total_rights_requests_open  int         not null,
  rights_requests_breached    int         not null,             -- past SLA
  worker_errors_24h           int         not null,
  delivery_buffer_max_age_min int         not null,             -- max age of any undelivered buffer row
  refreshed_at                timestamptz not null default now()
);

alter table admin.platform_metrics_daily enable row level security;
create policy platform_metrics_admin on admin.platform_metrics_daily
  for all to authenticated
  using ((auth.jwt() -> 'app_metadata' ->> 'is_admin')::boolean = true);
```

---

## 4. Helper functions in `admin`

### 4.1 `admin.is_admin()` — convenience predicate

```sql
create or replace function admin.is_admin()
returns boolean language sql stable as $$
  select coalesce((auth.jwt() -> 'app_metadata' ->> 'is_admin')::boolean, false);
$$;

grant execute on function admin.is_admin() to authenticated, cs_admin;
```

### 4.2 `admin.current_admin_role()` — role check

```sql
create or replace function admin.current_admin_role()
returns text language sql stable as $$
  select auth.jwt() -> 'app_metadata' ->> 'admin_role';
$$;

grant execute on function admin.current_admin_role() to authenticated, cs_admin;
```

### 4.3 `admin.require_admin(p_min_role text)` — assertion

```sql
create or replace function admin.require_admin(p_min_role text default 'support')
returns void language plpgsql as $$
begin
  if not admin.is_admin() then
    raise exception 'admin claim required' using errcode = '42501';
  end if;
  if p_min_role = 'platform_operator' and admin.current_admin_role() <> 'platform_operator' then
    raise exception 'platform_operator role required' using errcode = '42501';
  end if;
  if p_min_role = 'support' and admin.current_admin_role() not in ('support','platform_operator') then
    raise exception 'support or platform_operator role required' using errcode = '42501';
  end if;
end;
$$;

grant execute on function admin.require_admin(text) to authenticated, cs_admin;
```

### 4.4 `admin.create_next_audit_partition()` — monthly partitioning helper

```sql
create or replace function admin.create_next_audit_partition()
returns void language plpgsql security definer as $$
declare
  v_next_month_start date := (date_trunc('month', now()) + interval '1 month')::date;
  v_following_month  date := (v_next_month_start + interval '1 month')::date;
  v_partition_name   text := 'admin_audit_log_' || to_char(v_next_month_start, 'YYYY_MM');
begin
  execute format(
    'create table if not exists admin.%I partition of admin.admin_audit_log for values from (%L) to (%L)',
    v_partition_name, v_next_month_start, v_following_month
  );
end;
$$;

-- Scheduled by pg_cron 25th of every month:
-- select cron.schedule('admin-create-next-audit-partition', '0 6 25 * *',
--   $$ select admin.create_next_audit_partition(); $$);
```

---

## 5. The audit-logging RPC pattern

Every admin write to a customer table follows this template:

```sql
create or replace function admin.<verb>_<noun>(
  <typed args>,
  p_reason text
) returns <return type>
language plpgsql security definer
set search_path = admin, public
as $$
declare
  v_admin_id uuid := auth.uid();
  v_session_id uuid := nullif(current_setting('app.impersonation_session_id', true), '')::uuid;
  v_old_value jsonb;
  v_new_value jsonb;
begin
  perform admin.require_admin('<min_role>');
  if length(p_reason) < 10 then raise exception 'reason required (≥10 chars)'; end if;

  -- 1. Capture the current state.
  select to_jsonb(t.*) into v_old_value from <target table> t where <pk> = <pk arg>;

  -- 2. Insert the audit row.
  insert into admin.admin_audit_log
    (admin_user_id, action, target_table, target_id, target_pk, org_id,
     impersonation_session_id, old_value, new_value, reason, api_route, request_ip, request_ua)
  values
    (v_admin_id, '<action_code>', '<table fqdn>', <pk arg>, <secondary key>, <org id if applicable>,
     v_session_id, v_old_value, v_new_value, p_reason,
     current_setting('app.api_route', true),
     current_setting('app.request_ip', true)::inet,
     current_setting('app.request_ua', true));

  -- 3. Perform the write.
  update <target table> set ... where <pk> = <pk arg> returning to_jsonb(<target table>.*) into v_new_value;

  return <whatever>;
end;
$$;
```

The application sets `app.impersonation_session_id`, `app.api_route`, `app.request_ip`, `app.request_ua` via `select set_config(...)` at the start of every request handler. The audit RPC reads them. This avoids passing them as RPC args (cleaner signature) but keeps them in the audit row.

---

## 6. Concrete admin RPCs (selected — full set in implementation)

### 6.1 `admin.suspend_org(p_org_id, p_reason)`

```sql
create or replace function admin.suspend_org(p_org_id uuid, p_reason text)
returns void language plpgsql security definer set search_path = admin, public as $$
declare v_admin uuid := auth.uid(); v_old jsonb;
begin
  perform admin.require_admin('platform_operator');
  if length(p_reason) < 10 then raise exception 'reason required'; end if;
  select to_jsonb(o.*) into v_old from public.organisations o where id = p_org_id;
  if v_old is null then raise exception 'org not found'; end if;
  insert into admin.admin_audit_log
    (admin_user_id, action, target_table, target_id, org_id, old_value, new_value, reason)
  values
    (v_admin, 'suspend_org', 'public.organisations', p_org_id, p_org_id, v_old,
     v_old || jsonb_build_object('status', 'suspended'), p_reason);
  update public.organisations set status = 'suspended', updated_at = now() where id = p_org_id;
end;
$$;
```

### 6.2 `admin.start_impersonation(p_org_id, p_reason, p_reason_detail, p_duration_minutes)`

```sql
create or replace function admin.start_impersonation(
  p_org_id uuid, p_reason text, p_reason_detail text,
  p_duration_minutes int default 30
) returns uuid language plpgsql security definer set search_path = admin, public as $$
declare
  v_admin uuid := auth.uid();
  v_session_id uuid;
  v_max int := current_setting('app.impersonation_max_minutes', true)::int;
begin
  perform admin.require_admin('support');
  if length(p_reason_detail) < 10 then raise exception 'reason_detail required (≥10 chars)'; end if;
  if p_duration_minutes < 1 or p_duration_minutes > coalesce(v_max, 120) then
    raise exception 'duration must be between 1 and % minutes', coalesce(v_max, 120);
  end if;
  if not exists (select 1 from public.organisations where id = p_org_id) then
    raise exception 'org not found';
  end if;

  insert into admin.impersonation_sessions
    (admin_user_id, target_org_id, reason, reason_detail, expires_at)
  values
    (v_admin, p_org_id, p_reason, p_reason_detail, now() + make_interval(mins => p_duration_minutes))
  returning id into v_session_id;

  insert into admin.admin_audit_log
    (admin_user_id, action, target_table, target_id, org_id,
     impersonation_session_id, reason)
  values
    (v_admin, 'impersonate_start', 'admin.impersonation_sessions', v_session_id, p_org_id,
     v_session_id, p_reason || ': ' || p_reason_detail);

  -- Notify customer (deferred via pg_notify; an Edge Function handles the email).
  perform pg_notify('impersonation_started', jsonb_build_object('session_id', v_session_id, 'org_id', p_org_id)::text);

  return v_session_id;
end;
$$;
```

### 6.3 `admin.end_impersonation(p_session_id, p_actions_summary)`

```sql
create or replace function admin.end_impersonation(p_session_id uuid, p_actions_summary jsonb default '{}'::jsonb)
returns void language plpgsql security definer set search_path = admin, public as $$
declare v_admin uuid := auth.uid(); v_session admin.impersonation_sessions%rowtype;
begin
  perform admin.require_admin('support');
  select * into v_session from admin.impersonation_sessions where id = p_session_id;
  if v_session is null then raise exception 'session not found'; end if;
  if v_session.status <> 'active' then return; end if;

  update admin.impersonation_sessions
     set ended_at = now(), status = 'completed', ended_reason = 'manual',
         actions_summary = p_actions_summary,
         ended_by_admin_user_id = v_admin
   where id = p_session_id;

  insert into admin.admin_audit_log
    (admin_user_id, action, target_table, target_id, org_id,
     impersonation_session_id, reason)
  values
    (v_admin, 'impersonate_end', 'admin.impersonation_sessions', p_session_id, v_session.target_org_id,
     p_session_id, 'Session ended (manual)');

  perform pg_notify('impersonation_ended', jsonb_build_object('session_id', p_session_id, 'org_id', v_session.target_org_id)::text);
end;
$$;
```

### 6.4 `admin.publish_sectoral_template(p_template_id, p_version_notes)`

```sql
create or replace function admin.publish_sectoral_template(p_template_id uuid, p_version_notes text)
returns void language plpgsql security definer set search_path = admin, public as $$
declare v_admin uuid := auth.uid(); v_t admin.sectoral_templates%rowtype;
begin
  perform admin.require_admin('platform_operator');
  if length(p_version_notes) < 10 then raise exception 'version_notes required'; end if;
  select * into v_t from admin.sectoral_templates where id = p_template_id;
  if v_t is null then raise exception 'template not found'; end if;
  if v_t.status <> 'draft' then raise exception 'template not in draft status'; end if;

  -- Mark previous published version as superseded.
  update admin.sectoral_templates
     set status = 'deprecated', deprecated_at = now(), superseded_by_id = p_template_id
   where template_code = v_t.template_code and status = 'published' and id <> p_template_id;

  update admin.sectoral_templates
     set status = 'published', published_at = now(), published_by = v_admin, notes = p_version_notes
   where id = p_template_id;

  insert into admin.admin_audit_log
    (admin_user_id, action, target_table, target_id, target_pk, reason)
  values
    (v_admin, 'publish_sectoral_template', 'admin.sectoral_templates', p_template_id, v_t.template_code, p_version_notes);
end;
$$;
```

### 6.5 `admin.toggle_kill_switch(p_switch_key, p_enabled, p_reason)`

```sql
create or replace function admin.toggle_kill_switch(p_switch_key text, p_enabled boolean, p_reason text)
returns void language plpgsql security definer set search_path = admin, public as $$
declare v_admin uuid := auth.uid(); v_old jsonb;
begin
  perform admin.require_admin('platform_operator');
  if length(p_reason) < 10 then raise exception 'reason required'; end if;
  select to_jsonb(k.*) into v_old from admin.kill_switches k where switch_key = p_switch_key;
  if v_old is null then raise exception 'kill switch not found'; end if;

  insert into admin.admin_audit_log
    (admin_user_id, action, target_table, target_pk, old_value, new_value, reason)
  values
    (v_admin, 'toggle_kill_switch', 'admin.kill_switches', p_switch_key, v_old,
     v_old || jsonb_build_object('enabled', p_enabled), p_reason);

  update admin.kill_switches
     set enabled = p_enabled, reason = p_reason, set_by = v_admin, set_at = now()
   where switch_key = p_switch_key;

  perform pg_notify('kill_switch_changed', jsonb_build_object('switch_key', p_switch_key, 'enabled', p_enabled)::text);
end;
$$;
```

The full RPC set covers ~40 functions (one per admin action). The pattern is uniform; only the captured columns and target table differ.

---

## 7. Customer-side cross-references

Customer-side schema (`docs/architecture/consentshield-complete-schema-design.md`) needs three small additions to support admin integration:

1. **`public.organisations.status`** — already exists in §3 of the schema design. Admin's `suspend_org` writes here. Banner Worker reads `status` and serves a no-op banner if `status='suspended'`.
2. **`public.integrations.connector_catalogue_id`** — new nullable FK to `admin.connector_catalogue.id`. When the connector is deprecated, customers using it see the migration prompt.
3. **`public.org_support_sessions`** view — already defined in §3.3 above. Customer "Support sessions" tab in Settings reads from this.

These additions are scope for the admin schema migration ADR (proposed: ADR-0027 admin schema).

---

## 8. Verification queries

After every admin schema migration, run:

```sql
-- 8.1 Every admin table has RLS enabled.
select schemaname, tablename, rowsecurity
  from pg_tables
 where schemaname = 'admin' and not rowsecurity;
-- expect: zero rows

-- 8.2 Every admin table has at least one policy.
select t.schemaname, t.tablename
  from pg_tables t
  left join pg_policies p on p.schemaname = t.schemaname and p.tablename = t.tablename
 where t.schemaname = 'admin'
 group by t.schemaname, t.tablename
having count(p.policyname) = 0;
-- expect: zero rows

-- 8.3 cs_admin role exists and has BYPASSRLS.
select rolname, rolbypassrls from pg_roles where rolname = 'cs_admin';
-- expect: one row, rolbypassrls = true

-- 8.4 No INSERT/UPDATE/DELETE policy on admin.admin_audit_log for any role.
select * from pg_policies
 where schemaname = 'admin' and tablename = 'admin_audit_log'
   and cmd in ('INSERT','UPDATE','DELETE');
-- expect: zero rows

-- 8.5 Bootstrap admin uniqueness.
select count(*) from admin.admin_users where bootstrap_admin = true;
-- expect: 0 (pre-bootstrap) or 1 (post-bootstrap)

-- 8.6 No customer-facing role can read admin tables directly.
set role authenticated;
  select * from admin.admin_audit_log limit 1;  -- should fail with insufficient privilege
reset role;
```

---

## 9. Pg_cron jobs introduced by the admin platform

```sql
-- Monthly partition for admin_audit_log
select cron.schedule('admin-create-next-audit-partition', '0 6 25 * *',
  $$ select admin.create_next_audit_partition(); $$);

-- Auto-expire impersonation sessions
select cron.schedule('admin-expire-impersonation-sessions', '*/5 * * * *',
  $$
    update admin.impersonation_sessions
       set status = 'expired', ended_at = now(), ended_reason = 'expired'
     where status = 'active' and expires_at < now();
  $$);

-- Refresh platform_metrics_daily
select cron.schedule('admin-refresh-platform-metrics', '0 2 * * *',
  $$ select admin.refresh_platform_metrics(current_date - 1); $$);

-- Sync kill_switches + tracker_signature_catalogue + sectoral_templates to KV
select cron.schedule('admin-sync-config-to-kv', '*/2 * * * *',
  $$
    select net.http_post(
      url := (select decrypted_secret from vault.decrypted_secrets where name = 'supabase_url') || '/functions/v1/sync-admin-config-to-kv',
      headers := jsonb_build_object('Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret'))
    );
  $$);
```

---

## 10. Migration order

For the implementation ADRs, apply in this order:

1. `<ts>_admin_schema.sql` — schema bootstrap, cs_admin role, helpers (§§1, 2, 4)
2. `<ts>_admin_audit_log.sql` — `admin.admin_audit_log` table + first partition (§3.2)
3. `<ts>_admin_users.sql` — `admin.admin_users` (§3.1)
4. `<ts>_admin_impersonation.sql` — `admin.impersonation_sessions` + `public.org_support_sessions` view (§3.3)
5. `<ts>_admin_sectoral_templates.sql` — `admin.sectoral_templates` + `public.list_sectoral_templates_for_sector` (§3.4)
6. `<ts>_admin_connector_catalogue.sql` — `admin.connector_catalogue` + FK on `public.integrations` (§3.5)
7. `<ts>_admin_tracker_signatures.sql` — `admin.tracker_signature_catalogue` + seed migration from `seed/tracker_signatures.sql` (§3.6)
8. `<ts>_admin_support_tickets.sql` — `admin.support_tickets` + `admin.support_ticket_messages` (§3.7)
9. `<ts>_admin_org_notes.sql` — `admin.org_notes` (§3.8)
10. `<ts>_admin_feature_flags.sql` — `admin.feature_flags` + `public.get_feature_flag` (§3.9)
11. `<ts>_admin_kill_switches.sql` — `admin.kill_switches` (§3.10)
12. `<ts>_admin_platform_metrics.sql` — `admin.platform_metrics_daily` + `admin.refresh_platform_metrics(date)` (§3.11)
13. `<ts>_admin_rpcs.sql` — all admin RPCs (§§5, 6 — 40+ functions)
14. `<ts>_admin_pg_cron.sql` — schedule the 4 jobs (§9)

Each migration is independently verifiable via the queries in §8. The bootstrap admin user is inserted via a one-shot script run by the operator manually after migration 13 is applied, not as part of migrations.

---

*End of Admin Platform Schema Design.*
