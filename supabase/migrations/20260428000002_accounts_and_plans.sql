-- ADR-0044 Phase 0 — Accounts layer + billing relocation.
--
-- Introduces the account layer above organisations. Billing identity
-- (Razorpay customer, subscription, plan, trial) moves from
-- organisations to accounts. Every existing org is re-parented under
-- a solo-account during backfill (pre-beta; zero customer coordination
-- required).
--
-- Does NOT touch the membership model (organisation_members → rename
-- to org_memberships happens in Phase 1 alongside the new role values
-- and account_memberships table).
--
-- Does NOT touch public.refunds or public.plan_adjustments. Those are
-- org-level transactional ledger rows; billing relocation only affects
-- subscription identity + plan columns on organisations. The 2 ADR-0034
-- RPCs that reference the relocated columns (org_effective_plan,
-- billing_payment_failures_list) are rewritten here to read from accounts.
--
-- RPCs rewritten:
--   public.rpc_razorpay_apply_subscription  (Razorpay webhook core)
--   public.rpc_plan_limit_check             (web-property gate)
--   public.org_effective_plan               (ADR-0034 canonical plan resolver)
--   admin.extend_trial                      (admin action — now extends accounts.trial_ends_at)
--   admin.billing_payment_failures_list     (ADR-0034 admin tab)
--
-- Design notes:
-- 1. current_account_id() is derived from current_org_id() for v1
--    (one-account-per-user). Multi-account-per-user (v2) will add a
--    proxy cookie and switch the function body; the signature is stable.
-- 2. organisations.status defaults to 'active' and is what the Worker
--    consults via admin_config_snapshot → suspended_org_ids to serve a
--    no-op banner for plan-suspended orgs. ADR-0044 Phase 4 wires the
--    downgrade path that flips the status.
-- 3. plans is a first-class table so operators can tune limits without
--    a code deploy.

-- ═══════════════════════════════════════════════════════════
-- 1/10 · public.plans — catalogue + seed
-- ═══════════════════════════════════════════════════════════

create table if not exists public.plans (
  plan_code                    text         primary key,
  display_name                 text         not null,
  max_organisations            int          not null check (max_organisations >= 1),
  max_web_properties_per_org   int          not null check (max_web_properties_per_org >= 1),
  base_price_inr               int,
  razorpay_plan_id             text,
  trial_days                   int          not null default 0 check (trial_days >= 0),
  is_active                    boolean      not null default true,
  created_at                   timestamptz  not null default now()
);

alter table public.plans enable row level security;

drop policy if exists plans_read on public.plans;
create policy plans_read on public.plans
  for select to authenticated, anon
  using (is_active = true);

drop policy if exists plans_admin_read_all on public.plans;
create policy plans_admin_read_all on public.plans
  for select to authenticated
  using ((auth.jwt() -> 'app_metadata' ->> 'is_admin')::boolean = true);

revoke insert, update, delete on public.plans from authenticated, anon;

insert into public.plans (plan_code, display_name, max_organisations, max_web_properties_per_org, base_price_inr, trial_days, is_active) values
  ('trial_starter', 'Trial (Starter limits)', 1,  1,     0,  30, true),
  ('starter',       'Starter',                1,  2,   999,   0, true),
  ('growth',        'Growth',                 3,  5,  2999,   0, true),
  ('pro',           'Pro',                   10, 10,  7999,   0, true),
  ('enterprise',    'Enterprise',            50, 25,  null,   0, true)
on conflict (plan_code) do nothing;

-- ═══════════════════════════════════════════════════════════
-- 2/10 · public.accounts — subscription + plan + billing identity
-- ═══════════════════════════════════════════════════════════

create table if not exists public.accounts (
  id                         uuid         primary key default gen_random_uuid(),
  name                       text         not null,
  plan_code                  text         not null references public.plans(plan_code),
  status                     text         not null default 'active'
                               check (status in ('trial','active','past_due','suspended','cancelled')),
  razorpay_customer_id       text         unique,
  razorpay_subscription_id   text         unique,
  trial_ends_at              timestamptz,
  current_period_ends_at     timestamptz,
  created_at                 timestamptz  not null default now(),
  updated_at                 timestamptz  not null default now()
);

