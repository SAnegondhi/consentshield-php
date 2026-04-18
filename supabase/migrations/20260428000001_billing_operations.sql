-- ADR-0034 Sprint 1.1 — Billing Operations schema + admin RPCs.
--
-- Adds two public tables (refunds, plan_adjustments), six admin-scoped
-- RPCs backing the four tabs of the Billing Operations panel
-- (wireframe §8), and one canonical helper — public.org_effective_plan.
--
-- plan_adjustments collapses "comp accounts" and "plan overrides" into
-- one shape with a kind discriminator. The wireframe surfaces them on
-- two tabs because operator mental models differ; the underlying row is
-- identical.
--
-- Razorpay API calls (Retry charge · Issue refund) happen from the
-- admin Next.js app (Sprint 2.2). The DB layer records intent + ledger
-- only; no outbound HTTP from here.

-- ═══════════════════════════════════════════════════════════
-- Tables
-- ═══════════════════════════════════════════════════════════

-- public.refunds — ledger of refund intents + outcomes.
create table if not exists public.refunds (
  id                   uuid primary key default gen_random_uuid(),
  org_id               uuid not null references public.organisations(id) on delete cascade,
  razorpay_payment_id  text,
  razorpay_refund_id   text unique,
  amount_paise         bigint not null check (amount_paise > 0),
  reason               text not null,
  status               text not null default 'pending'
                         check (status in ('pending','issued','failed','cancelled')),
  failure_reason       text,
  requested_by         uuid not null,
  issued_at            timestamptz,
  created_at           timestamptz not null default now()
);

create index if not exists refunds_org_created_idx
  on public.refunds (org_id, created_at desc);

create index if not exists refunds_status_idx
  on public.refunds (status)
  where status in ('pending','failed');

alter table public.refunds enable row level security;

-- RLS: read via admin SECURITY DEFINER RPCs only. Nothing customer-facing.
drop policy if exists refunds_admin_select on public.refunds;
create policy refunds_admin_select on public.refunds
  for select to cs_admin using (true);

revoke insert, update, delete on public.refunds from authenticated;

-- public.plan_adjustments — unified comp + override grants.
create table if not exists public.plan_adjustments (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references public.organisations(id) on delete cascade,
  kind         text not null check (kind in ('comp','override')),
  plan         text not null check (plan in ('trial','starter','growth','pro','enterprise')),
  starts_at    timestamptz not null default now(),
  expires_at   timestamptz,
  reason       text not null,
  granted_by   uuid not null,
  created_at   timestamptz not null default now(),
  revoked_at   timestamptz,
  revoked_by   uuid
);

-- At most one unrevoked (org, kind) row at a time. Expiry filtering is
-- deliberately NOT in the predicate — PG requires IMMUTABLE functions in
-- partial-index predicates and now() is STABLE. Keeping expired-but-not-
-- revoked rows unique-insert-blocked is fine: the upsert RPC revokes
-- before inserting, and list RPCs filter expired rows on read.
create unique index if not exists plan_adjustments_unrevoked_uniq
  on public.plan_adjustments (org_id, kind)
  where revoked_at is null;

create index if not exists plan_adjustments_org_idx
  on public.plan_adjustments (org_id, kind, created_at desc);

alter table public.plan_adjustments enable row level security;

drop policy if exists plan_adjustments_admin_select on public.plan_adjustments;
create policy plan_adjustments_admin_select on public.plan_adjustments
  for select to cs_admin using (true);

revoke insert, update, delete on public.plan_adjustments from authenticated;

-- ═══════════════════════════════════════════════════════════
-- public.org_effective_plan — canonical resolution.
-- Override wins over Comp wins over organisations.plan. Active only.
-- Granted to authenticated / cs_orchestrator / cs_admin because feature-
-- gate code will migrate to this as it's touched.
-- ═══════════════════════════════════════════════════════════
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
    (select plan from public.organisations where id = p_org_id)
  );
$$;

comment on function public.org_effective_plan(uuid) is
  'ADR-0034 Sprint 1.1. Canonical effective-plan resolution: active override '
  '> active comp > organisations.plan. Callers that need the real plan switch '
  'to this function; organisations.plan alone is no longer the single source '
  'of truth.';

grant execute on function public.org_effective_plan(uuid)
  to authenticated, cs_orchestrator, cs_admin;

-- ═══════════════════════════════════════════════════════════
-- 1/6 · admin.billing_payment_failures_list
-- Recent payment_failed audit rows, ranked by retries in-window.
-- ═══════════════════════════════════════════════════════════
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
         o.plan,
         public.org_effective_plan(po.org_id)    as effective_plan,
         po.razorpay_subscription_id,
         po.last_failed_at,
         po.retries,
         po.last_payment_id
    from per_org po
    left join public.organisations o on o.id = po.org_id
   order by po.last_failed_at desc;
