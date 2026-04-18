-- ADR-0044 Phase 2.4 — list_members RPC.
--
-- auth.users is not readable by the authenticated role, so joining
-- memberships with user emails requires a SECURITY DEFINER RPC. This
-- function returns the union of account_memberships + org_memberships
-- for orgs the caller can see, with the invitee's email pulled from
-- auth.users.
--
-- Visibility mirrors list_pending_invitations (Phase 2.4 migration 1):
--   * account_owner  → every member of their account, across all orgs
--   * org_admin      → members of their own org + account-tier owners
--                      (so the org admin can see who has global powers
--                      over their workspace).
--   * otherwise      → empty set.
-- admin JWT bypasses the gate and returns platform-wide members.

create or replace function public.list_members()
returns table (
  scope       text,      -- 'account' | 'org'
  account_id  uuid,
  org_id      uuid,
  user_id     uuid,
  email       text,
  role        text,
  status      text,
  joined_at   timestamptz
)
language plpgsql
stable
security definer
set search_path = public, pg_catalog, auth
as $$
declare
  v_is_admin_jwt boolean := coalesce((auth.jwt() -> 'app_metadata' ->> 'is_admin')::boolean, false);
  v_account_role text := coalesce(public.current_account_role(), '');
  v_org_effective text := coalesce(public.effective_org_role(public.current_org_id()), '');
  v_account_id uuid := public.current_account_id();
  v_org_id uuid := public.current_org_id();
begin
  if v_is_admin_jwt then
    return query
      select 'account'::text, am.account_id, null::uuid, am.user_id,
             u.email::text, am.role, am.status, am.accepted_at
        from public.account_memberships am
        join auth.users u on u.id = am.user_id
      union all
      select 'org'::text, o.account_id, om.org_id, om.user_id,
             u.email::text, om.role, 'active'::text, om.created_at
        from public.org_memberships om
        join auth.users u on u.id = om.user_id
        join public.organisations o on o.id = om.org_id;
    return;
  end if;

  if v_account_role = 'account_owner' then
    return query
      select 'account'::text, am.account_id, null::uuid, am.user_id,
             u.email::text, am.role, am.status, am.accepted_at
        from public.account_memberships am
        join auth.users u on u.id = am.user_id
       where am.account_id = v_account_id
      union all
      select 'org'::text, o.account_id, om.org_id, om.user_id,
             u.email::text, om.role, 'active'::text, om.created_at
        from public.org_memberships om
        join auth.users u on u.id = om.user_id
        join public.organisations o on o.id = om.org_id
       where o.account_id = v_account_id;
    return;
  end if;

  if v_org_effective = 'org_admin' then
    return query
      select 'account'::text, am.account_id, null::uuid, am.user_id,
             u.email::text, am.role, am.status, am.accepted_at
        from public.account_memberships am
        join auth.users u on u.id = am.user_id
       where am.account_id = v_account_id
      union all
      select 'org'::text, o.account_id, om.org_id, om.user_id,
             u.email::text, om.role, 'active'::text, om.created_at
        from public.org_memberships om
        join auth.users u on u.id = om.user_id
        join public.organisations o on o.id = om.org_id
       where om.org_id = v_org_id;
    return;
  end if;

  return;
end;
$$;

grant execute on function public.list_members() to authenticated;

-- Verification:
-- select * from public.list_members();