create index if not exists accounts_plan_idx on public.accounts (plan_code);
create index if not exists accounts_status_idx on public.accounts (status);

alter table public.accounts enable row level security;

revoke insert, update, delete on public.accounts from authenticated, anon;
grant select, insert, update on public.accounts to cs_orchestrator;

-- Policy created further down once organisations.account_id exists.

-- ═══════════════════════════════════════════════════════════
-- 3/10 · organisations — add account_id + extend status check
-- ═══════════════════════════════════════════════════════════
-- organisations.status already exists (ADR-0027 Sprint 3.1 added it with
-- check (status in ('active','suspended','archived'))). Extend the
-- allowed set so plan-triggered suspensions have their own state
-- distinct from operator-initiated suspensions.

alter table public.organisations
  add column if not exists account_id uuid references public.accounts(id) on delete restrict;

create index if not exists organisations_account_idx on public.organisations (account_id);

-- Rename-in-place the existing status check so `suspended_by_plan` is allowed.
alter table public.organisations
  drop constraint if exists organisations_status_check;

alter table public.organisations
  add constraint organisations_status_check
  check (status in ('active','suspended','suspended_by_plan','archived'));

-- Now that organisations.account_id exists, install the accounts read policy.
drop policy if exists accounts_read_by_membership on public.accounts;
create policy accounts_read_by_membership on public.accounts
  for select to authenticated
  using (
    exists (
      select 1 from public.organisations o
      join public.organisation_members m on m.org_id = o.id
       where o.account_id = accounts.id
         and m.user_id = auth.uid()
    )
    or (auth.jwt() -> 'app_metadata' ->> 'is_admin')::boolean = true
  );

-- ═══════════════════════════════════════════════════════════
-- 4/10 · Backfill — one solo-account per existing org
-- ═══════════════════════════════════════════════════════════

do $$
declare
  r record;
  v_plan_code text;
  v_status text;
  v_account_id uuid;
begin
  for r in
    select id, name, plan, plan_started_at, trial_ends_at,
           razorpay_subscription_id, razorpay_customer_id
      from public.organisations
     where account_id is null
  loop
    v_plan_code := case r.plan
      when 'trial' then 'trial_starter'
      when 'starter' then 'starter'
      when 'growth' then 'growth'
      when 'pro' then 'pro'
      when 'enterprise' then 'enterprise'
      else 'starter'
    end;

    v_status := case
      when r.plan = 'trial' then 'trial'
      else 'active'
    end;

    insert into public.accounts
      (name, plan_code, status, razorpay_customer_id,
       razorpay_subscription_id, trial_ends_at, created_at)
    values
      (r.name, v_plan_code, v_status, r.razorpay_customer_id,
       r.razorpay_subscription_id, r.trial_ends_at,
       coalesce(r.plan_started_at, now()))
    returning id into v_account_id;

    update public.organisations set account_id = v_account_id where id = r.id;
  end loop;
end $$;

alter table public.organisations
  alter column account_id set not null;

-- ═══════════════════════════════════════════════════════════
-- 5/10 · Rewrite RPCs to read from accounts (before drop)
-- ═══════════════════════════════════════════════════════════

