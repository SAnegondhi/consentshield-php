-- ADR-0033 Phase 2 — Abuse & Security schema + RPCs.
--
-- Ships:
--   * public.blocked_ips table + partial-unique index + RLS.
--   * 5 admin.security_* RPCs powering the /security panel tabs.
--
-- Worker-side enforcement of blocked_ips is deferred to Sprint 2.3 —
-- this migration only lands the data + admin surface. A companion
-- Edge Function + pg_cron can be wired later to sync the active list
-- to Cloudflare KV.
--
-- Data-source notes (discovered during scoping, documented in the ADR):
--
--   * `worker_errors.upstream_error` is the substring source for the
--     HMAC and Origin tabs. Today the Worker returns 403 early on
--     HMAC/origin failure without logging to worker_errors — those
--     filters therefore return empty. UI empty-states explain this.
--   * Rate-limit events are not persisted anywhere (Upstash Redis,
--     stateless). admin.security_rate_limit_triggers returns an empty
--     result set; ingestion path is a V2-S2 follow-up.
--
-- Rule 22: security_block_ip and security_unblock_ip insert an audit
-- row in the same transaction as the mutation.

-- ═══════════════════════════════════════════════════════════
-- public.blocked_ips — operator-managed global block list
-- ═══════════════════════════════════════════════════════════
create table if not exists public.blocked_ips (
  id            uuid        primary key default gen_random_uuid(),
  ip_cidr       cidr        not null,
  reason        text        not null check (length(reason) >= 10),
  blocked_by    uuid        not null references admin.admin_users(id),
  blocked_at    timestamptz not null default now(),
  expires_at    timestamptz,
  unblocked_at  timestamptz,
  unblocked_by  uuid        references admin.admin_users(id)
);

-- Same CIDR cannot be actively blocked twice; old (unblocked) rows
-- remain for audit history.
create unique index if not exists blocked_ips_active_cidr_uniq
  on public.blocked_ips (ip_cidr)
  where unblocked_at is null;

create index if not exists blocked_ips_active_idx
  on public.blocked_ips (blocked_at desc)
  where unblocked_at is null;

alter table public.blocked_ips enable row level security;

-- Admins read directly (e.g. via Supabase console). Non-admin
-- authenticated callers cannot see the table.
drop policy if exists blocked_ips_admin_select on public.blocked_ips;
create policy blocked_ips_admin_select on public.blocked_ips
  for select to authenticated
  using ((auth.jwt() -> 'app_metadata' ->> 'is_admin')::boolean = true);

-- No write policy — mutations flow through SECURITY DEFINER RPCs.
revoke insert, update, delete on public.blocked_ips from authenticated;

-- ═══════════════════════════════════════════════════════════
-- 1/5 · admin.security_worker_reasons_list
-- Parametric wrapper over worker_errors — HMAC / Origin tabs call
-- with a substring prefix.
-- ═══════════════════════════════════════════════════════════
create or replace function admin.security_worker_reasons_list(
  p_reason_prefix text,
  p_window_hours int default 24,
  p_limit int default 100
)
returns table (
  id uuid,
  occurred_at timestamptz,
  endpoint text,
  status_code int,
  upstream_error text,
  org_id uuid,
  org_name text,
  property_id uuid
)
language plpgsql security definer set search_path = public, admin, pg_catalog
as $$
begin
  perform admin.require_admin('support');
  if p_window_hours is null or p_window_hours < 1 or p_window_hours > 168 then
    raise exception 'p_window_hours must be between 1 and 168';
  end if;
  if p_limit is null or p_limit < 1 or p_limit > 1000 then
    raise exception 'p_limit must be between 1 and 1000';
  end if;

  return query
  select w.id,
         w.created_at as occurred_at,
         w.endpoint,
         w.status_code,
         w.upstream_error,
         w.org_id,
         coalesce(o.name, '(deleted)') as org_name,
         w.property_id
    from public.worker_errors w
    left join public.organisations o on o.id = w.org_id
   where w.created_at >= now() - (p_window_hours || ' hours')::interval
     and w.upstream_error ilike ('%' || p_reason_prefix || '%')
   order by w.created_at desc
   limit p_limit;
end;
$$;

comment on function admin.security_worker_reasons_list(text, int, int) is
  'ADR-0033 Sprint 2.1. Admin Security — wrapper for HMAC and Origin '
  'failure tabs. Filters worker_errors by ILIKE ''%prefix%'' on upstream_error.';

grant execute on function admin.security_worker_reasons_list(text, int, int) to cs_admin;

-- ═══════════════════════════════════════════════════════════
-- 2/5 · admin.security_rate_limit_triggers
-- Stub. Rate-limit hits are not persisted today (Upstash Redis,
-- stateless). Returns 0 rows. V2-S2 will add a public.rate_limit_events
-- ingestion path.
-- ═══════════════════════════════════════════════════════════
create or replace function admin.security_rate_limit_triggers(
  p_window_hours int default 24
)
returns table (
  occurred_at timestamptz,
  endpoint text,
  ip text,
  org_id uuid,
  hit_count int
)
language plpgsql security definer set search_path = public, admin, pg_catalog
as $$
begin
  perform admin.require_admin('support');
  if p_window_hours is null or p_window_hours < 1 or p_window_hours > 168 then
    raise exception 'p_window_hours must be between 1 and 168';
  end if;
  return; -- ingestion pending (V2-S2)
