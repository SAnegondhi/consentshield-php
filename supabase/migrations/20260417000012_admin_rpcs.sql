-- ADR-0027 Sprint 3.1 — admin RPCs (the audit-logging write surface).
--
-- Every admin write to a customer table or to an admin.* table flows
-- through a SECURITY DEFINER function in this migration. Each function
-- follows the Rule-22 template from consentshield-admin-schema.md §5:
--
--   1. perform admin.require_admin('<min_role>')        -- role gate
--   2. enforce reason ≥ 10 chars                        -- data quality
--   3. select to_jsonb(...) into v_old_value            -- capture pre-state
--   4. insert into admin.admin_audit_log                -- audit row
--   5. update/insert/delete target                      -- mutation
--                                                       -- (all in one txn)
--   6. pg_notify where relevant                         -- downstream signal
--
-- The audit row and the mutation land in the same transaction. Because
-- the audit_log append-only invariant REVOKES insert/update/delete from
-- `authenticated` and `cs_admin`, the audit row can only be written by
-- code running as the function owner (postgres). SECURITY DEFINER gives
-- us exactly that without any production code knowing the service role
-- key.
--
-- Functions are grouped by concern with comment banners below. Role
-- min levels come from the admin platform doc §9 (Rules 21–25) and the
-- ADR-0027 Sprint 3.1 deliverables.
--
-- Per docs/admin/architecture/consentshield-admin-schema.md §§5, 6.

-- ═══════════════════════════════════════════════════════════════════
-- § ORG MANAGEMENT
-- ═══════════════════════════════════════════════════════════════════

-- 1) admin.suspend_org — mark an org as suspended. Worker serves no-op
--    banner while status='suspended'. Reversible via restore_org.
create or replace function admin.suspend_org(p_org_id uuid, p_reason text)
returns void
language plpgsql security definer set search_path = admin, public
as $$
declare
  v_admin uuid := auth.uid();
  v_old   jsonb;
begin
  perform admin.require_admin('platform_operator');
  if length(p_reason) < 10 then raise exception 'reason required (≥10 chars)'; end if;
  select to_jsonb(o.*) into v_old from public.organisations o where id = p_org_id;
  if v_old is null then raise exception 'org not found'; end if;

  insert into admin.admin_audit_log
    (admin_user_id, action, target_table, target_id, org_id, old_value, new_value, reason)
  values
    (v_admin, 'suspend_org', 'public.organisations', p_org_id, p_org_id,
     v_old, v_old || jsonb_build_object('status', 'suspended'), p_reason);

  update public.organisations
     set status = 'suspended', updated_at = now()
   where id = p_org_id;
end;
$$;

-- 2) admin.restore_org — undo a suspension.
create or replace function admin.restore_org(p_org_id uuid, p_reason text)
returns void
language plpgsql security definer set search_path = admin, public
as $$
declare
  v_admin uuid := auth.uid();
  v_old   jsonb;
begin
  perform admin.require_admin('platform_operator');
  if length(p_reason) < 10 then raise exception 'reason required (≥10 chars)'; end if;
  select to_jsonb(o.*) into v_old from public.organisations o where id = p_org_id;
  if v_old is null then raise exception 'org not found'; end if;

  insert into admin.admin_audit_log
    (admin_user_id, action, target_table, target_id, org_id, old_value, new_value, reason)
  values
    (v_admin, 'restore_org', 'public.organisations', p_org_id, p_org_id,
     v_old, v_old || jsonb_build_object('status', 'active'), p_reason);

  update public.organisations
     set status = 'active', updated_at = now()
   where id = p_org_id;
end;
$$;

-- 3) admin.extend_trial — push out an org's trial_ends_at. Support role
--    can extend up to 30 days; platform_operator has no cap (the RPC
--    doesn't distinguish — p_new_trial_end is trusted).
create or replace function admin.extend_trial(
  p_org_id uuid, p_new_trial_end timestamptz, p_reason text
) returns void
language plpgsql security definer set search_path = admin, public
as $$
declare
  v_admin uuid := auth.uid();
  v_old   jsonb;
begin
  perform admin.require_admin('support');
  if length(p_reason) < 10 then raise exception 'reason required (≥10 chars)'; end if;
  if p_new_trial_end <= now() then raise exception 'trial_ends_at must be in the future'; end if;
  select to_jsonb(o.*) into v_old from public.organisations o where id = p_org_id;
  if v_old is null then raise exception 'org not found'; end if;

  insert into admin.admin_audit_log
    (admin_user_id, action, target_table, target_id, org_id, old_value, new_value, reason)
  values
    (v_admin, 'extend_trial', 'public.organisations', p_org_id, p_org_id,
     v_old, v_old || jsonb_build_object('trial_ends_at', p_new_trial_end), p_reason);

  update public.organisations
     set trial_ends_at = p_new_trial_end, updated_at = now()
   where id = p_org_id;
end;
$$;

-- 4) admin.update_customer_setting — arbitrary jsonb-valued setting on
--    public.organisations.settings (merged, not replaced). Useful for
--    toggling per-org flags that aren't important enough for a full
--    feature_flags entry.
create or replace function admin.update_customer_setting(
  p_org_id uuid, p_key text, p_value jsonb, p_reason text
) returns void
language plpgsql security definer set search_path = admin, public
as $$
declare
  v_admin uuid := auth.uid();
  v_old   jsonb;
  v_new_settings jsonb;
