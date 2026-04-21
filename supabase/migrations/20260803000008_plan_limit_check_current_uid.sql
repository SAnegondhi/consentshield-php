-- ADR-0058 follow-up — fix permission-denied-for-schema-auth on
-- /api/orgs/:orgId/properties POST during onboarding Step 5.
--
-- The function `public.rpc_plan_limit_check` is SECURITY DEFINER and
-- its owner is `cs_orchestrator` (set by 20260414000007 and preserved
-- through the 20260429 RBAC rewrite). cs_orchestrator does not have
-- USAGE on schema `auth` — so `auth.uid()` inside the function body
-- raises `permission denied for schema auth` when the function runs
-- in DEFINER context.
--
-- Fix: swap `auth.uid()` for `public.current_uid()` — a SECURITY
-- DEFINER wrapper that reads `current_setting('request.jwt.claim.sub')`
-- instead of touching the auth schema. This is the documented pattern
-- for scoped-role SECURITY DEFINER RPCs (see the
-- `feedback_no_auth_uid_in_scoped_rpcs` guidance).
--
-- Body otherwise identical to the 20260429 rewrite.

create or replace function public.rpc_plan_limit_check(
  p_org_id uuid,
  p_resource text
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_uid uuid := public.current_uid();
  v_plan_code text;
  v_current int;
  v_limit int;
begin
  if v_uid is null then
    raise exception 'unauthenticated' using errcode = '28000';
  end if;

  if not exists (
    select 1 from public.org_memberships
     where user_id = v_uid and org_id = p_org_id
  ) then
    raise exception 'not a member of org' using errcode = '42501';
  end if;

  select a.plan_code into v_plan_code
    from public.organisations o
    join public.accounts a on a.id = o.account_id
   where o.id = p_org_id;

  if p_resource = 'web_properties' then
    select count(*) into v_current from public.web_properties where org_id = p_org_id;
    select max_web_properties_per_org into v_limit from public.plans where plan_code = v_plan_code;
  elsif p_resource = 'deletion_connectors' then
    select count(*) into v_current from public.integration_connectors where org_id = p_org_id;
    v_limit := null;
  else
    raise exception 'unknown resource %', p_resource using errcode = '22023';
  end if;

  return jsonb_build_object('plan', v_plan_code, 'current', v_current, 'limit', v_limit);
end;
$$;

-- Owner + grants are preserved by `create or replace`; no need to
-- re-assert here.