end;
$$;

comment on function admin.security_rate_limit_triggers(int) is
  'ADR-0033 Sprint 2.1. Stub — rate-limit hits are not persisted. '
  'V2-S2 will add ingestion. Returns no rows today.';

grant execute on function admin.security_rate_limit_triggers(int) to cs_admin;

-- ═══════════════════════════════════════════════════════════
-- 3/5 · admin.security_blocked_ips_list
-- ═══════════════════════════════════════════════════════════
create or replace function admin.security_blocked_ips_list()
returns table (
  id uuid,
  ip_cidr cidr,
  reason text,
  blocked_by uuid,
  blocked_by_display_name text,
  blocked_at timestamptz,
  expires_at timestamptz
)
language plpgsql security definer set search_path = public, admin, pg_catalog
as $$
begin
  perform admin.require_admin('support');

  return query
  select b.id, b.ip_cidr, b.reason, b.blocked_by,
         au.display_name as blocked_by_display_name,
         b.blocked_at, b.expires_at
    from public.blocked_ips b
    left join admin.admin_users au on au.id = b.blocked_by
   where b.unblocked_at is null
   order by b.blocked_at desc;
end;
$$;

comment on function admin.security_blocked_ips_list() is
  'ADR-0033 Sprint 2.1. Active entries in public.blocked_ips with '
  'the blocker''s display name joined.';

grant execute on function admin.security_blocked_ips_list() to cs_admin;

-- ═══════════════════════════════════════════════════════════
-- 4/5 · admin.security_block_ip
-- ═══════════════════════════════════════════════════════════
create or replace function admin.security_block_ip(
  p_ip_cidr cidr,
  p_reason text,
  p_expires_at timestamptz default null
)
returns uuid
language plpgsql security definer set search_path = public, admin, pg_catalog
as $$
declare
  v_admin uuid := public.current_uid();
  v_id uuid;
begin
  perform admin.require_admin('platform_operator');
  if length(p_reason) < 10 then
    raise exception 'reason required (≥10 chars)';
  end if;

  insert into public.blocked_ips (ip_cidr, reason, blocked_by, expires_at)
  values (p_ip_cidr, p_reason, v_admin, p_expires_at)
  returning id into v_id;

  insert into admin.admin_audit_log
    (admin_user_id, action, target_table, target_id, target_pk, new_value, reason)
  values
    (v_admin, 'security_block_ip', 'public.blocked_ips', v_id, p_ip_cidr::text,
     jsonb_build_object(
       'ip_cidr', p_ip_cidr::text,
       'expires_at', p_expires_at
     ),
     p_reason);

  return v_id;
end;
$$;

comment on function admin.security_block_ip(cidr, text, timestamptz) is
  'ADR-0033 Sprint 2.1. platform_operator-only. Inserts into '
  'public.blocked_ips with audit-log row in the same transaction (Rule 22).';

grant execute on function admin.security_block_ip(cidr, text, timestamptz) to cs_admin;

-- ═══════════════════════════════════════════════════════════
-- 5/5 · admin.security_unblock_ip
-- ═══════════════════════════════════════════════════════════
create or replace function admin.security_unblock_ip(
  p_block_id uuid,
  p_reason text
)
returns void
language plpgsql security definer set search_path = public, admin, pg_catalog
as $$
declare
  v_admin uuid := public.current_uid();
  v_cidr cidr;
begin
  perform admin.require_admin('platform_operator');
  if length(p_reason) < 10 then
    raise exception 'reason required (≥10 chars)';
  end if;

  update public.blocked_ips
     set unblocked_at = now(),
         unblocked_by = v_admin
   where id = p_block_id
     and unblocked_at is null
  returning ip_cidr into v_cidr;

  if v_cidr is null then
    raise exception 'block not found or already unblocked';
  end if;

  insert into admin.admin_audit_log
    (admin_user_id, action, target_table, target_id, target_pk, new_value, reason)
  values
    (v_admin, 'security_unblock_ip', 'public.blocked_ips', p_block_id, v_cidr::text,
     jsonb_build_object('ip_cidr', v_cidr::text), p_reason);
end;
$$;

comment on function admin.security_unblock_ip(uuid, text) is
  'ADR-0033 Sprint 2.1. platform_operator-only. Sets unblocked_at on the '
  'row + audit-log in the same transaction. Idempotent — re-unblock raises.';

grant execute on function admin.security_unblock_ip(uuid, text) to cs_admin;

-- Verification:
--   select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
--     where n.nspname='admin' and proname like 'security_%'; → 5
--   select count(*) from pg_tables where schemaname='public' and tablename='blocked_ips'; → 1
--   select count(*) from pg_policies where schemaname='public' and tablename='blocked_ips'; → 1
