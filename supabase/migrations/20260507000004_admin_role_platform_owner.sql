-- ADR-0050 Sprint 2.1 — admin_role platform_owner tier.
--
-- Adds a fourth admin_role tier `platform_owner` above `platform_operator`.
-- The owner tier is grant-able only by SQL migration (this file), never
-- through the admin app's invite / change-role / disable RPCs. It seeds
-- the founder's auth.users + admin.admin_users rows idempotently. Recovery
-- is via another migration with service-role access.
--
-- Downstream discipline (added in follow-on migrations this sprint):
--   · billing.issuer_entities writes require platform_owner
--   · billing invoice_export_manifest spans retired issuers only for
--     platform_owner; platform_operator callers get the currently-active
--     issuer scope only
--
-- Four guards land in this migration:
--   · admin.admin_invite_create  — rejects any p_admin_role='platform_owner'
--   · admin.admin_change_role    — rejects promoting TO 'platform_owner'
--                                  AND rejects changing a 'platform_owner'
--                                  row (founder identity protection)
--   · admin.admin_disable        — rejects disabling a 'platform_owner' row
--   · admin.require_admin        — extended tier-comparison logic

-- ═══════════════════════════════════════════════════════════
-- 1 · Extend admin_role CHECK constraint
-- ═══════════════════════════════════════════════════════════

alter table admin.admin_users
  drop constraint if exists admin_users_admin_role_check;

alter table admin.admin_users
  add constraint admin_users_admin_role_check
  check (admin_role in ('platform_owner','platform_operator','support','read_only'));

-- ═══════════════════════════════════════════════════════════
-- 2 · Extend admin.require_admin — platform_owner dominates
-- ═══════════════════════════════════════════════════════════
-- Role hierarchy (top → bottom): platform_owner > platform_operator >
-- support > read_only. A request for tier X passes when the caller's
-- admin_role is X or any higher tier.

create or replace function admin.require_admin(p_min_role text default 'support')
returns void language plpgsql as $$
begin
  if not admin.is_admin() then
    raise exception 'admin claim required' using errcode = '42501';
  end if;
  if p_min_role = 'platform_owner' and admin.current_admin_role() <> 'platform_owner' then
    raise exception 'platform_owner role required' using errcode = '42501';
  end if;
  if p_min_role = 'platform_operator'
     and admin.current_admin_role() not in ('platform_operator','platform_owner') then
    raise exception 'platform_operator role required' using errcode = '42501';
  end if;
  if p_min_role = 'support'
     and admin.current_admin_role() not in ('support','platform_operator','platform_owner') then
    raise exception 'support or platform_operator role required' using errcode = '42501';
  end if;
end;
$$;

grant execute on function admin.require_admin(text) to authenticated, cs_admin;

-- ═══════════════════════════════════════════════════════════
-- 3 · admin.admin_invite_create — reject platform_owner
-- ═══════════════════════════════════════════════════════════

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

comment on function admin.admin_invite_create(uuid, text, text, text) is
  'ADR-0045 + ADR-0050 Sprint 2.1. Records a pending admin_users row with '
  'status=invited. Refuses platform_owner invites — that tier is seeded '
  'by SQL migration only.';

-- ═══════════════════════════════════════════════════════════
-- 4 · admin.admin_change_role — protect platform_owner on both sides
-- ═══════════════════════════════════════════════════════════

create or replace function admin.admin_change_role(
  p_admin_id uuid,
  p_new_role text,
  p_reason   text
)
returns void
language plpgsql
security definer
set search_path = admin, public, pg_catalog
as $$
declare
  v_operator uuid := auth.uid();
  v_row      admin.admin_users%rowtype;
  v_active_po_count int;
