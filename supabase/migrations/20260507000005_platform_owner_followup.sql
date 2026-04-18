-- ADR-0050 Sprint 2.1 — follow-up to 20260507000004_admin_role_platform_owner.sql.
--
-- The prior migration's CREATE OR REPLACE of admin_invite_create dropped
-- the Rule-12 isolation check from 20260504000003, and the admin_disable
-- self-disable error was reworded away from the "yourself" text that
-- admin-lifecycle-rpcs.test.ts asserts. This migration restores both.
--
-- The platform_owner-guard additions (landing in 20260507000004) remain
-- in place; this file is strictly additive-corrective.

create or replace function admin.admin_invite_create(
  p_user_id      uuid,
  p_display_name text,
  p_admin_role   text,
  p_reason       text
)
returns uuid
language plpgsql
security definer
set search_path = admin, public, pg_catalog
as $$
declare
  v_operator uuid := auth.uid();
  v_mismatch_count int;
begin
  perform admin.require_admin('platform_operator');

  if p_admin_role = 'platform_owner' then
    raise exception 'platform_owner cannot be invited — seeded via SQL migration only'
      using errcode = '42501';
  end if;
  if p_admin_role not in ('platform_operator', 'support', 'read_only') then
    raise exception 'admin_role must be platform_operator, support, or read_only';
  end if;
  if length(coalesce(p_display_name, '')) < 1 then
    raise exception 'display_name required';
  end if;
  if length(coalesce(p_reason, '')) < 10 then
    raise exception 'reason required (≥10 chars)';
  end if;
  if exists (select 1 from admin.admin_users where id = p_user_id) then
    raise exception 'admin row already exists for this user';
  end if;

  -- CLAUDE.md Rule 12 — identity isolation. Target must have no customer
  -- memberships. Preserved from 20260504000003_admin_invite_isolation.sql.
  select
    (select count(*) from public.account_memberships where user_id = p_user_id) +
    (select count(*) from public.org_memberships     where user_id = p_user_id)
  into v_mismatch_count;
  if v_mismatch_count > 0 then
    raise exception
      'target has % customer membership(s); an admin identity cannot have customer memberships (CLAUDE.md Rule 12). Use a different email.',
      v_mismatch_count
      using errcode = '42501';
  end if;

  insert into admin.admin_users
    (id, display_name, admin_role, status, created_by)
  values
    (p_user_id, p_display_name, p_admin_role, 'invited', v_operator);

  insert into admin.admin_audit_log
    (admin_user_id, action, target_table, target_id, org_id, old_value, new_value, reason)
  values
    (v_operator, 'admin_invite_create', 'admin.admin_users', p_user_id, null,
     null,
     jsonb_build_object(
       'display_name', p_display_name,
       'admin_role',   p_admin_role,
       'status',       'invited'
     ),
     p_reason);

  return p_user_id;
end;
$$;

grant execute on function admin.admin_invite_create(uuid, text, text, text) to authenticated, cs_admin;

create or replace function admin.admin_disable(
  p_admin_id uuid,
  p_reason   text
)
returns void
language plpgsql
security definer
set search_path = admin, public, pg_catalog
as $$
declare
  v_operator        uuid := auth.uid();
  v_row             admin.admin_users%rowtype;
  v_active_po_count int;
begin
  perform admin.require_admin('platform_operator');

  if length(coalesce(p_reason, '')) < 10 then
    raise exception 'reason required (≥10 chars)';
  end if;
  if p_admin_id = v_operator then
    raise exception 'cannot disable yourself';
  end if;

  select * into v_row from admin.admin_users where id = p_admin_id;
  if v_row.id is null then
    raise exception 'admin not found';
  end if;
  if v_row.admin_role = 'platform_owner' then
    raise exception 'cannot disable a platform_owner — founder identity is migration-managed'
      using errcode = '42501';
  end if;
  if v_row.status = 'disabled' then
    raise exception 'admin is already disabled';
  end if;

  if v_row.admin_role = 'platform_operator' then
    select count(*) into v_active_po_count
      from admin.admin_users
     where admin_role = 'platform_operator'
       and status in ('active', 'invited');
    if v_active_po_count <= 1 then
      raise exception 'cannot disable the last active platform_operator';
    end if;
  end if;

  update admin.admin_users
     set status = 'disabled',
         disabled_at = now(),
         disabled_reason = p_reason
   where id = p_admin_id;

  insert into admin.admin_audit_log
    (admin_user_id, action, target_table, target_id, org_id, old_value, new_value, reason)
  values
    (v_operator, 'admin_disable', 'admin.admin_users', p_admin_id, null,
     jsonb_build_object('status', v_row.status, 'admin_role', v_row.admin_role),
     jsonb_build_object('status', 'disabled'),
     p_reason);
end;
$$;

grant execute on function admin.admin_disable(uuid, text) to authenticated, cs_admin;