begin
  perform admin.require_admin('platform_operator');
  if length(p_reason) < 10 then raise exception 'reason required (≥10 chars)'; end if;
  if p_key is null or length(p_key) = 0 then raise exception 'key required'; end if;
  select to_jsonb(o.*) into v_old from public.organisations o where id = p_org_id;
  if v_old is null then raise exception 'org not found'; end if;

  v_new_settings := coalesce(v_old->'settings', '{}'::jsonb) || jsonb_build_object(p_key, p_value);

  insert into admin.admin_audit_log
    (admin_user_id, action, target_table, target_id, target_pk, org_id, old_value, new_value, reason)
  values
    (v_admin, 'update_customer_setting', 'public.organisations', p_org_id, p_key, p_org_id,
     v_old, v_old || jsonb_build_object('settings', v_new_settings), p_reason);

  update public.organisations
     set settings = v_new_settings, updated_at = now()
   where id = p_org_id;
end;
$$;

-- ═══════════════════════════════════════════════════════════════════
-- § IMPERSONATION (Rule 23: time-boxed, reason-required, customer-notified)
-- ═══════════════════════════════════════════════════════════════════

-- 5) admin.start_impersonation — begin a support session targeting one org.
create or replace function admin.start_impersonation(
  p_org_id uuid,
  p_reason text,
  p_reason_detail text,
  p_duration_minutes int default 30
) returns uuid
language plpgsql security definer set search_path = admin, public
as $$
declare
  v_admin uuid := auth.uid();
  v_session_id uuid;
  v_max int := coalesce(nullif(current_setting('app.impersonation_max_minutes', true), '')::int, 120);
begin
  perform admin.require_admin('support');
  if length(p_reason_detail) < 10 then raise exception 'reason_detail required (≥10 chars)'; end if;
  if p_reason not in ('bug_investigation','data_correction','compliance_query','partner_demo','other') then
    raise exception 'invalid reason code: %', p_reason;
  end if;
  if p_duration_minutes < 1 or p_duration_minutes > v_max then
    raise exception 'duration must be between 1 and % minutes', v_max;
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

  perform pg_notify('impersonation_started',
    jsonb_build_object('session_id', v_session_id, 'org_id', p_org_id, 'admin_user_id', v_admin)::text);

  return v_session_id;
end;
$$;

-- 6) admin.end_impersonation — end a session the caller owns (or that the
--    caller has the right to end).
create or replace function admin.end_impersonation(
  p_session_id uuid,
  p_actions_summary jsonb default '{}'::jsonb
) returns void
language plpgsql security definer set search_path = admin, public
as $$
declare
  v_admin uuid := auth.uid();
  v_session admin.impersonation_sessions%rowtype;
begin
  perform admin.require_admin('support');
  select * into v_session from admin.impersonation_sessions where id = p_session_id;
  if v_session.id is null then raise exception 'session not found'; end if;
  if v_session.status <> 'active' then return; end if;
  -- Non-owner admins must use force_end_impersonation (platform_operator only).
  if v_session.admin_user_id <> v_admin then
    raise exception 'only the originating admin may end this session; use admin.force_end_impersonation for override';
  end if;

  update admin.impersonation_sessions
     set ended_at = now(),
         status = 'completed',
         ended_reason = 'manual',
         actions_summary = p_actions_summary,
         ended_by_admin_user_id = v_admin
   where id = p_session_id;

  insert into admin.admin_audit_log
    (admin_user_id, action, target_table, target_id, org_id,
     impersonation_session_id, reason)
  values
    (v_admin, 'impersonate_end', 'admin.impersonation_sessions', p_session_id, v_session.target_org_id,
     p_session_id, 'Session ended (manual)');

  perform pg_notify('impersonation_ended',
    jsonb_build_object('session_id', p_session_id, 'org_id', v_session.target_org_id)::text);
end;
$$;

-- 7) admin.force_end_impersonation — platform_operator override, e.g. if
--    an operator walked away without ending their session.
create or replace function admin.force_end_impersonation(
  p_session_id uuid, p_reason text
) returns void
language plpgsql security definer set search_path = admin, public
as $$
declare
  v_admin uuid := auth.uid();
  v_session admin.impersonation_sessions%rowtype;
begin
  perform admin.require_admin('platform_operator');
  if length(p_reason) < 10 then raise exception 'reason required (≥10 chars)'; end if;
  select * into v_session from admin.impersonation_sessions where id = p_session_id;
  if v_session.id is null then raise exception 'session not found'; end if;
  if v_session.status <> 'active' then return; end if;

  update admin.impersonation_sessions
     set ended_at = now(),
         status = 'force_ended',
         ended_reason = 'force_ended',
         ended_by_admin_user_id = v_admin
   where id = p_session_id;

  insert into admin.admin_audit_log
    (admin_user_id, action, target_table, target_id, org_id,
     impersonation_session_id, reason)
  values
    (v_admin, 'impersonate_force_end', 'admin.impersonation_sessions', p_session_id, v_session.target_org_id,
     p_session_id, p_reason);

  perform pg_notify('impersonation_ended',
    jsonb_build_object('session_id', p_session_id, 'org_id', v_session.target_org_id, 'forced', true)::text);
end;
$$;

-- ═══════════════════════════════════════════════════════════════════
-- § SECTORAL TEMPLATES
-- ═══════════════════════════════════════════════════════════════════

-- 8) admin.create_sectoral_template_draft
create or replace function admin.create_sectoral_template_draft(
  p_template_code text,
  p_display_name text,
  p_description text,
  p_sector text,
  p_purpose_definitions jsonb,
  p_reason text
) returns uuid
language plpgsql security definer set search_path = admin, public
as $$
declare
  v_admin uuid := auth.uid();
  v_id    uuid;
  v_next_version int;