end;
$$;

comment on function admin.billing_payment_failures_list(int) is
  'ADR-0034 Sprint 1.1. Admin Billing — Payment failures tab. Aggregates '
  'audit_log rows where event_type=''payment_failed'' over the last '
  'p_window_days (clamped [1,90]). Retry-count is per-org.';

grant execute on function admin.billing_payment_failures_list(int) to cs_admin;

-- ═══════════════════════════════════════════════════════════
-- 2/6 · admin.billing_refunds_list
-- ═══════════════════════════════════════════════════════════
create or replace function admin.billing_refunds_list(
  p_limit int default 50
)
returns table (
  id                   uuid,
  org_id               uuid,
  org_name             text,
  razorpay_payment_id  text,
  razorpay_refund_id   text,
  amount_paise         bigint,
  reason               text,
  status               text,
  failure_reason       text,
  requested_by         uuid,
  issued_at            timestamptz,
  created_at           timestamptz
)
language plpgsql
security definer
set search_path = public, admin, pg_catalog
as $$
begin
  perform admin.require_admin('support');

  if p_limit is null or p_limit < 1 or p_limit > 500 then
    raise exception 'p_limit must be between 1 and 500';
  end if;

  return query
  select r.id, r.org_id,
         coalesce(o.name, '(deleted)') as org_name,
         r.razorpay_payment_id, r.razorpay_refund_id,
         r.amount_paise, r.reason, r.status, r.failure_reason,
         r.requested_by, r.issued_at, r.created_at
    from public.refunds r
    left join public.organisations o on o.id = r.org_id
   order by r.created_at desc
   limit p_limit;
end;
$$;

grant execute on function admin.billing_refunds_list(int) to cs_admin;

-- ═══════════════════════════════════════════════════════════
-- 3/6 · admin.billing_create_refund
-- Writes a pending refund row + audit row. Razorpay round-trip is done
-- by the admin app in Sprint 2.2; it updates the row to issued/failed.
-- ═══════════════════════════════════════════════════════════
create or replace function admin.billing_create_refund(
  p_org_id              uuid,
  p_razorpay_payment_id text,
  p_amount_paise        bigint,
  p_reason              text
)
returns uuid
language plpgsql
security definer
set search_path = public, admin, pg_catalog
as $$
declare
  v_admin uuid := auth.uid();
  v_id    uuid;
begin
  perform admin.require_admin('support');
  if length(p_reason) < 10 then
    raise exception 'reason required (≥10 chars)';
  end if;
  if p_amount_paise is null or p_amount_paise <= 0 then
    raise exception 'amount_paise must be > 0';
  end if;
  if not exists (select 1 from public.organisations where id = p_org_id) then
    raise exception 'org not found';
  end if;

  insert into public.refunds
    (org_id, razorpay_payment_id, amount_paise, reason, status, requested_by)
  values
    (p_org_id, p_razorpay_payment_id, p_amount_paise, p_reason, 'pending', v_admin)
  returning id into v_id;

  insert into admin.admin_audit_log
    (admin_user_id, action, target_table, target_id, org_id, old_value, new_value, reason)
  values
    (v_admin, 'billing_create_refund', 'public.refunds', v_id, p_org_id,
     null,
     jsonb_build_object(
       'org_id', p_org_id,
       'razorpay_payment_id', p_razorpay_payment_id,
       'amount_paise', p_amount_paise,
       'status', 'pending'
     ),
     p_reason);

  return v_id;
end;
$$;

grant execute on function admin.billing_create_refund(uuid, text, bigint, text) to cs_admin;

-- ═══════════════════════════════════════════════════════════
-- 4/6 · admin.billing_plan_adjustments_list
-- p_kind = 'comp' | 'override' | null (both). Active rows only.
-- ═══════════════════════════════════════════════════════════
create or replace function admin.billing_plan_adjustments_list(
  p_kind text default null
)
returns table (
  id         uuid,
  org_id     uuid,
  org_name   text,
  kind       text,
  plan       text,
  starts_at  timestamptz,
  expires_at timestamptz,
  reason     text,
  granted_by uuid,
  created_at timestamptz
)
language plpgsql
security definer
set search_path = public, admin, pg_catalog
as $$
begin
  perform admin.require_admin('support');

  if p_kind is not null and p_kind not in ('comp','override') then
    raise exception 'p_kind must be ''comp'', ''override'', or null';
  end if;

  return query
  select pa.id, pa.org_id,
         coalesce(o.name, '(deleted)') as org_name,
         pa.kind, pa.plan, pa.starts_at, pa.expires_at,
         pa.reason, pa.granted_by, pa.created_at
    from public.plan_adjustments pa
    left join public.organisations o on o.id = pa.org_id
   where pa.revoked_at is null
     and (pa.expires_at is null or pa.expires_at > now())
     and (p_kind is null or pa.kind = p_kind)
   order by pa.created_at desc;
