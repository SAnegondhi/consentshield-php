-- Migration: ADR-0055 Sprint 1.1 — account-scoped impersonation.
--
-- Extends admin.impersonation_sessions so the target can be either:
--   · an organisation (existing behaviour — target_org_id set), OR
--   · an account (new — target_account_id set)
--
-- Exactly one of the two is set on every row (CHECK). Admin operators use
-- account-scoped sessions when they need a cross-org view of an account's
-- data (billing posture, account settings) rather than a single org.
--
-- RLS: the existing org_view policy lets org members see org-scoped sessions.
-- A new account_view policy lets account_owners see account-scoped sessions
-- targeting their account. Sessions remain admin-readable via admin_all.

-- ============================================================================
-- 1. Schema — relax target_org_id NOT NULL, add target_account_id, CHECK
-- ============================================================================
alter table admin.impersonation_sessions
  alter column target_org_id drop not null,
  add column if not exists target_account_id uuid references public.accounts(id) on delete cascade;

-- Drop any stale constraint name (idempotent)
alter table admin.impersonation_sessions
  drop constraint if exists impersonation_target_scope_check;

alter table admin.impersonation_sessions
  add constraint impersonation_target_scope_check check (
    (target_org_id is not null and target_account_id is null)
    or (target_org_id is null and target_account_id is not null)
  );

create index if not exists impersonation_sessions_account_idx
  on admin.impersonation_sessions (target_account_id, started_at desc)
  where target_account_id is not null;

-- New RLS policy: account_owners of the target account can SELECT the
-- account-scoped session rows. OR'd with existing admin_all + org_view.
drop policy if exists impersonation_sessions_account_view on admin.impersonation_sessions;
create policy impersonation_sessions_account_view on admin.impersonation_sessions
  for select to authenticated
  using (
    target_account_id is not null
    and exists (
      select 1 from public.account_memberships am
       where am.account_id = impersonation_sessions.target_account_id
         and am.user_id    = auth.uid()
         and am.role       = 'account_owner'
    )
  );

-- ============================================================================
-- 2. admin.start_impersonation_account(...)
-- ============================================================================
create or replace function admin.start_impersonation_account(
  p_account_id      uuid,
  p_reason          text,
  p_reason_detail   text,
  p_duration_minutes int default 30
) returns uuid
language plpgsql security definer set search_path = admin, public, pg_catalog
as $$
declare
  v_admin      uuid := auth.uid();
  v_session_id uuid;
  v_max int := coalesce(nullif(current_setting('app.impersonation_max_minutes', true), '')::int, 120);
begin
  perform admin.require_admin('support');
  if length(coalesce(p_reason_detail, '')) < 10 then
    raise exception 'reason_detail required (>=10 chars)';
  end if;
  if p_reason not in ('bug_investigation','data_correction','compliance_query','partner_demo','other') then
    raise exception 'invalid reason code: %', p_reason;
  end if;
  if p_duration_minutes < 1 or p_duration_minutes > v_max then
    raise exception 'duration must be between 1 and % minutes', v_max;
  end if;
  if not exists (select 1 from public.accounts where id = p_account_id) then
    raise exception 'account not found';
  end if;

  insert into admin.impersonation_sessions
    (admin_user_id, target_org_id, target_account_id, reason, reason_detail, expires_at)
  values
    (v_admin, null, p_account_id, p_reason, p_reason_detail,
     now() + make_interval(mins => p_duration_minutes))
  returning id into v_session_id;

  insert into admin.admin_audit_log
    (admin_user_id, action, target_table, target_id, org_id,
     impersonation_session_id, reason)
  values
    (v_admin, 'impersonate_start_account', 'admin.impersonation_sessions',
     v_session_id, null, v_session_id,
     'Account-scoped impersonation started: ' || p_reason || ' — ' || p_reason_detail);

  return v_session_id;
end;
$$;

revoke all on function admin.start_impersonation_account(uuid, text, text, int) from public;
grant execute on function admin.start_impersonation_account(uuid, text, text, int)
  to authenticated;

-- ============================================================================
-- 3. Update public.list_org_support_sessions to also emit account-scoped
--    sessions when the caller is an account_owner.
--
-- Return shape changes (adds target_scope), so DROP + CREATE is required.
-- ============================================================================
drop function if exists public.list_org_support_sessions(text, int);

create or replace function public.list_org_support_sessions(
  p_status text default null,
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
  actions_summary         jsonb,
  target_scope            text  -- 'org' | 'account' — new in ADR-0055
)
language plpgsql
security definer
set search_path = public, admin, pg_catalog
as $$
declare
  v_org_id     uuid;
  v_account_id uuid;
  v_is_owner   boolean;
begin
  v_org_id     := public.current_org_id();
  v_account_id := public.current_account_id();
  if v_org_id is null and v_account_id is null then
    raise exception 'no_org_context' using errcode = '42501';
  end if;

  if public.current_org_role() is null and public.current_account_role() is null then
    raise exception 'access_denied' using errcode = '42501';
  end if;

  v_is_owner := public.current_account_role() = 'account_owner';

  return query
  select
    s.id,
    au.display_name                                as admin_display_name,
    s.reason,
    s.reason_detail,
    s.started_at,
    s.ended_at,
    case
      when s.ended_at is not null
        then extract(epoch from (s.ended_at - s.started_at))::integer
      else
        extract(epoch from (now() - s.started_at))::integer
    end                                            as duration_seconds,
    s.status,
    s.actions_summary,
    case
      when s.target_account_id is not null then 'account'
      else 'org'
    end                                            as target_scope
  from admin.impersonation_sessions s
  left join admin.admin_users au on au.id = s.admin_user_id
  where (
    -- Org-scoped sessions for the caller's current org
    (s.target_org_id = v_org_id)
    or
    -- Account-scoped sessions: only for account_owner of the target account
    (s.target_account_id is not null
     and v_is_owner
     and s.target_account_id = v_account_id)
  )
  and (p_status is null or s.status = p_status)
  order by s.started_at desc
  limit p_limit;
end;
$$;

revoke execute on function public.list_org_support_sessions(text, int) from public;
grant execute on function public.list_org_support_sessions(text, int) to authenticated;
