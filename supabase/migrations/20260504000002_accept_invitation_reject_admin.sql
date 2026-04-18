-- CLAUDE.md Rule 12 — identity isolation hardening.
--
-- public.accept_invitation is the only elevation path that turns a bare
-- auth.users row into a customer identity (adds account_memberships /
-- org_memberships). If the caller is already an admin identity
-- (app_metadata.is_admin = true), accepting a customer invite would
-- violate Rule 12 ("one auth.users row is either a customer identity
-- or an admin identity, never both").
--
-- Body here mirrors the ADR-0047 canonical version (single-account
-- race check + _conflicting_account_for_email) and adds a single guard
-- at the top that raises when the caller's JWT carries is_admin=true.
-- This migration MUST sit after 20260504000001 (ADR-0047 membership
-- lifecycle) on --include-all replays so its CREATE OR REPLACE wins
-- and the guard survives. Ordering:
--   20260430000001 — original invitations
--   20260504000001 — ADR-0047 membership lifecycle (re-declares body)
--   20260504000002 — THIS (re-declares body + is_admin guard)
--
-- If a future ADR touches accept_invitation again it MUST keep the
-- is_admin guard. CLAUDE.md Rule 12 is the contract.

create or replace function public.accept_invitation(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog, extensions
as $$
declare
  v_uid uuid := public.current_uid();
  v_email text;
  v_inv record;
  v_account_id uuid;
  v_org_id uuid;
  v_org_name text;
  v_trial_days int;
  v_conflict_account uuid;
  v_is_admin boolean;
begin
  if v_uid is null then
    raise exception 'unauthenticated' using errcode = '28000';
  end if;

  -- Rule 12 — identity isolation.
  select coalesce(
    (auth.jwt() -> 'app_metadata' ->> 'is_admin')::boolean,
    false
  ) into v_is_admin;
  if v_is_admin then
    raise exception
      'admin identity cannot accept customer invitations (CLAUDE.md Rule 12); use a separate email for customer work'
      using errcode = '42501';
  end if;

  select * into v_inv
    from public.invitations
   where token = p_token
   for update;
  if v_inv is null then
    raise exception 'invitation not found' using errcode = '42704';
  end if;
  if v_inv.accepted_at is not null then
    raise exception 'invitation already accepted' using errcode = '22023';
  end if;
  if v_inv.expires_at <= now() then
    raise exception 'invitation expired' using errcode = '22023';
  end if;

  select email into v_email from auth.users where id = v_uid;
  if lower(coalesce(v_email,'')) <> lower(v_inv.invited_email) then
    raise exception 'invitation email does not match authenticated user'
      using errcode = '42501';
  end if;

  -- Single-account-per-identity race check (ADR-0047).
  v_conflict_account := public._conflicting_account_for_email(v_inv.invited_email, v_inv.account_id);
  if v_conflict_account is not null then
    raise exception 'email has been added to account % since this invite was created — single-account-per-identity', v_conflict_account
      using errcode = '42501';
  end if;

  if v_inv.role = 'account_owner' and v_inv.account_id is null then
    v_org_name := coalesce(v_inv.default_org_name,
                           split_part(v_inv.invited_email, '@', 1));
    v_trial_days := coalesce(v_inv.trial_days,
                             (select trial_days from public.plans where plan_code = v_inv.plan_code));

    insert into public.accounts (name, plan_code, status, trial_ends_at)
    values (v_org_name,
            v_inv.plan_code,
            case when coalesce(v_trial_days, 0) > 0 then 'trial' else 'active' end,
            case when coalesce(v_trial_days, 0) > 0 then now() + make_interval(days => v_trial_days) else null end)
    returning id into v_account_id;

    insert into public.organisations (name, account_id)
    values (v_org_name, v_account_id)
    returning id into v_org_id;

    insert into public.account_memberships (account_id, user_id, role, accepted_at)
    values (v_account_id, v_uid, 'account_owner', now());

    insert into public.org_memberships (org_id, user_id, role)
    values (v_org_id, v_uid, 'org_admin');

  elsif v_inv.role in ('account_owner','account_viewer') then
    v_account_id := v_inv.account_id;
    insert into public.account_memberships (account_id, user_id, role, invited_by, invited_at, accepted_at)
    values (v_account_id, v_uid, v_inv.role, v_inv.invited_by, v_inv.created_at, now())
    on conflict (account_id, user_id) do update
      set role = excluded.role, status = 'active';

  else
    v_account_id := v_inv.account_id;
    v_org_id := v_inv.org_id;
    insert into public.org_memberships (org_id, user_id, role)
    values (v_org_id, v_uid, v_inv.role)
    on conflict (org_id, user_id) do update
      set role = excluded.role;
  end if;

  update public.invitations
     set accepted_at = now(),
         accepted_by = v_uid
   where id = v_inv.id;

  return jsonb_build_object(
    'ok', true,
    'role', v_inv.role,
    'account_id', v_account_id,
    'org_id', v_org_id
  );
end;
$$;

revoke execute on function public.accept_invitation(text) from public, anon;
grant execute on function public.accept_invitation(text) to authenticated;
