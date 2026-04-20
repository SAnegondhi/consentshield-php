-- Migration: ADR-0056 Sprint 1.1 — per-account feature-flag targeting.
--
-- ADR-0036/ADR-0027 shipped feature_flags with two scopes: global + org.
-- That's the wrong granularity for enterprise accounts (ADR-0044) where a
-- single account holds many orgs and the operator wants to enable a flag
-- for an ENTIRE ACCOUNT (and all its orgs) without stamping each org
-- individually.
--
-- This migration adds:
--   · admin.feature_flags.account_id column
--   · scope='account' + CHECK enforcing exactly one of account_id/org_id is
--     set for that scope
--   · unique index now covers (flag_key, scope, account_id, org_id)
--   · set_feature_flag + delete_feature_flag accept p_account_id
--   · get_feature_flag resolver fallback order:
--       org-scoped  → account-scoped  → global
--     (most specific wins; falls through on misses)

-- ============================================================================
-- 1. Schema — add account_id + extend scope CHECK
-- ============================================================================
alter table admin.feature_flags
  add column if not exists account_id uuid references public.accounts(id);

-- Drop the old scope CHECK (from table declaration)
alter table admin.feature_flags
  drop constraint if exists feature_flags_scope_check;

-- New scope enum + shape CHECK: exactly one column set matches the scope.
alter table admin.feature_flags
  add constraint feature_flags_scope_check check (scope in ('global','account','org'));

alter table admin.feature_flags
  drop constraint if exists feature_flags_scope_shape_check;

alter table admin.feature_flags
  add constraint feature_flags_scope_shape_check check (
    (scope = 'global'  and account_id is null     and org_id is null)
    or (scope = 'account' and account_id is not null and org_id is null)
    or (scope = 'org'     and org_id is not null     and account_id is null)
  );

-- Rebuild the unique index to cover account_id too.
drop index if exists feature_flags_key_scope_org_uq;
create unique index if not exists feature_flags_key_scope_full_uq
  on admin.feature_flags (
    flag_key,
    scope,
    coalesce(account_id, '00000000-0000-0000-0000-000000000000'::uuid),
    coalesce(org_id,     '00000000-0000-0000-0000-000000000000'::uuid)
  );

create index if not exists feature_flags_account_idx
  on admin.feature_flags (account_id) where account_id is not null;

-- ============================================================================
-- 2. get_feature_flag resolver — fallback order: org → account → global
-- ============================================================================
drop function if exists public.get_feature_flag(text);

create or replace function public.get_feature_flag(p_flag_key text)
returns jsonb
language sql
security definer
set search_path = admin, public, pg_catalog
stable
as $$
  select coalesce(
    -- 1. org-scoped for caller's current org
    (select value from admin.feature_flags
       where flag_key = p_flag_key
         and scope = 'org'
         and org_id = public.current_org_id()
         and (expires_at is null or expires_at > now())),
    -- 2. account-scoped for caller's current account (ADR-0056)
    (select value from admin.feature_flags
       where flag_key = p_flag_key
         and scope = 'account'
         and account_id = public.current_account_id()
         and (expires_at is null or expires_at > now())),
    -- 3. global default
    (select value from admin.feature_flags
       where flag_key = p_flag_key
         and scope = 'global'
         and (expires_at is null or expires_at > now()))
  );
$$;

grant execute on function public.get_feature_flag(text) to authenticated;

-- ============================================================================
-- 3. admin.set_feature_flag — accepts optional p_account_id
-- ============================================================================
drop function if exists admin.set_feature_flag(text, text, jsonb, text, uuid, timestamptz, text);

create or replace function admin.set_feature_flag(
  p_flag_key   text,
  p_scope      text,
  p_value      jsonb,
  p_description text,
  p_org_id     uuid        default null,
  p_account_id uuid        default null,
  p_expires_at timestamptz default null,
  p_reason     text        default null
) returns uuid
language plpgsql security definer set search_path = admin, public, pg_catalog
as $$
declare
  v_admin uuid := auth.uid();
  v_id    uuid;
  v_old   jsonb;