begin
  perform admin.require_admin('support');
  if length(p_reason) < 10 then raise exception 'reason required (≥10 chars)'; end if;
  if jsonb_typeof(p_purpose_definitions) <> 'array' then
    raise exception 'purpose_definitions must be a JSON array';
  end if;

  select coalesce(max(version), 0) + 1 into v_next_version
    from admin.sectoral_templates
   where template_code = p_template_code;

  insert into admin.sectoral_templates
    (template_code, display_name, description, sector, version, status, purpose_definitions, created_by)
  values
    (p_template_code, p_display_name, p_description, p_sector, v_next_version, 'draft', p_purpose_definitions, v_admin)
  returning id into v_id;

  insert into admin.admin_audit_log
    (admin_user_id, action, target_table, target_id, target_pk, new_value, reason)
  values
    (v_admin, 'create_sectoral_template_draft', 'admin.sectoral_templates', v_id, p_template_code,
     jsonb_build_object('version', v_next_version, 'status', 'draft', 'sector', p_sector), p_reason);

  return v_id;
end;
$$;

-- 9) admin.update_sectoral_template_draft — edit a draft (cannot edit
--    published versions; must create a new draft instead).
create or replace function admin.update_sectoral_template_draft(
  p_template_id uuid,
  p_display_name text,
  p_description text,
  p_purpose_definitions jsonb,
  p_reason text
) returns void
language plpgsql security definer set search_path = admin, public
as $$
declare
  v_admin uuid := auth.uid();
  v_t admin.sectoral_templates%rowtype;
  v_old jsonb;
begin
  perform admin.require_admin('support');
  if length(p_reason) < 10 then raise exception 'reason required (≥10 chars)'; end if;
  select * into v_t from admin.sectoral_templates where id = p_template_id;
  if v_t.id is null then raise exception 'template not found'; end if;
  if v_t.status <> 'draft' then raise exception 'template not in draft status'; end if;

  v_old := to_jsonb(v_t);

  insert into admin.admin_audit_log
    (admin_user_id, action, target_table, target_id, target_pk, old_value, new_value, reason)
  values
    (v_admin, 'update_sectoral_template_draft', 'admin.sectoral_templates', p_template_id, v_t.template_code,
     v_old, v_old || jsonb_build_object(
       'display_name', p_display_name,
       'description', p_description,
       'purpose_definitions', p_purpose_definitions
     ), p_reason);

  update admin.sectoral_templates
     set display_name = p_display_name,
         description = p_description,
         purpose_definitions = p_purpose_definitions
   where id = p_template_id;
end;
$$;

-- 10) admin.publish_sectoral_template — transition draft→published and
--     cascade the previous published version of the same template_code
--     to deprecated with superseded_by_id pointing at the new one.
create or replace function admin.publish_sectoral_template(
  p_template_id uuid, p_version_notes text
) returns void
language plpgsql security definer set search_path = admin, public
as $$
declare
  v_admin uuid := auth.uid();
  v_t admin.sectoral_templates%rowtype;
begin
  perform admin.require_admin('platform_operator');
  if length(p_version_notes) < 10 then raise exception 'version_notes required (≥10 chars)'; end if;
  select * into v_t from admin.sectoral_templates where id = p_template_id;
  if v_t.id is null then raise exception 'template not found'; end if;
  if v_t.status <> 'draft' then raise exception 'template not in draft status'; end if;

  -- Supersede any previously published version of this template_code.
  update admin.sectoral_templates
     set status = 'deprecated',
         deprecated_at = now(),
         superseded_by_id = p_template_id
   where template_code = v_t.template_code
     and status = 'published'
     and id <> p_template_id;

  update admin.sectoral_templates
     set status = 'published',
         published_at = now(),
         published_by = v_admin,
         notes = p_version_notes
   where id = p_template_id;

  insert into admin.admin_audit_log
    (admin_user_id, action, target_table, target_id, target_pk, reason)
  values
    (v_admin, 'publish_sectoral_template', 'admin.sectoral_templates', p_template_id, v_t.template_code, p_version_notes);
end;
$$;

-- 11) admin.deprecate_sectoral_template — end-of-life an already-published
--     template without a successor.
create or replace function admin.deprecate_sectoral_template(
  p_template_id uuid, p_reason text
) returns void
language plpgsql security definer set search_path = admin, public
as $$
declare
  v_admin uuid := auth.uid();
  v_t admin.sectoral_templates%rowtype;
begin
  perform admin.require_admin('platform_operator');
  if length(p_reason) < 10 then raise exception 'reason required (≥10 chars)'; end if;
  select * into v_t from admin.sectoral_templates where id = p_template_id;
  if v_t.id is null then raise exception 'template not found'; end if;
  if v_t.status <> 'published' then raise exception 'template not in published status'; end if;

  update admin.sectoral_templates
     set status = 'deprecated', deprecated_at = now()
   where id = p_template_id;

  insert into admin.admin_audit_log
    (admin_user_id, action, target_table, target_id, target_pk, reason)
  values
    (v_admin, 'deprecate_sectoral_template', 'admin.sectoral_templates', p_template_id, v_t.template_code, p_reason);
end;
$$;

-- ═══════════════════════════════════════════════════════════════════
-- § CONNECTOR CATALOGUE
-- ═══════════════════════════════════════════════════════════════════

-- 12) admin.add_connector
create or replace function admin.add_connector(
  p_connector_code text,
  p_display_name text,
  p_vendor text,
  p_version text,
  p_supported_purpose_codes text[],
  p_required_credentials_schema jsonb,
  p_webhook_endpoint_template text,
  p_documentation_url text,
  p_retention_lock_supported boolean,
  p_reason text
) returns uuid
language plpgsql security definer set search_path = admin, public
as $$
declare
  v_admin uuid := auth.uid();
  v_id    uuid;
begin
  perform admin.require_admin('platform_operator');
  if length(p_reason) < 10 then raise exception 'reason required (≥10 chars)'; end if;

  insert into admin.connector_catalogue
    (connector_code, display_name, vendor, version, status, supported_purpose_codes,
     required_credentials_schema, webhook_endpoint_template, documentation_url,
     retention_lock_supported, created_by)
  values
    (p_connector_code, p_display_name, p_vendor, p_version, 'active', p_supported_purpose_codes,
     p_required_credentials_schema, p_webhook_endpoint_template, p_documentation_url,
     p_retention_lock_supported, v_admin)
  returning id into v_id;

  insert into admin.admin_audit_log
    (admin_user_id, action, target_table, target_id, target_pk, new_value, reason)
  values
    (v_admin, 'add_connector', 'admin.connector_catalogue', v_id, p_connector_code,
     jsonb_build_object('version', p_version, 'vendor', p_vendor), p_reason);

  return v_id;
