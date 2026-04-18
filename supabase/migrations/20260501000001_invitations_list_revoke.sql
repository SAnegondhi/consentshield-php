-- ADR-0044 Phase 2.4 — list + revoke primitives for customer-side
-- member management.
--
-- Adds:
--   * public.invitations.revoked_at / revoked_by columns
--   * replaces invitations_pending_uniq to also exclude revoked rows
--   * public.list_pending_invitations() SECURITY DEFINER RPC
--   * public.revoke_invitation(p_id uuid) SECURITY DEFINER RPC
--
-- Gate semantics mirror create_invitation (Phase 2.1):
--   - account_owner of the account sees / revokes any invite for that
--     account (regardless of which org it targets).
--   - org_admin (via effective_org_role) sees / revokes invites scoped
--     to their own org.
--   - app_metadata.is_admin JWT bypasses every check.

-- ═══════════════════════════════════════════════════════════
-- 1/4 · schema additions
-- ═══════════════════════════════════════════════════════════

alter table public.invitations
  add column if not exists revoked_at timestamptz,
  add column if not exists revoked_by uuid references auth.users(id) on delete set null;

-- Replace the pending-unique index so a revoked invite no longer
-- blocks re-issuing to the same person.
drop index if exists public.invitations_pending_uniq;

create unique index invitations_pending_uniq
  on public.invitations (
    lower(invited_email),
    coalesce(account_id, '00000000-0000-0000-0000-000000000000'::uuid),
    coalesce(org_id, '00000000-0000-0000-0000-000000000000'::uuid)
  ) where accepted_at is null and revoked_at is null;

-- Update the lookup indexes for the same reason — "pending" now means
-- (accepted_at is null and revoked_at is null).
drop index if exists public.invitations_email_idx;
drop index if exists public.invitations_account_idx;
drop index if exists public.invitations_org_idx;

create index invitations_email_idx
  on public.invitations (lower(invited_email))
  where accepted_at is null and revoked_at is null;

create index invitations_account_idx
  on public.invitations (account_id)
  where accepted_at is null and revoked_at is null and account_id is not null;

create index invitations_org_idx
  on public.invitations (org_id)
  where accepted_at is null and revoked_at is null and org_id is not null;

-- ═══════════════════════════════════════════════════════════
-- 2/4 · invitation_preview must ignore revoked invites
-- ═══════════════════════════════════════════════════════════

create or replace function public.invitation_preview(p_token text)
returns table (
  invited_email    text,
  role             text,
  account_id       uuid,
  org_id           uuid,
  plan_code        text,
  default_org_name text,
  expires_at       timestamptz,
  accepted_at      timestamptz
)
language sql
stable
security definer
set search_path = public, pg_catalog
as $$
  select i.invited_email, i.role, i.account_id, i.org_id,
         i.plan_code, i.default_org_name, i.expires_at, i.accepted_at
    from public.invitations i
   where i.token = p_token
     and i.revoked_at is null
   limit 1
$$;

grant execute on function public.invitation_preview(text) to anon, authenticated;

-- ═══════════════════════════════════════════════════════════
-- 3/4 · public.list_pending_invitations()
-- ═══════════════════════════════════════════════════════════
-- Returns invitations visible to the caller in their current context
-- (current_account_id / current_org_id derived from the JWT). Admin
-- JWT sees every pending invite across the platform.

create or replace function public.list_pending_invitations()
returns table (
  id             uuid,
  invited_email  text,
  role           text,
  account_id     uuid,
  org_id         uuid,
  plan_code      text,
  invited_by     uuid,
  created_at     timestamptz,
  expires_at     timestamptz
)
language plpgsql
stable
security definer
set search_path = public, pg_catalog
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
      select i.id, i.invited_email, i.role, i.account_id, i.org_id,
             i.plan_code, i.invited_by, i.created_at, i.expires_at
        from public.invitations i
       where i.accepted_at is null
         and i.revoked_at is null
       order by i.created_at desc;
    return;
  end if;

  if v_account_role = 'account_owner' then
    return query
      select i.id, i.invited_email, i.role, i.account_id, i.org_id,
             i.plan_code, i.invited_by, i.created_at, i.expires_at
        from public.invitations i
       where i.accepted_at is null
         and i.revoked_at is null
         and i.account_id = v_account_id
       order by i.created_at desc;
    return;
  end if;

  if v_org_effective = 'org_admin' then
    return query
      select i.id, i.invited_email, i.role, i.account_id, i.org_id,
             i.plan_code, i.invited_by, i.created_at, i.expires_at
        from public.invitations i
       where i.accepted_at is null
         and i.revoked_at is null
         and i.org_id = v_org_id
       order by i.created_at desc;
    return;
  end if;

  -- No read privilege → empty set (not an error; the UI simply hides
  -- the pending-invites card).
  return;
end;
$$;

grant execute on function public.list_pending_invitations() to authenticated;

-- ═══════════════════════════════════════════════════════════
-- 4/4 · public.revoke_invitation(p_id uuid)
-- ═══════════════════════════════════════════════════════════
-- Same gate semantics as create_invitation. Sets revoked_at / revoked_by
-- instead of deleting so we retain an audit trail.

create or replace function public.revoke_invitation(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_uid uuid := public.current_uid();
  v_is_admin_jwt boolean := coalesce((auth.jwt() -> 'app_metadata' ->> 'is_admin')::boolean, false);
  v_inv public.invitations%rowtype;
  v_account_role text;
  v_org_effective text;
begin
  if v_uid is null and not v_is_admin_jwt then
    raise exception 'unauthenticated' using errcode = '28000';
  end if;

  select * into v_inv
    from public.invitations
   where id = p_id
   limit 1;

  if not found then
    raise exception 'invitation % not found', p_id using errcode = '22023';
  end if;

  if v_inv.accepted_at is not null then
    raise exception 'invitation already accepted' using errcode = '22023';
  end if;

  if v_inv.revoked_at is not null then
    -- Idempotent — the caller already revoked or a parallel call got
    -- there first. Return silently.
    return;
  end if;

  if not v_is_admin_jwt then
    -- account-creating invite: only admin JWT may revoke.
    if v_inv.role = 'account_owner' and v_inv.account_id is null then
      raise exception 'account-creating invites are operator-only'
        using errcode = '42501';
    end if;

    -- account-scoped roles → caller must be account_owner of the account.
    if v_inv.role in ('account_owner','account_viewer','org_admin') then
      select am.role into v_account_role
        from public.account_memberships am
       where am.user_id = v_uid and am.account_id = v_inv.account_id
       limit 1;
      if coalesce(v_account_role, '') <> 'account_owner' then
        raise exception 'account_owner role required' using errcode = '42501';
      end if;
    elsif v_inv.role in ('admin','viewer') then
      -- org-scoped roles → caller must be account_owner OR org_admin
      -- on the invite's org.
      v_org_effective := public.effective_org_role(v_inv.org_id);
      if coalesce(v_org_effective, '') <> 'org_admin' then
        raise exception 'org_admin (or account_owner) role required'
          using errcode = '42501';
      end if;
    end if;
  end if;

  update public.invitations
     set revoked_at = now(),
         revoked_by = v_uid
   where id = p_id;
end;
$$;

grant execute on function public.revoke_invitation(uuid) to authenticated;

-- ═══════════════════════════════════════════════════════════
-- Verification queries
-- ═══════════════════════════════════════════════════════════
-- select pg_get_functiondef('public.list_pending_invitations()'::regprocedure);
-- select pg_get_functiondef('public.revoke_invitation(uuid)'::regprocedure);
-- select indexname from pg_indexes where tablename = 'invitations';