-- 5a · rpc_razorpay_apply_subscription — webhook core.
create or replace function public.rpc_razorpay_apply_subscription(
  p_event text,
  p_subscription_id text,
  p_cs_plan text,
  p_org_id_hint uuid,
  p_payment_id text
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_account_id uuid;
  v_org_id uuid;
begin
  -- Resolve account via subscription id first (the Razorpay-native path).
  select a.id into v_account_id
    from public.accounts a
   where a.razorpay_subscription_id = p_subscription_id;

  -- Fallback to p_org_id_hint → accounts via organisations.account_id
  -- (useful during onboarding before razorpay_subscription_id is stored).
  if v_account_id is null and p_org_id_hint is not null then
    select o.account_id into v_account_id
      from public.organisations o
     where o.id = p_org_id_hint;
    v_org_id := p_org_id_hint;
  end if;

  if v_account_id is null then
    return jsonb_build_object('ok', false, 'error', 'account_not_found');
  end if;

  -- Any org under the account will do for audit-log org_id (accounts
  -- have at least 1 org due to account-creation invariants, enforced
  -- at signup flow).
  if v_org_id is null then
    select id into v_org_id from public.organisations
     where account_id = v_account_id order by created_at asc limit 1;
  end if;

  case p_event
    when 'subscription.activated', 'subscription.charged', 'subscription.resumed' then
      if p_cs_plan is not null then
        update public.accounts set
          plan_code = p_cs_plan,
          status = 'active',
          razorpay_subscription_id = p_subscription_id,
          updated_at = now()
        where id = v_account_id;
      end if;
      insert into public.audit_log (org_id, event_type, entity_type, entity_id, payload)
        values (
          v_org_id, 'plan_activated', 'account', v_account_id,
          jsonb_build_object('plan', p_cs_plan, 'subscription_id', p_subscription_id)
        );
    when 'subscription.cancelled', 'subscription.paused' then
      update public.accounts set plan_code = 'trial_starter', status = 'cancelled',
             updated_at = now()
       where id = v_account_id;
      insert into public.audit_log (org_id, event_type, entity_type, entity_id, payload)
        values (
          v_org_id, 'plan_downgraded', 'account', v_account_id,
          jsonb_build_object('reason', p_event, 'subscription_id', p_subscription_id)
        );
    when 'payment.failed' then
      insert into public.audit_log (org_id, event_type, entity_type, entity_id, payload)
        values (
          v_org_id, 'payment_failed', 'account', v_account_id,
          jsonb_build_object('subscription_id', p_subscription_id, 'payment_id', p_payment_id)
        );
    else
      null;
  end case;

  return jsonb_build_object('ok', true, 'account_id', v_account_id, 'org_id', v_org_id);
end;
$$;

-- 5b · rpc_plan_limit_check — read plan from accounts, limits from plans table.
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
  v_uid uuid := auth.uid();
  v_plan_code text;
  v_current int;
  v_limit int;
begin
  if v_uid is null then
    raise exception 'unauthenticated' using errcode = '28000';
  end if;

  if not exists (
    select 1 from public.organisation_members where user_id = v_uid and org_id = p_org_id
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
    -- Connector cap stays generous; no plans.max_connectors yet.
    v_limit := null;
  else
    raise exception 'unknown resource %', p_resource using errcode = '22023';
  end if;

  return jsonb_build_object('plan', v_plan_code, 'current', v_current, 'limit', v_limit);
end;
$$;

-- 5c · admin.extend_trial — now extends accounts.trial_ends_at via org's account.
create or replace function admin.extend_trial(
  p_org_id uuid, p_new_trial_end timestamptz, p_reason text
) returns void
language plpgsql security definer set search_path = admin, public
as $$
declare
  v_admin uuid := auth.uid();
  v_account_id uuid;
  v_old jsonb;
begin
  perform admin.require_admin('support');
  if length(p_reason) < 10 then raise exception 'reason required (≥10 chars)'; end if;
  if p_new_trial_end <= now() then raise exception 'trial_ends_at must be in the future'; end if;

  select o.account_id into v_account_id from public.organisations o where id = p_org_id;
  if v_account_id is null then raise exception 'org not found'; end if;

  select to_jsonb(a.*) into v_old from public.accounts a where id = v_account_id;

  insert into admin.admin_audit_log
    (admin_user_id, action, target_table, target_id, org_id, old_value, new_value, reason)
  values
    (v_admin, 'extend_trial', 'public.accounts', v_account_id, p_org_id,
     v_old, v_old || jsonb_build_object('trial_ends_at', p_new_trial_end), p_reason);

  update public.accounts
     set trial_ends_at = p_new_trial_end, updated_at = now()
   where id = v_account_id;
end;
$$;

-- 5d · public.org_effective_plan — canonical resolver, now reads from accounts.
create or replace function public.org_effective_plan(p_org_id uuid)
returns text
language sql
stable
security definer
set search_path = public, pg_catalog
as $$
  with active_adj as (
    select kind, plan
      from public.plan_adjustments
     where org_id = p_org_id
       and revoked_at is null
       and (expires_at is null or expires_at > now())
  )
  select coalesce(
    (select plan from active_adj where kind = 'override' limit 1),
    (select plan from active_adj where kind = 'comp'     limit 1),
    (select a.plan_code from public.accounts a
       join public.organisations o on o.account_id = a.id
      where o.id = p_org_id limit 1)
  );
$$;

-- 5e · rpc_signup_bootstrap_org — create account + org in one txn.
--
-- Until ADR-0044 Phase 2 lands the invite-gated signup, this fallback
-- path still creates a brand-new account (plan_code='trial_starter') +
-- first org + membership when a signup carries org_name metadata.
-- Phase 2 will deprecate this helper in favour of accept_invitation().
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
  v_account_id uuid;
begin
  if v_uid is null then
    raise exception 'unauthenticated' using errcode = '28000';
  end if;

  -- New: create the account first (solo-tenant shape — one account per
  -- org until ADR-0044 Phase 2 introduces invite-driven accounts).
  insert into public.accounts (name, plan_code, status, trial_ends_at)
  values (p_org_name, 'trial_starter', 'trial', now() + interval '30 days')
  returning id into v_account_id;

  insert into public.organisations (name, industry, account_id)
    values (p_org_name, p_industry, v_account_id)
    returning id into v_org_id;

  insert into public.organisation_members (org_id, user_id, role)
    values (v_org_id, v_uid, 'admin');

  insert into public.audit_log (org_id, actor_id, event_type, entity_type, entity_id)
    values (v_org_id, v_uid, 'org_created', 'organisation', v_org_id);

  return jsonb_build_object(
    'ok', true, 'org_id', v_org_id, 'account_id', v_account_id, 'name', p_org_name
  );
end;
$$;

-- 5f · admin.billing_payment_failures_list — join accounts for plan.
create or replace function admin.billing_payment_failures_list(
  p_window_days int default 7
)
returns table (
  org_id                    uuid,
  org_name                  text,
  plan                      text,
  effective_plan            text,
  razorpay_subscription_id  text,
  last_failed_at            timestamptz,
  retries                   bigint,
  last_payment_id           text
)
language plpgsql
security definer
set search_path = public, admin, pg_catalog
as $$
begin
  perform admin.require_admin('support');

  if p_window_days is null or p_window_days < 1 or p_window_days > 90 then
    raise exception 'p_window_days must be between 1 and 90';
  end if;

  return query
  with failures as (
    select al.org_id,
           al.created_at,
           al.payload
      from public.audit_log al
     where al.event_type = 'payment_failed'
       and al.created_at >= now() - (p_window_days || ' days')::interval
  ),
  per_org as (
    select f.org_id,
           max(f.created_at) as last_failed_at,
           count(*)          as retries,
           (array_agg(f.payload->>'payment_id' order by f.created_at desc))[1]      as last_payment_id,
           (array_agg(f.payload->>'subscription_id' order by f.created_at desc))[1] as razorpay_subscription_id
      from failures f
     group by f.org_id
  )
  select po.org_id,
         coalesce(o.name, '(deleted)')           as org_name,
         a.plan_code                             as plan,
         public.org_effective_plan(po.org_id)    as effective_plan,
         po.razorpay_subscription_id,
         po.last_failed_at,
         po.retries,
         po.last_payment_id
    from per_org po
    left join public.organisations o on o.id = po.org_id
    left join public.accounts      a on a.id = o.account_id
   order by po.last_failed_at desc;
end;
$$;

-- ═══════════════════════════════════════════════════════════
-- 6/10 · Swap cs_orchestrator grants: orgs → accounts
-- ═══════════════════════════════════════════════════════════

revoke update (plan, plan_started_at, razorpay_subscription_id, razorpay_customer_id)
  on public.organisations from cs_orchestrator;

-- cs_orchestrator already has select/insert/update on accounts via step 2.

-- ═══════════════════════════════════════════════════════════
-- 7/10 · Drop relocated columns from organisations
-- ═══════════════════════════════════════════════════════════

alter table public.organisations
  drop column if exists plan,
  drop column if exists plan_started_at,
  drop column if exists trial_ends_at,
  drop column if exists razorpay_subscription_id,
  drop column if exists razorpay_customer_id;

-- ═══════════════════════════════════════════════════════════
-- 8/10 · current_account_id() helper (v1: derives from org)
-- ═══════════════════════════════════════════════════════════

create or replace function public.current_account_id()
returns uuid
language sql
stable
security definer
set search_path = public, pg_catalog
as $$
  select o.account_id
    from public.organisations o
   where o.id = public.current_org_id()
   limit 1
$$;

grant execute on function public.current_account_id() to authenticated, anon;

comment on function public.current_account_id() is
  'ADR-0044 Phase 0. Returns the account_id for the caller''s current '
  'org. v1 derives from current_org_id(); v2 will read from a proxy '
  'cookie once multi-account-per-user lands.';

-- ═══════════════════════════════════════════════════════════
-- 9/10 · current_plan() helper — one-stop reader for the dashboard
-- ═══════════════════════════════════════════════════════════

create or replace function public.current_plan()
returns table (
  plan_code text,
  display_name text,
  max_organisations int,
  max_web_properties_per_org int,
  trial_ends_at timestamptz,
  status text
)
language sql
stable
security definer
set search_path = public, pg_catalog
as $$
  select p.plan_code, p.display_name, p.max_organisations,
         p.max_web_properties_per_org, a.trial_ends_at, a.status
    from public.accounts a
    join public.plans p on p.plan_code = a.plan_code
   where a.id = public.current_account_id()
$$;

grant execute on function public.current_plan() to authenticated;

-- ═══════════════════════════════════════════════════════════
-- 10a · Extend admin_config_snapshot so suspended_by_plan orgs are
--       in suspended_org_ids (Worker serves no-op for both reasons).
-- ═══════════════════════════════════════════════════════════

create or replace function public.admin_config_snapshot()
returns jsonb
language sql
security definer
set search_path = admin, public
as $$
  select jsonb_build_object(
    'kill_switches',
      coalesce(
        (select jsonb_object_agg(switch_key, enabled)
           from admin.kill_switches),
        '{}'::jsonb
      ),
    'active_tracker_signatures',
      coalesce(
        (select jsonb_agg(jsonb_build_object(
            'signature_code', signature_code,
            'display_name', display_name,
            'vendor', vendor,
            'signature_type', signature_type,
            'pattern', pattern,
            'category', category,
            'severity', severity
          ))
           from admin.tracker_signature_catalogue
          where status = 'active'),
        '[]'::jsonb
      ),
    'published_sectoral_templates',
      coalesce(
        (select jsonb_agg(jsonb_build_object(
            'template_code', template_code,
            'display_name', display_name,
            'sector', sector,
            'version', version,
            'purpose_definitions', purpose_definitions
          ))
           from admin.sectoral_templates
          where status = 'published'),
        '[]'::jsonb
      ),
    'suspended_org_ids',
      coalesce(
        (select jsonb_agg(id) from public.organisations
          where status in ('suspended','suspended_by_plan')),
        '[]'::jsonb
      ),
    'blocked_ips',
      coalesce(
        (select jsonb_agg(ip_cidr::text)
           from public.blocked_ips
          where unblocked_at is null
            and (expires_at is null or expires_at > now())),
        '[]'::jsonb
      ),
    'refreshed_at', now()
  );
$$;

-- ═══════════════════════════════════════════════════════════
-- 10/10 · Verification
-- ═══════════════════════════════════════════════════════════
-- Run these after push to confirm:
--   select count(*) from public.plans; -- ≥ 5
--   select count(*) from public.accounts; -- = count(*) from organisations (backfill)
--   select count(*) from public.organisations where account_id is null; -- 0
--   select column_name from information_schema.columns
--     where table_schema='public' and table_name='organisations'
--       and column_name in ('razorpay_customer_id','razorpay_subscription_id','plan','plan_started_at','trial_ends_at');
--   -- → 0 rows
