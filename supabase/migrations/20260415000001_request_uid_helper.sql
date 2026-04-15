-- Supabase locks down the `auth` schema; even `postgres` can't grant USAGE
-- on it (the owner is supabase_auth_admin, not postgres). The earlier grant
-- in 20260414000010 reported:
--     WARNING:  no privileges were granted for "auth"
-- meaning cs_orchestrator / cs_delivery never actually gained USAGE on
-- auth. Any security-definer RPC owned by these roles that references
-- auth.uid() therefore fails at call time with "permission denied for
-- schema auth" — visible in production on `rpc_plan_limit_check` from
-- the web-properties create flow.
--
-- Fix: a `public.current_uid()` helper owned by postgres that reads the
-- JWT claim via current_setting() directly (the same logic auth.uid()
-- uses internally). No auth-schema dependency. Replace every auth.uid()
-- reference in our RPCs with public.current_uid().

create or replace function public.current_uid()
returns uuid
language sql
stable
as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.sub', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
  )::uuid
$$;

grant execute on function public.current_uid() to anon, authenticated, cs_orchestrator, cs_delivery;

-- -----------------------------------------------------------------------------
-- Replace auth.uid() with public.current_uid() in every affected RPC.
-- Bodies are otherwise unchanged from migrations 005 / 007.
-- -----------------------------------------------------------------------------

create or replace function public.rpc_rights_event_append(
  p_org_id uuid,
  p_request_id uuid,
  p_event_type text,
  p_notes text,
  p_metadata jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_uid uuid := public.current_uid();
  v_role text;
  v_event_id uuid;
begin
  if v_uid is null then
    raise exception 'unauthenticated' using errcode = '28000';
  end if;

  select role into v_role
    from organisation_members
    where user_id = v_uid and org_id = p_org_id;

  if v_role is null then
    raise exception 'not a member of org' using errcode = '42501';
  end if;

  insert into rights_request_events (request_id, org_id, actor_id, event_type, notes, metadata)
    values (p_request_id, p_org_id, v_uid, p_event_type, p_notes, p_metadata)
    returning id into v_event_id;

  return jsonb_build_object('ok', true, 'event_id', v_event_id);
end;
$$;

create or replace function public.rpc_banner_publish(
  p_banner_id uuid,
  p_org_id uuid,
  p_new_signing_secret text
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_uid uuid := public.current_uid();
  v_role text;
  v_property_id uuid;
  v_old_secret text;
begin
  if v_uid is null then
    raise exception 'unauthenticated' using errcode = '28000';
  end if;

  select role into v_role
    from organisation_members
    where user_id = v_uid and org_id = p_org_id;

  if v_role is null then
    raise exception 'not a member of org' using errcode = '42501';
  end if;

  select property_id into v_property_id
    from consent_banners where id = p_banner_id and org_id = p_org_id;
  if v_property_id is null then
    return jsonb_build_object('ok', false, 'error', 'banner_not_found');
  end if;

  select event_signing_secret into v_old_secret
    from web_properties where id = v_property_id;

  update consent_banners set is_active = false
    where property_id = v_property_id and org_id = p_org_id;
  update consent_banners set is_active = true where id = p_banner_id;

  update web_properties set
    event_signing_secret = p_new_signing_secret,
    event_signing_secret_rotated_at = now()
  where id = v_property_id;

  insert into audit_log (org_id, actor_id, event_type, entity_type, entity_id, payload)
    values (
      p_org_id, v_uid, 'banner_published', 'consent_banner', p_banner_id,
      jsonb_build_object('property_id', v_property_id, 'secret_rotated', true)
    );

  return jsonb_build_object(
    'ok', true,
    'property_id', v_property_id,
    'old_secret', v_old_secret
  );
end;
$$;

create or replace function public.rpc_integration_connector_create(
  p_org_id uuid,
  p_connector_type text,
  p_display_name text,
  p_encrypted_config bytea
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_uid uuid := public.current_uid();
  v_role text;
  v_connector_id uuid;
begin
  if v_uid is null then
    raise exception 'unauthenticated' using errcode = '28000';
  end if;

  select role into v_role
    from organisation_members
    where user_id = v_uid and org_id = p_org_id;

  if v_role is null or v_role <> 'admin' then
    raise exception 'admin role required' using errcode = '42501';
  end if;

  insert into integration_connectors (
    org_id, connector_type, display_name, config, status
  ) values (
    p_org_id, p_connector_type, p_display_name, p_encrypted_config, 'active'
  ) returning id into v_connector_id;

  insert into audit_log (org_id, actor_id, event_type, entity_type, entity_id, payload)
    values (
      p_org_id, v_uid, 'connector_added', 'integration_connector', v_connector_id,
      jsonb_build_object('connector_type', p_connector_type, 'display_name', p_display_name)
    );

  return jsonb_build_object(
    'ok', true,
    'connector_id', v_connector_id,
    'connector_type', p_connector_type,
    'display_name', p_display_name
  );
end;
$$;

create or replace function public.rpc_signup_bootstrap_org(
  p_org_name text,
  p_industry text
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_uid uuid := public.current_uid();
  v_org_id uuid;
begin
  if v_uid is null then
    raise exception 'unauthenticated' using errcode = '28000';
  end if;

  insert into organisations (name, industry) values (p_org_name, p_industry)
    returning id into v_org_id;

  insert into organisation_members (org_id, user_id, role)
    values (v_org_id, v_uid, 'admin');

  insert into audit_log (org_id, actor_id, event_type, entity_type, entity_id)
    values (v_org_id, v_uid, 'org_created', 'organisation', v_org_id);

  return jsonb_build_object('ok', true, 'org_id', v_org_id, 'name', p_org_name);
end;
$$;

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
  v_plan text;
  v_current int;
begin
  if v_uid is null then
    raise exception 'unauthenticated' using errcode = '28000';
  end if;

  if not exists (
    select 1 from organisation_members where user_id = v_uid and org_id = p_org_id
  ) then
    raise exception 'not a member of org' using errcode = '42501';
  end if;

  select plan into v_plan from organisations where id = p_org_id;

  if p_resource = 'web_properties' then
    select count(*) into v_current from web_properties where org_id = p_org_id;
  elsif p_resource = 'deletion_connectors' then
    select count(*) into v_current from integration_connectors where org_id = p_org_id;
  else
    raise exception 'unknown resource %', p_resource using errcode = '22023';
  end if;

  return jsonb_build_object('plan', v_plan, 'current', v_current);
end;
$$;
