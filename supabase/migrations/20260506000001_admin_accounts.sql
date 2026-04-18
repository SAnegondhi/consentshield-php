-- ADR-0048 Phase 1 Sprint 1.1 — Admin Accounts RPCs.
--
-- Four SECURITY DEFINER RPCs backing the admin /accounts panel and
-- closing the ADR-0034 Payment Failures "Suspend" deviation:
--
--   admin.accounts_list     — support+ list for the index page
--   admin.account_detail    — support+ single account + orgs + adjustments
--   admin.suspend_account   — platform_operator; fans out to child orgs
--   admin.restore_account   — platform_operator; reverses the matching
--                             most-recent suspend audit row
--
-- Suspend/restore fan-out is tracked via the admin.admin_audit_log
-- new_value payload. Storing the list of affected org ids there means
-- a later restore can roll back exactly what a suspend touched — no
-- heuristic about "orgs that are currently suspended" which could
-- grab orgs suspended for unrelated reasons.

-- ═══════════════════════════════════════════════════════════
-- 1 · admin.accounts_list
-- ═══════════════════════════════════════════════════════════
create or replace function admin.accounts_list(
  p_status    text default null,
  p_plan_code text default null,
  p_q         text default null
)
returns table (
  id                        uuid,
  name                      text,
  plan_code                 text,
  status                    text,
  razorpay_subscription_id  text,
  trial_ends_at             timestamptz,
  org_count                 bigint,
  effective_plan            text,
  created_at                timestamptz
)
language plpgsql
security definer
set search_path = public, admin, pg_catalog
as $$
begin
  perform admin.require_admin('support');

  if p_status is not null and p_status not in ('trial','active','past_due','suspended','cancelled') then
    raise exception 'p_status must be trial, active, past_due, suspended, cancelled, or null';
  end if;

  return query
  with org_counts as (
    select account_id, count(*)::bigint as n
      from public.organisations
     group by account_id
  )
  select a.id, a.name, a.plan_code, a.status,
         a.razorpay_subscription_id, a.trial_ends_at,
         coalesce(oc.n, 0)                     as org_count,
         public.account_effective_plan(a.id)   as effective_plan,
         a.created_at
    from public.accounts a
    left join org_counts oc on oc.account_id = a.id
   where (p_status    is null or a.status    = p_status)
     and (p_plan_code is null or a.plan_code = p_plan_code)
     and (p_q         is null or a.name ilike '%' || p_q || '%')
   order by a.created_at desc;
end;
$$;

grant execute on function admin.accounts_list(text, text, text) to cs_admin;

comment on function admin.accounts_list(text, text, text) is
  'ADR-0048 Phase 1.1. Admin list view for public.accounts with org count '
  'and effective_plan resolution. support+.';

-- ═══════════════════════════════════════════════════════════
-- 2 · admin.account_detail — single-row envelope
-- ═══════════════════════════════════════════════════════════
create or replace function admin.account_detail(p_account_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, admin, pg_catalog
as $$
declare
  v_acct jsonb;
  v_orgs jsonb;
  v_adj  jsonb;
  v_audit jsonb;
begin
  perform admin.require_admin('support');

  select to_jsonb(a.*) || jsonb_build_object(
           'effective_plan', public.account_effective_plan(a.id)
         )
    into v_acct
    from public.accounts a
   where a.id = p_account_id;
  if v_acct is null then
    raise exception 'account not found';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
           'id', o.id, 'name', o.name, 'status', o.status,
           'created_at', o.created_at
         ) order by o.created_at desc), '[]'::jsonb)
    into v_orgs
    from public.organisations o
   where o.account_id = p_account_id;

  select coalesce(jsonb_agg(jsonb_build_object(
           'id', pa.id, 'kind', pa.kind, 'plan', pa.plan,
           'starts_at', pa.starts_at, 'expires_at', pa.expires_at,
           'reason', pa.reason, 'granted_by', pa.granted_by,
           'created_at', pa.created_at
         ) order by pa.created_at desc), '[]'::jsonb)
    into v_adj
    from public.plan_adjustments pa
   where pa.account_id = p_account_id
     and pa.revoked_at is null
     and (pa.expires_at is null or pa.expires_at > now());

  select coalesce(jsonb_agg(jsonb_build_object(
           'action', al.action, 'admin_user_id', al.admin_user_id,
           'reason', al.reason, 'created_at', al.occurred_at,
           'new_value', al.new_value
         ) order by al.occurred_at desc), '[]'::jsonb)
    into v_audit
    from admin.admin_audit_log al
   where (al.target_id = p_account_id and al.target_table = 'public.accounts')
      or (al.org_id in (select id from public.organisations where account_id = p_account_id))
   limit 50;

  return jsonb_build_object(
    'account',            v_acct,
    'organisations',      v_orgs,
    'active_adjustments', v_adj,
    'audit_recent',       v_audit
  );
