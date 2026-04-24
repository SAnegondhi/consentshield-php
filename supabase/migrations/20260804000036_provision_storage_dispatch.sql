-- ADR-1025 Phase 2 Sprint 2.1 — customer-storage auto-provisioning dispatch.
--
-- Wires the Next.js API route /api/internal/provision-storage into the
-- signup flow via an AFTER INSERT trigger on public.data_inventory that
-- fires net.http_post on the FIRST row per org. Pattern mirrors the
-- ADR-0044 invitation-dispatch migration (20260501000003): hybrid
-- trigger + 5-minute safety-net cron for orgs where the primary
-- dispatch failed.
--
-- Vault secrets (operator action, outside this migration):
--   select vault.create_secret(
--     '<STORAGE_PROVISION_SECRET from .env.local>',
--     'cs_provision_storage_secret'
--   );
--   select vault.create_secret(
--     '<https://app.consentshield.in/api/internal/provision-storage>',
--     'cs_provision_storage_url'
--   );
--
-- For dev (tunnel or localhost with net.http_post reachable):
--   select vault.create_secret(
--     'http://host.docker.internal:3000/api/internal/provision-storage',
--     'cs_provision_storage_url'
--   );
--
-- Idempotency guarantees (all three layers):
--   · Unique on public.export_configurations(org_id)
--   · provisionStorageForOrg() short-circuits on is_verified=true
--   · deriveBucketName() is deterministic — CF 409 → idempotent reuse
--
-- Therefore multiple dispatches for the same org (trigger + cron race,
-- admin retry, etc.) are safe. The cron safety-net is the reason we
-- don't need a separate "enqueue" table.

-- ═══════════════════════════════════════════════════════════
-- 1/4 · public.dispatch_provision_storage(p_org_id)
-- ═══════════════════════════════════════════════════════════
-- Fires net.http_post to the Next.js internal endpoint. Reads URL +
-- secret from Vault so no credentials live in source. Returns the
-- pg_net request id so triggers / cron can log it.

create or replace function public.dispatch_provision_storage(p_org_id uuid)
returns bigint
language plpgsql
security definer
set search_path = public, pg_catalog, extensions
as $$
declare
  v_url text;
  v_secret text;
  v_request_id bigint;
begin
  select decrypted_secret into v_url
    from vault.decrypted_secrets
   where name = 'cs_provision_storage_url'
   limit 1;

  select decrypted_secret into v_secret
    from vault.decrypted_secrets
   where name = 'cs_provision_storage_secret'
   limit 1;

  if v_url is null or v_secret is null then
    -- Missing Vault secret → soft failure; cron safety-net will retry
    -- once the operator configures them. Never raise from a trigger.
    return null;
  end if;

  select net.http_post(
    url     := v_url,
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || v_secret,
      'Content-Type',  'application/json'
    ),
    body    := jsonb_build_object('org_id', p_org_id)
  ) into v_request_id;

  return v_request_id;
end;
$$;

comment on function public.dispatch_provision_storage(uuid) is
  'ADR-1025 Phase 2 Sprint 2.1. Fires net.http_post to the Next.js '
  '/api/internal/provision-storage endpoint. Soft-fails if Vault '
  'secrets are absent (operator has not configured them yet). '
  'Idempotent — safe to re-invoke for the same org.';

revoke execute on function public.dispatch_provision_storage(uuid) from public;
grant  execute on function public.dispatch_provision_storage(uuid) to cs_orchestrator;

-- ═══════════════════════════════════════════════════════════
-- 2/4 · AFTER INSERT trigger on public.data_inventory
-- ═══════════════════════════════════════════════════════════
-- Fires dispatch_provision_storage ONLY on the first row per org
-- (checked by counting rows for this org_id AFTER the insert — count
-- = 1 means "this was the first"). Also gated on the absence of an
-- existing export_configurations row, so admin-triggered re-provisions
-- don't double-fire when they happen to insert a fresh inventory row.

create or replace function public.data_inventory_after_insert_provision()
returns trigger
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_inventory_count int;
  v_config_exists   boolean;
begin
  -- Fast-path guard: if this org already has an export_configurations
  -- row, do nothing. Covers re-provision flows + idempotency.
  select exists (
    select 1 from public.export_configurations
     where org_id = new.org_id
  ) into v_config_exists;
  if v_config_exists then
    return null;
  end if;

  -- First-row gate: count data_inventory rows for this org. If > 1,
  -- a previous row already attempted dispatch (or we're racing with
  -- another insert). Safety-net cron handles the rare miss.
  select count(*) into v_inventory_count
    from public.data_inventory
   where org_id = new.org_id;

  if v_inventory_count <> 1 then
    return null;
  end if;

  -- Best-effort dispatch — EXCEPTION WHEN OTHERS is load-bearing:
  -- a trigger error must not roll back the wizard's INSERT.
  begin
    perform public.dispatch_provision_storage(new.org_id);
  exception when others then
    null;
  end;

  return null; -- AFTER INSERT — return value ignored.