end;
$$;

-- 13) admin.update_connector — generic updater (nulls are no-ops).
create or replace function admin.update_connector(
  p_connector_id uuid,
  p_display_name text default null,
  p_supported_purpose_codes text[] default null,
  p_required_credentials_schema jsonb default null,
  p_webhook_endpoint_template text default null,
  p_documentation_url text default null,
  p_retention_lock_supported boolean default null,
  p_reason text default null
) returns void
language plpgsql security definer set search_path = admin, public
as $$
declare
  v_admin uuid := auth.uid();
  v_old   jsonb;
begin
  perform admin.require_admin('platform_operator');
  if p_reason is null or length(p_reason) < 10 then raise exception 'reason required (≥10 chars)'; end if;
  select to_jsonb(c.*) into v_old from admin.connector_catalogue c where id = p_connector_id;
  if v_old is null then raise exception 'connector not found'; end if;

  insert into admin.admin_audit_log
    (admin_user_id, action, target_table, target_id, target_pk, old_value, reason)
  values
    (v_admin, 'update_connector', 'admin.connector_catalogue', p_connector_id,
     v_old->>'connector_code', v_old, p_reason);

  update admin.connector_catalogue
     set display_name = coalesce(p_display_name, display_name),
         supported_purpose_codes = coalesce(p_supported_purpose_codes, supported_purpose_codes),
         required_credentials_schema = coalesce(p_required_credentials_schema, required_credentials_schema),
         webhook_endpoint_template = coalesce(p_webhook_endpoint_template, webhook_endpoint_template),
         documentation_url = coalesce(p_documentation_url, documentation_url),
         retention_lock_supported = coalesce(p_retention_lock_supported, retention_lock_supported)
   where id = p_connector_id;
end;
$$;

-- 14) admin.deprecate_connector
create or replace function admin.deprecate_connector(
  p_connector_id uuid,
  p_replacement_id uuid default null,
  p_cutover_deadline timestamptz default null,
  p_reason text default null
) returns void
language plpgsql security definer set search_path = admin, public
as $$
declare
  v_admin uuid := auth.uid();
  v_old   jsonb;
begin
  perform admin.require_admin('platform_operator');
  if p_reason is null or length(p_reason) < 10 then raise exception 'reason required (≥10 chars)'; end if;
  select to_jsonb(c.*) into v_old from admin.connector_catalogue c where id = p_connector_id;
  if v_old is null then raise exception 'connector not found'; end if;

  update admin.connector_catalogue
     set status = 'deprecated',
         deprecated_at = now(),
         deprecated_replacement_id = p_replacement_id,
         cutover_deadline = p_cutover_deadline
   where id = p_connector_id;

  insert into admin.admin_audit_log
    (admin_user_id, action, target_table, target_id, target_pk, old_value, new_value, reason)
  values
    (v_admin, 'deprecate_connector', 'admin.connector_catalogue', p_connector_id,
     v_old->>'connector_code', v_old,
     v_old || jsonb_build_object('status','deprecated','replacement_id', p_replacement_id), p_reason);
end;
$$;

-- ═══════════════════════════════════════════════════════════════════
-- § TRACKER SIGNATURES
-- ═══════════════════════════════════════════════════════════════════

-- 15) admin.add_tracker_signature
create or replace function admin.add_tracker_signature(
  p_signature_code text,
  p_display_name text,
  p_vendor text,
  p_signature_type text,
  p_pattern text,
  p_category text,
  p_severity text,
  p_notes text,
  p_reason text
) returns uuid
language plpgsql security definer set search_path = admin, public
as $$
declare
  v_admin uuid := auth.uid();
  v_id uuid;
begin
  perform admin.require_admin('support');
  if length(p_reason) < 10 then raise exception 'reason required (≥10 chars)'; end if;

  insert into admin.tracker_signature_catalogue
    (signature_code, display_name, vendor, signature_type, pattern,
     category, severity, status, created_by, notes)
  values
    (p_signature_code, p_display_name, p_vendor, p_signature_type, p_pattern,
     p_category, p_severity, 'active', v_admin, p_notes)
  returning id into v_id;

  insert into admin.admin_audit_log
    (admin_user_id, action, target_table, target_id, target_pk, new_value, reason)
  values
    (v_admin, 'add_tracker_signature', 'admin.tracker_signature_catalogue', v_id, p_signature_code,
     jsonb_build_object('signature_type', p_signature_type, 'category', p_category), p_reason);

  return v_id;
end;
$$;

-- 16) admin.update_tracker_signature
create or replace function admin.update_tracker_signature(
  p_signature_id uuid,
  p_display_name text default null,
  p_pattern text default null,
  p_category text default null,
  p_severity text default null,
  p_notes text default null,
  p_reason text default null
) returns void
language plpgsql security definer set search_path = admin, public
as $$
declare
  v_admin uuid := auth.uid();
  v_old jsonb;
begin
  perform admin.require_admin('support');
  if p_reason is null or length(p_reason) < 10 then raise exception 'reason required (≥10 chars)'; end if;
  select to_jsonb(s.*) into v_old from admin.tracker_signature_catalogue s where id = p_signature_id;
  if v_old is null then raise exception 'signature not found'; end if;

  insert into admin.admin_audit_log
    (admin_user_id, action, target_table, target_id, target_pk, old_value, reason)
  values
    (v_admin, 'update_tracker_signature', 'admin.tracker_signature_catalogue', p_signature_id,
     v_old->>'signature_code', v_old, p_reason);

  update admin.tracker_signature_catalogue
     set display_name = coalesce(p_display_name, display_name),
         pattern = coalesce(p_pattern, pattern),
         category = coalesce(p_category, category),
         severity = coalesce(p_severity, severity),
         notes = coalesce(p_notes, notes)
   where id = p_signature_id;