end;
$$;

grant execute on function admin.account_detail(uuid) to cs_admin;

-- ═══════════════════════════════════════════════════════════
-- 3 · admin.suspend_account
-- ═══════════════════════════════════════════════════════════
create or replace function admin.suspend_account(
  p_account_id uuid,
  p_reason     text
)
returns jsonb
language plpgsql
security definer
set search_path = public, admin, pg_catalog
as $$
declare
  v_operator uuid := auth.uid();
  v_old_acct jsonb;
  v_flipped  uuid[];
begin
  perform admin.require_admin('platform_operator');
  if length(coalesce(p_reason, '')) < 10 then
    raise exception 'reason required (≥10 chars)';
  end if;

  select to_jsonb(a.*) into v_old_acct
    from public.accounts a
   where a.id = p_account_id;
  if v_old_acct is null then
    raise exception 'account not found';
  end if;
  if (v_old_acct->>'status') = 'suspended' then
    raise exception 'account already suspended';
  end if;

  -- Fan out: collect the ids of child orgs currently 'active' so the
  -- restore RPC can reverse exactly this set. Orgs in other states
  -- (suspended, suspended_by_plan, archived) are left untouched.
  select coalesce(array_agg(id), '{}'::uuid[])
    into v_flipped
    from public.organisations
   where account_id = p_account_id
     and status     = 'active';

  update public.organisations
     set status = 'suspended',
         updated_at = now()
   where id = any(v_flipped);

  update public.accounts
     set status = 'suspended',
         updated_at = now()
   where id = p_account_id;

  insert into admin.admin_audit_log
    (admin_user_id, action, target_table, target_id, org_id, old_value, new_value, reason)
  values
    (v_operator, 'suspend_account', 'public.accounts', p_account_id, null,
     v_old_acct,
     jsonb_build_object(
       'status', 'suspended',
       'flipped_org_ids', to_jsonb(v_flipped)
     ),
     p_reason);

  return jsonb_build_object(
    'account_id',       p_account_id,
    'flipped_org_count', coalesce(array_length(v_flipped, 1), 0),
    'flipped_org_ids',   to_jsonb(v_flipped)
  );
end;
$$;

grant execute on function admin.suspend_account(uuid, text) to cs_admin;

-- ═══════════════════════════════════════════════════════════
-- 4 · admin.restore_account
-- ═══════════════════════════════════════════════════════════
create or replace function admin.restore_account(
  p_account_id uuid,
  p_reason     text
)
returns jsonb
language plpgsql
security definer
set search_path = public, admin, pg_catalog
as $$
declare
  v_operator uuid := auth.uid();
  v_old_acct jsonb;
  v_last_suspend jsonb;
  v_ids uuid[];
begin
  perform admin.require_admin('platform_operator');
  if length(coalesce(p_reason, '')) < 10 then
    raise exception 'reason required (≥10 chars)';
  end if;

  select to_jsonb(a.*) into v_old_acct
    from public.accounts a
   where a.id = p_account_id;
  if v_old_acct is null then
    raise exception 'account not found';
  end if;
  if (v_old_acct->>'status') <> 'suspended' then
    raise exception 'account not in suspended state';
  end if;

  -- Pull the most recent suspend audit row for this account so we know
  -- which orgs to unflip. Orgs suspended for other reasons stay so.
  select al.new_value into v_last_suspend
    from admin.admin_audit_log al
   where al.action        = 'suspend_account'
     and al.target_table  = 'public.accounts'
     and al.target_id     = p_account_id
   order by al.occurred_at desc
   limit 1;

  if v_last_suspend is not null and v_last_suspend ? 'flipped_org_ids' then
    select array(select jsonb_array_elements_text(v_last_suspend->'flipped_org_ids'))::uuid[]
      into v_ids;
  else
    v_ids := '{}'::uuid[];
  end if;

  update public.organisations
     set status = 'active',
         updated_at = now()
   where id = any(v_ids)
     and status = 'suspended';

  update public.accounts
     set status = 'active',
         updated_at = now()
   where id = p_account_id;

  insert into admin.admin_audit_log
    (admin_user_id, action, target_table, target_id, org_id, old_value, new_value, reason)
  values
    (v_operator, 'restore_account', 'public.accounts', p_account_id, null,
     v_old_acct,
     jsonb_build_object(
       'status', 'active',
       'restored_org_ids', to_jsonb(v_ids)
     ),
     p_reason);

  return jsonb_build_object(
    'account_id',         p_account_id,
    'restored_org_count', coalesce(array_length(v_ids, 1), 0)
  );
end;
$$;

grant execute on function admin.restore_account(uuid, text) to cs_admin;

-- Verification:
--   select proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--    where n.nspname = 'admin' and proname like 'account%' or proname like '%account%';
--    → accounts_list, account_detail, suspend_account, restore_account (+ existing)