end;
$$;

comment on function public.data_inventory_after_insert_provision() is
  'ADR-1025 Phase 2 Sprint 2.1. Fires storage provisioning on the first '
  'data_inventory row per org. No-op for subsequent rows, for orgs '
  'that already have export_configurations, and on Vault-unconfigured '
  'environments. EXCEPTION swallow is load-bearing — trigger failure '
  'MUST NOT roll back the INSERT.';

drop trigger if exists data_inventory_dispatch_provision on public.data_inventory;

create trigger data_inventory_dispatch_provision
  after insert on public.data_inventory
  for each row
  execute function public.data_inventory_after_insert_provision();

-- ═══════════════════════════════════════════════════════════
-- 3/4 · pg_cron safety-net — every 5 minutes
-- ═══════════════════════════════════════════════════════════
-- Catches orgs that have data_inventory rows but no export_configurations
-- row 5+ minutes after the first inventory insert (implies the primary
-- trigger failed — Vault unconfigured, endpoint down, net.http_post
-- transient failure, etc.). Caps at 50 orgs per run.

do $$
begin
  perform cron.unschedule('provision-storage-retry');
  exception when others then null;
end $$;

select cron.schedule(
  'provision-storage-retry',
  '*/5 * * * *',
  $$
  select public.dispatch_provision_storage(di.org_id)
    from (
      select distinct org_id, min(created_at) as first_inventory_at
        from public.data_inventory
       group by org_id
    ) di
    left join public.export_configurations ec using (org_id)
   where ec.id is null
     and di.first_inventory_at < now() - interval '5 minutes'
     and di.first_inventory_at > now() - interval '24 hours'
   order by di.first_inventory_at asc
   limit 50;
  $$
);

-- ═══════════════════════════════════════════════════════════
-- 4/4 · admin.provision_customer_storage(p_org_id, p_reason)
-- ═══════════════════════════════════════════════════════════
-- Operator-driven re-provisioning. Audit-logged via admin.admin_audit_log.
-- Fires the same net.http_post as the trigger; the route's idempotency
-- guarantees (unique org_id + is_verified short-circuit) handle retries.

create or replace function admin.provision_customer_storage(
  p_org_id  uuid,
  p_reason  text
)
returns jsonb
language plpgsql
security definer
set search_path = public, admin, pg_catalog
as $$
declare
  v_admin      uuid := auth.uid();
  v_org        public.organisations%rowtype;
  v_request_id bigint;
begin
  perform admin.require_admin('support');

  if p_reason is null or length(p_reason) < 10 then
    raise exception 'reason must be at least 10 characters';
  end if;

  select * into v_org from public.organisations where id = p_org_id;
  if v_org.id is null then
    raise exception 'organisation not found';
  end if;

  -- Fire the HTTP call. The endpoint itself is idempotent; even if the
  -- bucket already exists + is_verified=true, it returns 'already_provisioned'
  -- which is a safe no-op.
  v_request_id := public.dispatch_provision_storage(p_org_id);

  insert into admin.admin_audit_log
    (admin_user_id, action, target_table, target_id, org_id,
     old_value, new_value, reason)
  values
    (v_admin, 'adr1025_reprovision_storage',
     'public.export_configurations', null, p_org_id,
     null,
     jsonb_build_object('net_request_id', v_request_id),
     p_reason);

  return jsonb_build_object(
    'enqueued',       true,
    'org_id',         p_org_id,
    'net_request_id', v_request_id
  );
end;
$$;

comment on function admin.provision_customer_storage(uuid, text) is
  'ADR-1025 Phase 2 Sprint 2.1. Operator-triggered re-provisioning. '
  'Audit-logged. Returns {enqueued: true, net_request_id}. The endpoint '
  'itself is idempotent, so this is safe to retry for any org.';

grant execute on function admin.provision_customer_storage(uuid, text) to cs_admin;

-- Verification queries (run after `bunx supabase db push`):
--
--   select pg_get_functiondef('public.dispatch_provision_storage(uuid)'::regprocedure);
--   select pg_get_functiondef('public.data_inventory_after_insert_provision()'::regprocedure);
--   select pg_get_functiondef('admin.provision_customer_storage(uuid, text)'::regprocedure);
--
--   select tgname from pg_trigger
--    where tgrelid = 'public.data_inventory'::regclass
--      and tgname  = 'data_inventory_dispatch_provision';
--     → expect 1 row
--
--   select jobname, schedule, active from cron.job
--    where jobname = 'provision-storage-retry';
--     → expect 1 row, '*/5 * * * *', active = true