end;
$$;

-- 17) admin.deprecate_tracker_signature
create or replace function admin.deprecate_tracker_signature(
  p_signature_id uuid, p_reason text
) returns void
language plpgsql security definer set search_path = admin, public
as $$
declare
  v_admin uuid := auth.uid();
  v_old jsonb;
begin
  perform admin.require_admin('support');
  if length(p_reason) < 10 then raise exception 'reason required (≥10 chars)'; end if;
  select to_jsonb(s.*) into v_old from admin.tracker_signature_catalogue s where id = p_signature_id;
  if v_old is null then raise exception 'signature not found'; end if;

  update admin.tracker_signature_catalogue
     set status = 'deprecated'
   where id = p_signature_id;

  insert into admin.admin_audit_log
    (admin_user_id, action, target_table, target_id, target_pk, old_value, new_value, reason)
  values
    (v_admin, 'deprecate_tracker_signature', 'admin.tracker_signature_catalogue', p_signature_id,
     v_old->>'signature_code', v_old, v_old || jsonb_build_object('status','deprecated'), p_reason);
end;
$$;

-- 18) admin.import_tracker_signature_pack — bulk insert from a jsonb array.
--     Used to ingest the supabase/seed/tracker_signatures.sql-derived data
--     post-bootstrap (shape transform happens in the caller).
create or replace function admin.import_tracker_signature_pack(
  p_pack jsonb, p_reason text
) returns int
language plpgsql security definer set search_path = admin, public
as $$
declare
  v_admin uuid := auth.uid();
  v_rec jsonb;
  v_count int := 0;
begin
  perform admin.require_admin('platform_operator');
  if length(p_reason) < 10 then raise exception 'reason required (≥10 chars)'; end if;
  if jsonb_typeof(p_pack) <> 'array' then raise exception 'pack must be a JSON array'; end if;

  for v_rec in select * from jsonb_array_elements(p_pack) loop
    insert into admin.tracker_signature_catalogue
      (signature_code, display_name, vendor, signature_type, pattern,
       category, severity, status, created_by, notes)
    values
      (v_rec->>'signature_code',
       v_rec->>'display_name',
       v_rec->>'vendor',
       v_rec->>'signature_type',
       v_rec->>'pattern',
       v_rec->>'category',
       coalesce(v_rec->>'severity', 'info'),
       'active',
       v_admin,
       v_rec->>'notes')
    on conflict (signature_code) do nothing;
    v_count := v_count + 1;
  end loop;

  insert into admin.admin_audit_log
    (admin_user_id, action, target_table, new_value, reason)
  values
    (v_admin, 'import_tracker_signature_pack', 'admin.tracker_signature_catalogue',
     jsonb_build_object('attempted_rows', v_count), p_reason);

  return v_count;
end;
$$;

-- ═══════════════════════════════════════════════════════════════════
-- § SUPPORT TICKETS
-- ═══════════════════════════════════════════════════════════════════

-- 19) admin.create_support_ticket — customer-facing (no admin claim
--     required). Called by the public /api/public/support-ticket endpoint
--     after captcha + any upstream checks.
create or replace function admin.create_support_ticket(
  p_org_id uuid,
  p_subject text,
  p_reporter_email text,
  p_reporter_name text default null,
  p_priority text default 'normal',
  p_category text default null,
  p_initial_message text default null
) returns uuid
language plpgsql security definer set search_path = admin, public
as $$
declare
  v_ticket_id uuid;
begin
  -- No admin.require_admin — this is the one RPC callable without an
  -- admin JWT. It's still SECURITY DEFINER so the insert lands despite
  -- admin.* grant restrictions.
  if length(coalesce(p_subject, '')) < 3 then raise exception 'subject required'; end if;
  if length(coalesce(p_reporter_email, '')) < 3 then raise exception 'reporter_email required'; end if;

  insert into admin.support_tickets
    (org_id, subject, priority, category, reporter_email, reporter_name)
  values
    (p_org_id, p_subject, p_priority, p_category, p_reporter_email, p_reporter_name)
  returning id into v_ticket_id;

  if p_initial_message is not null and length(p_initial_message) > 0 then
    insert into admin.support_ticket_messages (ticket_id, author_kind, author_id, body)
    values (v_ticket_id, 'customer', null, p_initial_message);
  end if;

  insert into admin.admin_audit_log
    (admin_user_id, action, target_table, target_id, org_id, new_value, reason)
  select
    id, 'customer_create_support_ticket', 'admin.support_tickets', v_ticket_id, p_org_id,
    jsonb_build_object('subject', p_subject, 'reporter_email', p_reporter_email),
    'customer-initiated ticket via public endpoint'
  from admin.admin_users
   order by created_at limit 1;
  -- Audit row uses the oldest admin_user_id as the nominal actor to
  -- satisfy the NOT NULL FK; the 'customer_create_*' action code makes
  -- the provenance unambiguous. Pre-bootstrap (no admin_users row), no
  -- audit row is written — documented as a Sprint 3.1 deviation and
  -- tracked in the ADR.

  return v_ticket_id;
end;
$$;

-- 20) admin.update_support_ticket
create or replace function admin.update_support_ticket(
  p_ticket_id uuid,
  p_status text default null,
  p_priority text default null,
  p_category text default null,
  p_resolution_summary text default null,
  p_reason text default null
) returns void
language plpgsql security definer set search_path = admin, public
as $$
declare
  v_admin uuid := auth.uid();
  v_old jsonb;
  v_new_status text;
