-- ADR-0044 Phase 2.6 — marketing-site invite creation.
--
-- The future consentshield.in marketing site posts "reserve your
-- spot" forms to /api/internal/invites, which verifies an HMAC and
-- then creates an account_owner invitation on behalf of the signup.
-- The existing public.create_invitation RPC gates account-creating
-- invites behind `auth.jwt().app_metadata.is_admin`, which the
-- marketing route doesn't have. This narrow wrapper keeps the same
-- body (shape check, token gen, expiry math) but drops the JWT
-- check and is exposed only to cs_orchestrator. Access control
-- lives in the Node.js route's HMAC verification.

create or replace function public.create_invitation_from_marketing(
  p_email            text,
  p_plan_code        text,
  p_trial_days       int  default null,
  p_default_org_name text default null,
  p_expires_in_days  int  default 14
)
returns table (id uuid, token text)
language plpgsql
security definer
set search_path = public, pg_catalog, extensions
as $$
declare
  v_token text;
  v_id uuid;
begin
  -- Input shape — same rules as the account-creating branch of
  -- public.create_invitation, minus the is_admin check.
  if p_email is null or length(trim(p_email)) < 3 then
    raise exception 'invited_email required' using errcode = '22023';
  end if;

  if p_plan_code is null then
    raise exception 'p_plan_code required for account-creating invites' using errcode = '22023';
  end if;

  if not exists (select 1 from public.plans where plan_code = p_plan_code and is_active = true) then
    raise exception 'plan_code % is not active', p_plan_code using errcode = '22023';
  end if;

  if p_expires_in_days < 1 or p_expires_in_days > 90 then
    raise exception 'p_expires_in_days must be in [1,90]' using errcode = '22023';
  end if;

  v_token := encode(extensions.gen_random_bytes(24), 'hex');

  insert into public.invitations (
    token, invited_email, account_id, org_id, role,
    plan_code, trial_days, default_org_name,
    invited_by, expires_at
  ) values (
    v_token, trim(p_email), null, null, 'account_owner',
    p_plan_code, p_trial_days, p_default_org_name,
    null, now() + make_interval(days => p_expires_in_days)
  )
  returning public.invitations.id into v_id;

  return query select v_id, v_token;
end;
$$;

-- Only cs_orchestrator may call this. `authenticated` has no path in;
-- the public RPC `create_invitation` is still the route for logged-in
-- operators (it retains the is_admin gate for parity with the older
-- callers).
revoke execute on function public.create_invitation_from_marketing(text, text, int, text, int) from public;
grant execute on function public.create_invitation_from_marketing(text, text, int, text, int) to cs_orchestrator;

-- Verification:
--   select has_function_privilege('cs_orchestrator', 'public.create_invitation_from_marketing(text,text,int,text,int)', 'execute');
--     → t
--   select has_function_privilege('authenticated', 'public.create_invitation_from_marketing(text,text,int,text,int)', 'execute');
--     → f