end;
$$;

grant execute on function admin.billing_plan_adjustments_list(text) to cs_admin;

-- ═══════════════════════════════════════════════════════════
-- 5/6 · admin.billing_upsert_plan_adjustment
-- Revokes any active (org, kind) row in-txn, then inserts the new one.
-- platform_operator only.
-- ═══════════════════════════════════════════════════════════
create or replace function admin.billing_upsert_plan_adjustment(
  p_org_id     uuid,
  p_kind       text,
  p_plan       text,
  p_expires_at timestamptz,
  p_reason     text
)
returns uuid
language plpgsql
security definer
set search_path = public, admin, pg_catalog
as $$
declare
  v_admin uuid := auth.uid();
  v_id    uuid;
  v_prev  uuid;
begin
  perform admin.require_admin('platform_operator');
  if p_kind not in ('comp','override') then
    raise exception 'p_kind must be ''comp'' or ''override''';
  end if;
  if p_plan not in ('trial','starter','growth','pro','enterprise') then
    raise exception 'p_plan must be a known plan code';
  end if;
  if length(p_reason) < 10 then
    raise exception 'reason required (≥10 chars)';
  end if;
  if not exists (select 1 from public.organisations where id = p_org_id) then
    raise exception 'org not found';
  end if;

  -- Revoke any active row of the same (org, kind).
  update public.plan_adjustments
     set revoked_at = now(),
         revoked_by = v_admin
   where org_id = p_org_id
     and kind   = p_kind
     and revoked_at is null
     and (expires_at is null or expires_at > now())
  returning id into v_prev;

  insert into public.plan_adjustments
    (org_id, kind, plan, expires_at, reason, granted_by)
  values
    (p_org_id, p_kind, p_plan, p_expires_at, p_reason, v_admin)
  returning id into v_id;

  insert into admin.admin_audit_log
    (admin_user_id, action, target_table, target_id, org_id, old_value, new_value, reason)
  values
    (v_admin, 'billing_upsert_plan_adjustment', 'public.plan_adjustments', v_id, p_org_id,
     case when v_prev is null then null
          else jsonb_build_object('revoked_id', v_prev) end,
     jsonb_build_object(
       'kind', p_kind, 'plan', p_plan, 'expires_at', p_expires_at
     ),
     p_reason);

  return v_id;
end;
$$;

grant execute on function admin.billing_upsert_plan_adjustment(uuid, text, text, timestamptz, text) to cs_admin;

-- ═══════════════════════════════════════════════════════════
-- 6/6 · admin.billing_revoke_plan_adjustment
-- ═══════════════════════════════════════════════════════════
create or replace function admin.billing_revoke_plan_adjustment(
  p_adjustment_id uuid,
  p_reason        text
)
returns void
language plpgsql
security definer
set search_path = public, admin, pg_catalog
as $$
declare
  v_admin uuid := auth.uid();
  v_row   public.plan_adjustments%rowtype;
begin
  perform admin.require_admin('platform_operator');
  if length(p_reason) < 10 then
    raise exception 'reason required (≥10 chars)';
  end if;

  select * into v_row from public.plan_adjustments where id = p_adjustment_id;
  if v_row.id is null then
    raise exception 'plan adjustment not found';
  end if;
  if v_row.revoked_at is not null then
    raise exception 'already revoked';
  end if;

  update public.plan_adjustments
     set revoked_at = now(),
         revoked_by = v_admin
   where id = p_adjustment_id;

  insert into admin.admin_audit_log
    (admin_user_id, action, target_table, target_id, org_id, old_value, new_value, reason)
  values
    (v_admin, 'billing_revoke_plan_adjustment', 'public.plan_adjustments',
     p_adjustment_id, v_row.org_id,
     jsonb_build_object('kind', v_row.kind, 'plan', v_row.plan, 'expires_at', v_row.expires_at),
     jsonb_build_object('revoked_at', now()),
     p_reason);
end;
$$;

grant execute on function admin.billing_revoke_plan_adjustment(uuid, text) to cs_admin;

-- Verification:
--   select proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--    where n.nspname = 'admin' and proname like 'billing_%';
--    → 6 rows.
--
--   select proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--    where n.nspname = 'public' and proname = 'org_effective_plan'; → 1 row.
--
--   select relname from pg_class c join pg_namespace n on n.oid=c.relnamespace
--    where n.nspname='public' and relname in ('refunds','plan_adjustments'); → 2 rows.