begin
  perform admin.require_admin('support');
  if p_reason is null or length(p_reason) < 10 then raise exception 'reason required (≥10 chars)'; end if;
  select to_jsonb(t.*) into v_old from admin.support_tickets t where id = p_ticket_id;
  if v_old is null then raise exception 'ticket not found'; end if;

  v_new_status := coalesce(p_status, v_old->>'status');

  insert into admin.admin_audit_log
    (admin_user_id, action, target_table, target_id, org_id, old_value, reason)
  values
    (v_admin, 'update_support_ticket', 'admin.support_tickets', p_ticket_id,
     (v_old->>'org_id')::uuid, v_old, p_reason);

  update admin.support_tickets
     set status = v_new_status,
         priority = coalesce(p_priority, priority),
         category = coalesce(p_category, category),
         resolution_summary = coalesce(p_resolution_summary, resolution_summary),
         resolved_at = case when v_new_status in ('resolved','closed') and (v_old->>'resolved_at') is null
                            then now() else resolved_at end
   where id = p_ticket_id;
end;
$$;

-- 21) admin.add_support_ticket_message
create or replace function admin.add_support_ticket_message(
  p_ticket_id uuid,
  p_body text,
  p_attachments jsonb default null
) returns uuid
language plpgsql security definer set search_path = admin, public
as $$
declare
  v_admin uuid := auth.uid();
  v_msg_id uuid;
  v_ticket admin.support_tickets%rowtype;
begin
  perform admin.require_admin('support');
  if length(coalesce(p_body, '')) = 0 then raise exception 'body required'; end if;
  select * into v_ticket from admin.support_tickets where id = p_ticket_id;
  if v_ticket.id is null then raise exception 'ticket not found'; end if;

  insert into admin.support_ticket_messages
    (ticket_id, author_kind, author_id, body, attachments)
  values
    (p_ticket_id, 'admin', v_admin, p_body, p_attachments)
  returning id into v_msg_id;

  insert into admin.admin_audit_log
    (admin_user_id, action, target_table, target_id, org_id, new_value, reason)
  values
    (v_admin, 'add_support_ticket_message', 'admin.support_ticket_messages', v_msg_id, v_ticket.org_id,
     jsonb_build_object('ticket_id', p_ticket_id, 'body_length', length(p_body)),
     'operator reply on ticket');

  -- Status transition hint.
  update admin.support_tickets
     set status = 'awaiting_customer'
   where id = p_ticket_id and status in ('open','awaiting_operator');

  return v_msg_id;
end;
$$;

-- 22) admin.assign_support_ticket
create or replace function admin.assign_support_ticket(
  p_ticket_id uuid,
  p_assigned_admin_user_id uuid,
  p_reason text
) returns void
language plpgsql security definer set search_path = admin, public
as $$
declare
  v_admin uuid := auth.uid();
  v_old jsonb;
begin
  perform admin.require_admin('support');
  if length(p_reason) < 10 then raise exception 'reason required (≥10 chars)'; end if;
  select to_jsonb(t.*) into v_old from admin.support_tickets t where id = p_ticket_id;
  if v_old is null then raise exception 'ticket not found'; end if;

  insert into admin.admin_audit_log
    (admin_user_id, action, target_table, target_id, org_id, old_value, new_value, reason)
  values
    (v_admin, 'assign_support_ticket', 'admin.support_tickets', p_ticket_id,
     (v_old->>'org_id')::uuid,
     v_old, v_old || jsonb_build_object('assigned_admin_user_id', p_assigned_admin_user_id), p_reason);

  update admin.support_tickets
     set assigned_admin_user_id = p_assigned_admin_user_id
   where id = p_ticket_id;
end;
$$;

-- ═══════════════════════════════════════════════════════════════════
-- § ORG NOTES
-- ═══════════════════════════════════════════════════════════════════

-- 23) admin.add_org_note
create or replace function admin.add_org_note(
  p_org_id uuid, p_body text, p_pinned boolean default false
) returns uuid
language plpgsql security definer set search_path = admin, public
as $$
declare
  v_admin uuid := auth.uid();
  v_id uuid;
begin
  perform admin.require_admin('support');
  if length(coalesce(p_body, '')) < 1 then raise exception 'body required'; end if;

  insert into admin.org_notes (org_id, admin_user_id, body, pinned)
  values (p_org_id, v_admin, p_body, p_pinned)
  returning id into v_id;

  insert into admin.admin_audit_log
    (admin_user_id, action, target_table, target_id, org_id, new_value, reason)
  values
    (v_admin, 'add_org_note', 'admin.org_notes', v_id, p_org_id,
     jsonb_build_object('pinned', p_pinned, 'body_length', length(p_body)),
     'operator note added');
end;
$$;

-- 24) admin.update_org_note
create or replace function admin.update_org_note(
  p_note_id uuid,
  p_body text default null,
  p_pinned boolean default null,
  p_reason text default null
) returns void
language plpgsql security definer set search_path = admin, public
as $$
declare
  v_admin uuid := auth.uid();
  v_old jsonb;
begin
  perform admin.require_admin('support');
  if p_reason is null or length(p_reason) < 10 then raise exception 'reason required (≥10 chars)'; end if;
  select to_jsonb(n.*) into v_old from admin.org_notes n where id = p_note_id;
  if v_old is null then raise exception 'note not found'; end if;

  insert into admin.admin_audit_log
    (admin_user_id, action, target_table, target_id, org_id, old_value, reason)
  values
    (v_admin, 'update_org_note', 'admin.org_notes', p_note_id, (v_old->>'org_id')::uuid, v_old, p_reason);

  update admin.org_notes
     set body = coalesce(p_body, body),
         pinned = coalesce(p_pinned, pinned),
         updated_at = now()
   where id = p_note_id;
