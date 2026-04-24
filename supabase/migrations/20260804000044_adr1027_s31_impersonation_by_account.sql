-- ADR-1027 Sprint 3.1 — admin.impersonation_sessions_by_account()
--
-- Per-account rollup of impersonation sessions. When an operator touches
-- N orgs inside the same account during a single customer-support push,
-- the default per-session log reads as N separate rows; this RPC
-- collapses them into one row per (account_id, admin_user_id) grouping
-- with orgs_touched count + total duration + session window.
--
-- Scope: returns every account visited during [now() - p_window_days, now()].
-- Default 30 days matches the ADR-0028 Operations Dashboard "last 30d"
-- framing and keeps the result set tight.
--
-- ADR-0055 landed target_account_id on admin.impersonation_sessions, so
-- we can group on that column directly. Sessions that pre-date ADR-0055
-- have target_account_id NULL; we derive via target_org_id →
-- organisations.account_id inside the CTE so the rollup covers them too.

create or replace function admin.impersonation_sessions_by_account(
  p_window_days integer default 30
)
returns table (
  account_id      uuid,
  account_name    text,
  admin_user_id   uuid,
  admin_name      text,
  orgs_touched    bigint,
  session_count   bigint,
  total_seconds   bigint,
  first_started   timestamptz,
  last_started    timestamptz,
  active_count    bigint
)
language plpgsql
security definer
set search_path = public, admin, pg_catalog
as $$
begin
  perform admin.require_admin('support');

  if p_window_days <= 0 then
    raise exception 'p_window_days must be positive';
  end if;

  return query
  with resolved as (
    select
      -- target_account_id wins (ADR-0055); otherwise derive via the org.
      coalesce(s.target_account_id, o.account_id) as account_id,
      s.admin_user_id,
      s.target_org_id,
      s.started_at,
      s.ended_at,
      s.status,
      -- duration = ended_at - started_at (open sessions count as now()).
      extract(epoch from (coalesce(s.ended_at, now()) - s.started_at)) as seconds
    from admin.impersonation_sessions s
    left join public.organisations o on o.id = s.target_org_id
    where s.started_at >= now() - (p_window_days || ' days')::interval
  )
  select
    r.account_id,
    a.name                                    as account_name,
    r.admin_user_id,
    au.display_name                           as admin_name,
    count(distinct r.target_org_id)           as orgs_touched,
    count(*)                                  as session_count,
    floor(sum(r.seconds))::bigint             as total_seconds,
    min(r.started_at)                         as first_started,
    max(r.started_at)                         as last_started,
    count(*) filter (where r.status = 'active') as active_count
  from resolved r
  left join public.accounts a    on a.id  = r.account_id
  left join admin.admin_users au on au.id = r.admin_user_id
  where r.account_id is not null
  group by r.account_id, a.name, r.admin_user_id, au.display_name
  order by max(r.started_at) desc;
end;
$$;

grant execute on function admin.impersonation_sessions_by_account(integer) to cs_admin;

comment on function admin.impersonation_sessions_by_account(integer) is
  'ADR-1027 Sprint 3.1. Per-account impersonation rollup: collapses '
  'multi-org sessions inside a single account into one row per '
  '(account, operator). Covers ADR-0055 target_account_id directly + '
  'derives for pre-0055 rows via target_org_id → organisations. support+.';

-- Verification:
--   select * from admin.impersonation_sessions_by_account(30) limit 5;