begin
  perform admin.require_admin('platform_operator');

  if p_new_role = 'platform_owner' then
    raise exception 'cannot promote to platform_owner via RPC — seeded via SQL migration only'
      using errcode = '42501';
  end if;
  if p_new_role not in ('platform_operator', 'support', 'read_only') then
    raise exception 'admin_role must be platform_operator, support, or read_only';
  end if;
  if length(coalesce(p_reason, '')) < 10 then
    raise exception 'reason required (≥10 chars)';
  end if;
  if p_admin_id = v_operator then
    raise exception 'cannot change your own role';
  end if;

  select * into v_row from admin.admin_users where id = p_admin_id;
  if v_row.id is null then
    raise exception 'admin not found';
  end if;
  if v_row.admin_role = 'platform_owner' then
    raise exception 'cannot change a platform_owner role — founder identity is migration-managed'
      using errcode = '42501';
  end if;
  if v_row.admin_role = p_new_role then
    raise exception 'admin_role is already %', p_new_role;
  end if;

  -- Last-platform_operator protection: refuse demoting the only active
  -- platform_operator. Count includes 'active' + 'invited' rows; a
  -- disabled/suspended admin does not count. platform_owner rows do NOT
  -- count toward this floor — the owner tier is not a substitute for
  -- an operator (they administer different surfaces).
  if v_row.admin_role = 'platform_operator' and p_new_role <> 'platform_operator' then
    select count(*) into v_active_po_count
      from admin.admin_users
     where admin_role = 'platform_operator'
       and status in ('active', 'invited');
    if v_active_po_count <= 1 then
      raise exception 'cannot demote the last active platform_operator';
    end if;
  end if;

  update admin.admin_users
     set admin_role = p_new_role
   where id = p_admin_id;

  insert into admin.admin_audit_log
    (admin_user_id, action, target_table, target_id, org_id, old_value, new_value, reason)
  values
    (v_operator, 'admin_change_role', 'admin.admin_users', p_admin_id, null,
     jsonb_build_object('admin_role', v_row.admin_role),
     jsonb_build_object('admin_role', p_new_role),
     p_reason);
end;
$$;

grant execute on function admin.admin_change_role(uuid, text, text) to authenticated, cs_admin;

-- ═══════════════════════════════════════════════════════════
-- 5 · admin.admin_disable — protect platform_owner from disable
-- ═══════════════════════════════════════════════════════════

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

-- ═══════════════════════════════════════════════════════════
-- 6 · Founder seed — a.d.sudhindra@gmail.com
-- ═══════════════════════════════════════════════════════════
-- Idempotent: if the auth.users row exists, set admin_role=platform_owner
-- in both raw_app_meta_data (JWT claim source) and admin.admin_users.
-- If the row doesn't exist yet (fresh dev replays before bootstrap-admin.ts
-- runs), emit a NOTICE and move on — later bootstrap will land the row,
-- then a follow-up run of this migration re-seeds cleanly.

do $$
declare
  v_founder_email constant text := 'a.d.sudhindra@gmail.com';
  v_user_id uuid;
  v_existing admin.admin_users%rowtype;
begin
  select id into v_user_id from auth.users where email = v_founder_email;
  if v_user_id is null then
    raise notice 'ADR-0050 Sprint 2.1 — founder % not yet in auth.users; skipping platform_owner seed. Re-run this migration after bootstrap-admin.ts lands the row.', v_founder_email;
    return;
  end if;

  update auth.users
     set raw_app_meta_data = coalesce(raw_app_meta_data, '{}'::jsonb)
                             || jsonb_build_object(
                                  'is_admin',   true,
                                  'admin_role', 'platform_owner'
                                )
   where id = v_user_id;

  select * into v_existing from admin.admin_users where id = v_user_id;
  if v_existing.id is null then
    insert into admin.admin_users
      (id, display_name, admin_role, status, bootstrap_admin)
    values
      (v_user_id, 'Sudhindra Anegondhi', 'platform_owner', 'active', false);
    raise notice 'ADR-0050 Sprint 2.1 — inserted platform_owner admin_users row for founder %', v_founder_email;
  elsif v_existing.admin_role <> 'platform_owner' or v_existing.status <> 'active' then
    update admin.admin_users
       set admin_role = 'platform_owner',
           status = 'active'
     where id = v_user_id;
    raise notice 'ADR-0050 Sprint 2.1 — promoted % to platform_owner (was admin_role=% status=%)',
                 v_founder_email, v_existing.admin_role, v_existing.status;
  else
    raise notice 'ADR-0050 Sprint 2.1 — founder % already platform_owner; no change', v_founder_email;
  end if;
end $$;

-- Verification:
--   select conname, pg_get_constraintdef(oid)
--     from pg_constraint
--    where conrelid = 'admin.admin_users'::regclass
--      and conname = 'admin_users_admin_role_check';
--     → includes 'platform_owner'
--   select admin_role, status from admin.admin_users
--    where id = (select id from auth.users where email = 'a.d.sudhindra@gmail.com');
--     → platform_owner, active (after bootstrap)