end;
$$;

-- 25) admin.delete_org_note — the only delete an admin can perform. Even
--     this one lands one audit row before the mutation.
create or replace function admin.delete_org_note(
  p_note_id uuid, p_reason text
) returns void
language plpgsql security definer set search_path = admin, public
as $$
declare
  v_admin uuid := auth.uid();
  v_old jsonb;
begin
  perform admin.require_admin('support');
  if length(p_reason) < 10 then raise exception 'reason required (≥10 chars)'; end if;
  select to_jsonb(n.*) into v_old from admin.org_notes n where id = p_note_id;
  if v_old is null then raise exception 'note not found'; end if;

  insert into admin.admin_audit_log
    (admin_user_id, action, target_table, target_id, org_id, old_value, reason)
  values
    (v_admin, 'delete_org_note', 'admin.org_notes', p_note_id, (v_old->>'org_id')::uuid, v_old, p_reason);

  delete from admin.org_notes where id = p_note_id;
end;
$$;

-- ═══════════════════════════════════════════════════════════════════
-- § FEATURE FLAGS
-- ═══════════════════════════════════════════════════════════════════

-- 26) admin.set_feature_flag — upsert a flag value at global or org scope.
create or replace function admin.set_feature_flag(
  p_flag_key text,
  p_scope text,
  p_value jsonb,
  p_description text,
  p_org_id uuid default null,
  p_expires_at timestamptz default null,
  p_reason text default null
) returns uuid
language plpgsql security definer set search_path = admin, public
as $$
declare
  v_admin uuid := auth.uid();
  v_id uuid;
  v_old jsonb;
begin
  perform admin.require_admin('platform_operator');
  if p_reason is null or length(p_reason) < 10 then raise exception 'reason required (≥10 chars)'; end if;
  if p_scope not in ('global','org') then raise exception 'scope must be global or org'; end if;
  if p_scope = 'org' and p_org_id is null then raise exception 'org_id required for org scope'; end if;

  -- Existing flag (for audit old_value).
  select to_jsonb(f.*) into v_old
    from admin.feature_flags f
   where f.flag_key = p_flag_key
     and f.scope = p_scope
     and coalesce(f.org_id, '00000000-0000-0000-0000-000000000000'::uuid)
         = coalesce(p_org_id, '00000000-0000-0000-0000-000000000000'::uuid);

  if v_old is null then
    insert into admin.feature_flags
      (flag_key, scope, org_id, value, description, set_by, expires_at)
    values
      (p_flag_key, p_scope, p_org_id, p_value, p_description, v_admin, p_expires_at)
    returning id into v_id;
  else
    update admin.feature_flags
       set value = p_value,
           description = p_description,
           set_by = v_admin,
           set_at = now(),
           expires_at = p_expires_at
     where flag_key = p_flag_key
       and scope = p_scope
       and coalesce(org_id, '00000000-0000-0000-0000-000000000000'::uuid)
           = coalesce(p_org_id, '00000000-0000-0000-0000-000000000000'::uuid)
    returning id into v_id;
  end if;

  insert into admin.admin_audit_log
    (admin_user_id, action, target_table, target_id, target_pk, org_id, old_value, new_value, reason)
  values
    (v_admin, 'set_feature_flag', 'admin.feature_flags', v_id, p_flag_key, p_org_id,
     v_old, jsonb_build_object('value', p_value, 'scope', p_scope, 'org_id', p_org_id), p_reason);

  return v_id;
end;
$$;

-- 27) admin.delete_feature_flag — scoped delete with audit.
create or replace function admin.delete_feature_flag(
  p_flag_key text, p_scope text, p_org_id uuid default null, p_reason text default null
) returns void
language plpgsql security definer set search_path = admin, public
as $$
declare
  v_admin uuid := auth.uid();
  v_old jsonb;
begin
  perform admin.require_admin('platform_operator');
  if p_reason is null or length(p_reason) < 10 then raise exception 'reason required (≥10 chars)'; end if;

  select to_jsonb(f.*) into v_old
    from admin.feature_flags f
   where f.flag_key = p_flag_key
     and f.scope = p_scope
     and coalesce(f.org_id, '00000000-0000-0000-0000-000000000000'::uuid)
         = coalesce(p_org_id, '00000000-0000-0000-0000-000000000000'::uuid);

  if v_old is null then raise exception 'flag not found'; end if;

  insert into admin.admin_audit_log
    (admin_user_id, action, target_table, target_pk, org_id, old_value, reason)
  values
    (v_admin, 'delete_feature_flag', 'admin.feature_flags', p_flag_key, p_org_id, v_old, p_reason);

  delete from admin.feature_flags
   where flag_key = p_flag_key
     and scope = p_scope
     and coalesce(org_id, '00000000-0000-0000-0000-000000000000'::uuid)
         = coalesce(p_org_id, '00000000-0000-0000-0000-000000000000'::uuid);
end;
$$;

-- ═══════════════════════════════════════════════════════════════════
-- § KILL SWITCHES
-- ═══════════════════════════════════════════════════════════════════

-- 28) admin.toggle_kill_switch — platform_operator-only gate. Emits
--     pg_notify so downstream sync Edge Function can refresh KV.
create or replace function admin.toggle_kill_switch(
  p_switch_key text, p_enabled boolean, p_reason text
) returns void
language plpgsql security definer set search_path = admin, public
as $$
declare
  v_admin uuid := auth.uid();
  v_old jsonb;
begin
  perform admin.require_admin('platform_operator');
  if length(p_reason) < 10 then raise exception 'reason required (≥10 chars)'; end if;
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

  perform pg_notify('kill_switch_changed',
    jsonb_build_object('switch_key', p_switch_key, 'enabled', p_enabled, 'admin_user_id', v_admin)::text);
end;
$$;

