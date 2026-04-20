-- Migration: ADR-0029 follow-up — enriched customer-facing support sessions.
--
-- The existing public.org_support_sessions view returns raw admin_user_id
-- UUIDs which are meaningless to customers. This RPC joins in
-- admin.admin_users.display_name (read via SECURITY DEFINER — customers do
-- not gain direct grants on admin.*) and also computes a duration in
-- seconds so the UI can show "12 min session".
--
-- Scope:
--   · Only sessions targeting the caller's current org are returned.
--   · account_owner / org_admin / viewer (any org member) can call.

create or replace function public.list_org_support_sessions(
  p_status text default null,  -- optional filter: 'active' | 'completed' | 'expired' | 'force_ended'
  p_limit  int  default 100
)
returns table (
  id                      uuid,
  admin_display_name      text,
  reason                  text,
  reason_detail           text,
  started_at              timestamptz,
  ended_at                timestamptz,
  duration_seconds        integer,
  status                  text,
  actions_summary         jsonb
)
language plpgsql
security definer
set search_path = public, admin, pg_catalog
as $$
declare
  v_org_id uuid;
begin
  v_org_id := public.current_org_id();
  if v_org_id is null then
    raise exception 'no_org_context' using errcode = '42501';
  end if;

  -- Any member of the org is allowed; RLS on the underlying admin table is
  -- bypassed by SECURITY DEFINER, so we re-apply the org-scope filter here.
  if public.current_org_role() is null and public.current_account_role() is null then
    raise exception 'access_denied' using errcode = '42501';
  end if;

  return query
  select
    s.id,
    au.display_name                                 as admin_display_name,
    s.reason,
    s.reason_detail,
    s.started_at,
    s.ended_at,
    case
      when s.ended_at is not null
        then extract(epoch from (s.ended_at - s.started_at))::integer
      else
        extract(epoch from (now() - s.started_at))::integer
    end                                             as duration_seconds,
    s.status,
    s.actions_summary
  from admin.impersonation_sessions s
  left join admin.admin_users au on au.id = s.admin_user_id
  where s.target_org_id = v_org_id
    and (p_status is null or s.status = p_status)
  order by s.started_at desc
  limit p_limit;
end;
$$;

revoke execute on function public.list_org_support_sessions(text, int) from public;
grant execute on function public.list_org_support_sessions(text, int) to authenticated;

-- Verification:
--   select proname from pg_proc where pronamespace = 'public'::regnamespace and proname = 'list_org_support_sessions';
--   select has_function_privilege('authenticated','public.list_org_support_sessions(text, int)','execute');
