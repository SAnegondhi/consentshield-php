-- ADR-1003 Sprint 4.2 — admin template-draft RPCs accept
-- default_storage_mode + connector_defaults.
-- (c) 2026 Sudhindra Anegondhi a.d.sudhindra@gmail.com
--
-- Sprint 4.1 (migration 56) added two columns to admin.sectoral_templates
-- but only seeded them via raw INSERT in the same migration.
-- admin.create_sectoral_template_draft and admin.update_sectoral_template_draft
-- (migration 12 from ADR-0027 Sprint 3.1) didn't accept the columns, so
-- operators couldn't draft a sector pack with these settings without a
-- migration round-trip. Sprint 4.2 closes that gap: re-publishes both
-- RPCs with two new OPTIONAL parameters so existing callers (none in
-- the repo today; the only call site is the admin template form) keep
-- working.
--
-- Validation:
--   - default_storage_mode must be one of {standard, insulated, zero_storage}
--     or NULL (consistent with the column check constraint).
--   - connector_defaults must be a jsonb object (not array, not scalar)
--     or NULL.
--
-- Audit-log payload widens to include the two new fields when set so
-- the trail captures the full draft state.

-- ─────────────────────────────────────────────────────────────────────
-- 1. admin.create_sectoral_template_draft (re-published)
-- ─────────────────────────────────────────────────────────────────────
--
-- Drop the old 6-arg signature first. Adding two new parameters with
-- defaults via CREATE OR REPLACE creates a NEW overload alongside the
-- old signature instead of replacing it; PostgREST then can't choose
-- between them (PGRST203 "Could not choose the best candidate
-- function"). Drop-then-create is the cleanest path forward — the
-- only callers in-repo are the admin server actions, which we update
-- in the same commit.

drop function if exists admin.create_sectoral_template_draft(
  text, text, text, text, jsonb, text
);

create or replace function admin.create_sectoral_template_draft(
  p_template_code        text,
  p_display_name         text,
  p_description          text,
  p_sector               text,
  p_purpose_definitions  jsonb,
  p_reason               text,
  p_default_storage_mode text  default null,
  p_connector_defaults   jsonb default null
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

  if p_default_storage_mode is not null
     and p_default_storage_mode not in ('standard','insulated','zero_storage') then
    raise exception 'default_storage_mode must be one of standard / insulated / zero_storage'
      using errcode = '22023';
  end if;

  if p_connector_defaults is not null
     and jsonb_typeof(p_connector_defaults) <> 'object' then
    raise exception 'connector_defaults must be a JSON object'
      using errcode = '22023';
  end if;

  select coalesce(max(version), 0) + 1 into v_next_version
    from admin.sectoral_templates
   where template_code = p_template_code;

  insert into admin.sectoral_templates
    (template_code, display_name, description, sector, version, status,
     purpose_definitions, default_storage_mode, connector_defaults, created_by)
  values
    (p_template_code, p_display_name, p_description, p_sector, v_next_version, 'draft',
     p_purpose_definitions, p_default_storage_mode, p_connector_defaults, v_admin)
  returning id into v_id;

  insert into admin.admin_audit_log
    (admin_user_id, action, target_table, target_id, target_pk, new_value, reason)
  values
    (v_admin, 'create_sectoral_template_draft', 'admin.sectoral_templates', v_id, p_template_code,
     jsonb_build_object(
       'version',              v_next_version,
       'status',               'draft',
       'sector',               p_sector,
       'default_storage_mode', p_default_storage_mode,
       'connector_defaults',   p_connector_defaults
     ),
     p_reason);

  return v_id;
end;
$$;

-- ─────────────────────────────────────────────────────────────────────
-- 2. admin.update_sectoral_template_draft (re-published)
-- ─────────────────────────────────────────────────────────────────────

drop function if exists admin.update_sectoral_template_draft(
  uuid, text, text, jsonb, text
);

create or replace function admin.update_sectoral_template_draft(
  p_template_id          uuid,
  p_display_name         text,
  p_description          text,
  p_purpose_definitions  jsonb,
  p_reason               text,
  p_default_storage_mode text  default null,
  p_connector_defaults   jsonb default null
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

  if p_default_storage_mode is not null
     and p_default_storage_mode not in ('standard','insulated','zero_storage') then
    raise exception 'default_storage_mode must be one of standard / insulated / zero_storage'
      using errcode = '22023';
  end if;

  if p_connector_defaults is not null
     and jsonb_typeof(p_connector_defaults) <> 'object' then
    raise exception 'connector_defaults must be a JSON object'
      using errcode = '22023';
  end if;

  select * into v_t from admin.sectoral_templates where id = p_template_id;
  if v_t.id is null then raise exception 'template not found'; end if;
  if v_t.status <> 'draft' then raise exception 'template not in draft status'; end if;

  v_old := to_jsonb(v_t);

  insert into admin.admin_audit_log
    (admin_user_id, action, target_table, target_id, target_pk, old_value, new_value, reason)
  values
    (v_admin, 'update_sectoral_template_draft', 'admin.sectoral_templates', p_template_id, v_t.template_code,
     v_old,
     v_old || jsonb_build_object(
       'display_name',         p_display_name,
       'description',          p_description,
       'purpose_definitions',  p_purpose_definitions,
       'default_storage_mode', p_default_storage_mode,
       'connector_defaults',   p_connector_defaults
     ),
     p_reason);

  update admin.sectoral_templates
     set display_name         = p_display_name,
         description          = p_description,
         purpose_definitions  = p_purpose_definitions,
         default_storage_mode = p_default_storage_mode,
         connector_defaults   = p_connector_defaults
   where id = p_template_id;
end;
$$;

-- Verification (run manually after db push):
--   -- Old signatures still resolve with the new defaults:
--     select admin.create_sectoral_template_draft(
--       'edtech_starter','EdTech Starter','EdTech draft','edtech',
--       '[{"purpose_code":"essential","display_name":"Essential"}]'::jsonb,
--       'edtech draft for review'
--     );
--   -- New signatures with both extra params:
--     select admin.create_sectoral_template_draft(
--       'fintech_starter','FinTech Starter','FinTech draft','fintech',
--       '[{"purpose_code":"kyc","display_name":"KYC"}]'::jsonb,
--       'fintech draft for review',
--       'zero_storage',
--       '{"emr_vendor":{"category":"electronic_medical_record"}}'::jsonb
--     );
--   -- Validation refuses bad mode:
--     select admin.create_sectoral_template_draft(
--       't1','x','x','general','[{"purpose_code":"a","display_name":"A"}]'::jsonb,
--       '12345678901','garbage_mode'
--     );
--     -- expected: ERROR 22023 default_storage_mode must be one of ...