-- ═══════════════════════════════════════════════════════════════════
-- § PLATFORM METRICS
-- ═══════════════════════════════════════════════════════════════════

-- 29) admin.refresh_platform_metrics — re-aggregate one date's metrics
--     row. Called by admin-refresh-platform-metrics cron nightly for
--     yesterday; callable manually for any date via RPC.
--
--     Uses to_regclass guards around DEPA tables so the function
--     continues to work in dev environments where ADR-0020 hasn't yet
--     landed (DEPA metrics report 0 until the tables exist).
create or replace function admin.refresh_platform_metrics(p_date date)
returns void
language plpgsql security definer set search_path = admin, public
as $$
declare
  v_admin uuid := auth.uid();
  v_total_orgs int;
  v_active_orgs int;
  v_total_consents bigint;
  v_total_artefacts_active bigint := 0;
  v_total_artefacts_revoked bigint := 0;
  v_rights_open int;
  v_rights_breached int;
  v_worker_errors_24h int;
  v_buffer_max_age int;
begin
  perform admin.require_admin('support');

  select count(*) into v_total_orgs from public.organisations;

  -- An org is "active" if it has any consent_events or tracker_observations
  -- in the last 7 days (approximation; the dashboard's "active" definition).
  select count(distinct org_id) into v_active_orgs
    from (
      select org_id from public.consent_events where created_at > now() - interval '7 days'
      union
      select org_id from public.tracker_observations where created_at > now() - interval '7 days'
    ) a;

  -- Total consents delivered on this date (buffer row is deleted after
  -- delivery so this is approximate; processing_log would be stricter).
  select count(*) into v_total_consents
    from public.consent_events
   where created_at::date = p_date;

  -- DEPA metrics — guarded for pre-ADR-0020 environments.
  if to_regclass('public.consent_artefacts') is not null then
    execute 'select count(*) from public.consent_artefacts where status = ''active'''
      into v_total_artefacts_active;
  end if;
  if to_regclass('public.artefact_revocations') is not null then
    execute 'select count(*) from public.artefact_revocations where created_at::date = $1'
      using p_date
      into v_total_artefacts_revoked;
  end if;

  select count(*) into v_rights_open
    from public.rights_requests
   where status in ('open','in_progress','awaiting_customer');

  -- Breached = open AND beyond the 30-day DPDP response deadline.
  select count(*) into v_rights_breached
    from public.rights_requests
   where status in ('open','in_progress','awaiting_customer')
     and created_at < now() - interval '30 days';

  if to_regclass('public.worker_errors') is not null then
    execute 'select count(*) from public.worker_errors where created_at > now() - interval ''24 hours'''
      into v_worker_errors_24h;
  else
    v_worker_errors_24h := 0;
  end if;

  select coalesce(max(extract(epoch from (now() - created_at)) / 60)::int, 0)
    into v_buffer_max_age
    from public.delivery_buffer
   where delivered_at is null;

  insert into admin.platform_metrics_daily
    (metric_date, total_orgs, active_orgs, total_consents,
     total_artefacts_active, total_artefacts_revoked,
     total_rights_requests_open, rights_requests_breached,
     worker_errors_24h, delivery_buffer_max_age_min)
  values
    (p_date, v_total_orgs, v_active_orgs, v_total_consents,
     v_total_artefacts_active, v_total_artefacts_revoked,
     v_rights_open, v_rights_breached,
     v_worker_errors_24h, v_buffer_max_age)
  on conflict (metric_date) do update
     set total_orgs = excluded.total_orgs,
         active_orgs = excluded.active_orgs,
         total_consents = excluded.total_consents,
         total_artefacts_active = excluded.total_artefacts_active,
         total_artefacts_revoked = excluded.total_artefacts_revoked,
         total_rights_requests_open = excluded.total_rights_requests_open,
         rights_requests_breached = excluded.rights_requests_breached,
         worker_errors_24h = excluded.worker_errors_24h,
         delivery_buffer_max_age_min = excluded.delivery_buffer_max_age_min,
         refreshed_at = now();

  insert into admin.admin_audit_log
    (admin_user_id, action, target_table, target_pk, new_value, reason)
  values
    (v_admin, 'refresh_platform_metrics', 'admin.platform_metrics_daily', p_date::text,
     jsonb_build_object('total_orgs', v_total_orgs, 'active_orgs', v_active_orgs),
     'nightly metrics refresh');
end;
$$;

-- ═══════════════════════════════════════════════════════════════════
-- § AUDIT BULK EXPORT WRAPPER
-- ═══════════════════════════════════════════════════════════════════

-- 30) admin.audit_bulk_export — called by admin API routes after any
--     bulk-export action (CSV of orgs, audit log slice, etc.) so the
--     action is captured. The export itself happens outside of this
--     function (in the Next.js route handler); this RPC only records it.
create or replace function admin.audit_bulk_export(
  p_target_table text,
  p_filter jsonb,
  p_row_count int,
  p_reason text
) returns void
language plpgsql security definer set search_path = admin, public
as $$
declare
  v_admin uuid := auth.uid();
begin
  perform admin.require_admin('support');
  if length(p_reason) < 10 then raise exception 'reason required (≥10 chars)'; end if;
  if p_row_count < 0 then raise exception 'row_count must be non-negative'; end if;

  insert into admin.admin_audit_log
    (admin_user_id, action, target_table, new_value, reason)
  values
    (v_admin, 'bulk_export', p_target_table,
     jsonb_build_object('filter', p_filter, 'row_count', p_row_count),
     p_reason);
end;
$$;

-- Verification:
--   select count(*) from pg_proc
--     where pronamespace = 'admin'::regnamespace
--       and prokind = 'f'
--       and proname not in ('is_admin','current_admin_role','require_admin','create_next_audit_partition');
--   → 30 (29 admin-claim RPCs + create_support_ticket customer-facing)
