-- CLAUDE.md Rule 12 — identity isolation hardening for admin_invite_create.
--
-- Sprint 1.1 (20260503000001) defined admin.admin_invite_create with
-- platform_operator gate + a dup-row check on admin.admin_users. It did
-- not check for customer-side memberships on the target user_id.
--
-- Rule 12 mandate: an admin invite MUST refuse if the target has any
-- account_memberships or org_memberships rows. This defends against
-- the edge case where a service-role-created auth user happens to have
-- customer memberships (would normally be impossible, but the check is
-- cheap and closes the last cross-identity mixing path).
--
-- CREATE OR REPLACE in full so the new guard is close to the rest of
-- the body.

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

  -- Rule 12 — identity isolation. The target must have no customer
  -- memberships of any kind. If they do, refuse; the operator should
  -- invite via a different email.
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