begin
  perform admin.require_admin('platform_operator');

  if p_reason is null or length(p_reason) < 10 then
    raise exception 'reason required (>=10 chars)';
  end if;

  if p_scope not in ('global', 'account', 'org') then
    raise exception 'scope must be global, account, or org';
  end if;
  if p_scope = 'org' and p_org_id is null then
    raise exception 'org_id required for org scope';
  end if;
  if p_scope = 'account' and p_account_id is null then
    raise exception 'account_id required for account scope';
  end if;
  if p_scope = 'global' and (p_org_id is not null or p_account_id is not null) then
    raise exception 'global scope must not carry org_id or account_id';
  end if;
  if p_scope = 'account' and p_org_id is not null then
    raise exception 'account scope must not carry org_id';
  end if;
  if p_scope = 'org' and p_account_id is not null then
    raise exception 'org scope must not carry account_id';
  end if;

  -- Existing flag (for audit old_value).
  select to_jsonb(f.*) into v_old
    from admin.feature_flags f
   where f.flag_key = p_flag_key
     and f.scope = p_scope
     and coalesce(f.account_id, '00000000-0000-0000-0000-000000000000'::uuid)
         = coalesce(p_account_id, '00000000-0000-0000-0000-000000000000'::uuid)
     and coalesce(f.org_id, '00000000-0000-0000-0000-000000000000'::uuid)
         = coalesce(p_org_id, '00000000-0000-0000-0000-000000000000'::uuid);

  if v_old is null then
    insert into admin.feature_flags
      (flag_key, scope, org_id, account_id, value, description, set_by, set_at, expires_at)
    values
      (p_flag_key, p_scope, p_org_id, p_account_id, p_value, p_description, v_admin, now(), p_expires_at)
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
       and coalesce(account_id, '00000000-0000-0000-0000-000000000000'::uuid)
           = coalesce(p_account_id, '00000000-0000-0000-0000-000000000000'::uuid)
       and coalesce(org_id, '00000000-0000-0000-0000-000000000000'::uuid)
           = coalesce(p_org_id, '00000000-0000-0000-0000-000000000000'::uuid)
    returning id into v_id;
  end if;

  insert into admin.admin_audit_log
    (admin_user_id, action, target_table, target_pk, org_id, old_value, new_value, reason)
  values
    (v_admin, 'set_feature_flag', 'admin.feature_flags', p_flag_key,
     coalesce(p_org_id, null),
     v_old,
     jsonb_build_object(
       'flag_key', p_flag_key,
       'scope',    p_scope,
       'org_id',   p_org_id,
       'account_id', p_account_id,
       'value',    p_value,
       'description', p_description,
       'expires_at',  p_expires_at
     ),
     p_reason);

  return v_id;
end;
$$;

grant execute on function admin.set_feature_flag(text, text, jsonb, text, uuid, uuid, timestamptz, text)
  to authenticated;

-- ============================================================================
-- 4. admin.delete_feature_flag — accepts optional p_account_id
-- ============================================================================
drop function if exists admin.delete_feature_flag(text, text, uuid, text);

create or replace function admin.delete_feature_flag(
  p_flag_key   text,
  p_scope      text,
  p_org_id     uuid default null,
  p_account_id uuid default null,
  p_reason     text default null
) returns void
language plpgsql security definer set search_path = admin, public, pg_catalog
as $$
declare
  v_admin uuid := auth.uid();
  v_old   jsonb;
begin
  perform admin.require_admin('platform_operator');
  if p_reason is null or length(p_reason) < 10 then
    raise exception 'reason required (>=10 chars)';
  end if;

  select to_jsonb(f.*) into v_old
    from admin.feature_flags f
   where f.flag_key = p_flag_key
     and f.scope = p_scope
     and coalesce(f.account_id, '00000000-0000-0000-0000-000000000000'::uuid)
         = coalesce(p_account_id, '00000000-0000-0000-0000-000000000000'::uuid)
     and coalesce(f.org_id, '00000000-0000-0000-0000-000000000000'::uuid)
         = coalesce(p_org_id, '00000000-0000-0000-0000-000000000000'::uuid);

  if v_old is null then
    raise exception 'flag not found';
  end if;

  insert into admin.admin_audit_log
    (admin_user_id, action, target_table, target_pk, org_id, old_value, reason)
  values
    (v_admin, 'delete_feature_flag', 'admin.feature_flags', p_flag_key, p_org_id, v_old, p_reason);

  delete from admin.feature_flags
   where flag_key = p_flag_key
     and scope = p_scope
     and coalesce(account_id, '00000000-0000-0000-0000-000000000000'::uuid)
         = coalesce(p_account_id, '00000000-0000-0000-0000-000000000000'::uuid)
     and coalesce(org_id, '00000000-0000-0000-0000-000000000000'::uuid)
         = coalesce(p_org_id, '00000000-0000-0000-0000-000000000000'::uuid);
end;
$$;

grant execute on function admin.delete_feature_flag(text, text, uuid, uuid, text)
  to authenticated;
