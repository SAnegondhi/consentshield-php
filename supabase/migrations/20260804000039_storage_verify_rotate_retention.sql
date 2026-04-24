-- ADR-1025 Phase 4 Sprint 4.1 — nightly verify + rotation + retention cleanup.
--
-- Three scheduled surfaces:
--   1. storage-nightly-verify   — daily 02:00 IST (20:30 UTC)
--      Calls /api/internal/storage-verify which iterates every
--      export_configurations row with is_verified=true, runs the
--      verification probe, and flips is_verified=false on any failure
--      (writing a row to export_verification_failures). Catches
--      silently-revoked BYOK tokens + CF outages.
--
--   2. storage-retention-cleanup — daily 03:00 IST (21:30 UTC)
--      Calls /api/internal/storage-retention-cleanup which empties +
--      deletes CS-managed buckets whose storage_migrations.retention_until
--      has passed (forward_only migrations only — copy_existing buckets
--      are already cut over to the customer).
--
--   3. admin.storage_rotate_credentials(org_id, reason) — operator RPC
--      Audit-logged; dispatches to /api/internal/storage-rotate which
--      mints a fresh bucket-scoped token for the existing CS-managed
--      bucket, verifies, atomically swaps write_credential_enc, revokes
--      the old token. Only valid when storage_provider = 'cs_managed_r2'.
--
-- Vault secrets (operator action, documented below):
--   cs_storage_verify_url       → .../api/internal/storage-verify
--   cs_storage_rotate_url       → .../api/internal/storage-rotate
--   cs_storage_retention_url    → .../api/internal/storage-retention-cleanup
--   (Bearer: cs_provision_storage_secret — shared trust boundary.)

-- ═══════════════════════════════════════════════════════════
-- 1/7 · Tracking columns
-- ═══════════════════════════════════════════════════════════

-- retention_processed_at: set on the storage_migrations row once the
-- retention-cleanup cron has successfully deleted the old CS-managed
-- bucket. Prevents double-processing.
alter table public.storage_migrations
  add column if not exists retention_processed_at timestamptz;

create index if not exists storage_migrations_retention_pending_idx
  on public.storage_migrations (retention_until)
  where state = 'completed'
    and mode = 'forward_only'
    and retention_until is not null
    and retention_processed_at is null;

-- last_rotation_at / last_rotation_error: record rotation outcome on the
-- export_configurations row. The admin console reads these to show the
-- rotation history.
alter table public.export_configurations
  add column if not exists last_rotation_at    timestamptz,
  add column if not exists last_rotation_error text;

-- ═══════════════════════════════════════════════════════════
-- 2/7 · Dispatch functions (one per new route)
-- ═══════════════════════════════════════════════════════════

create or replace function public.dispatch_storage_verify()
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
   where name = 'cs_storage_verify_url' limit 1;
  select decrypted_secret into v_secret
    from vault.decrypted_secrets
   where name = 'cs_provision_storage_secret' limit 1;
  if v_url is null or v_secret is null then return null; end if;

  select net.http_post(
    url := v_url,
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || v_secret,
      'Content-Type',  'application/json'
    ),
    body := jsonb_build_object()
  ) into v_request_id;
  return v_request_id;
end;
$$;

revoke execute on function public.dispatch_storage_verify() from public;
grant  execute on function public.dispatch_storage_verify() to cs_orchestrator;

create or replace function public.dispatch_storage_rotate(p_org_id uuid)
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
   where name = 'cs_storage_rotate_url' limit 1;
  select decrypted_secret into v_secret
    from vault.decrypted_secrets
   where name = 'cs_provision_storage_secret' limit 1;
  if v_url is null or v_secret is null then return null; end if;

  select net.http_post(
    url := v_url,
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || v_secret,
      'Content-Type',  'application/json'
    ),
    body := jsonb_build_object('org_id', p_org_id)
  ) into v_request_id;
  return v_request_id;
end;
$$;

revoke execute on function public.dispatch_storage_rotate(uuid) from public;
grant  execute on function public.dispatch_storage_rotate(uuid) to cs_orchestrator;

create or replace function public.dispatch_storage_retention_cleanup()
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
   where name = 'cs_storage_retention_url' limit 1;
  select decrypted_secret into v_secret
    from vault.decrypted_secrets
   where name = 'cs_provision_storage_secret' limit 1;
  if v_url is null or v_secret is null then return null; end if;

  select net.http_post(
    url := v_url,
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || v_secret,
      'Content-Type',  'application/json'
    ),
    body := jsonb_build_object()
  ) into v_request_id;
  return v_request_id;
end;
$$;

revoke execute on function public.dispatch_storage_retention_cleanup() from public;
grant  execute on function public.dispatch_storage_retention_cleanup() to cs_orchestrator;

-- ═══════════════════════════════════════════════════════════
-- 3/7 · pg_cron: nightly verify (02:00 IST = 20:30 UTC)
-- ═══════════════════════════════════════════════════════════

do $$ begin perform cron.unschedule('storage-nightly-verify');
            exception when others then null; end $$;

select cron.schedule(
  'storage-nightly-verify',
  '30 20 * * *',  -- 02:00 IST daily
  $$select public.dispatch_storage_verify()$$
);

-- ═══════════════════════════════════════════════════════════
-- 4/7 · pg_cron: retention cleanup (03:00 IST = 21:30 UTC)
-- ═══════════════════════════════════════════════════════════

do $$ begin perform cron.unschedule('storage-retention-cleanup');
            exception when others then null; end $$;

select cron.schedule(
  'storage-retention-cleanup',
  '30 21 * * *',  -- 03:00 IST daily
  $$select public.dispatch_storage_retention_cleanup()$$
);

-- ═══════════════════════════════════════════════════════════
-- 5/7 · admin.storage_rotate_credentials
-- ═══════════════════════════════════════════════════════════

create or replace function admin.storage_rotate_credentials(
  p_org_id uuid,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = public, admin, pg_catalog
as $$
declare
  v_admin uuid := auth.uid();
  v_cfg   public.export_configurations%rowtype;
  v_req   bigint;
begin
  perform admin.require_admin('support');

  if p_reason is null or length(p_reason) < 10 then
    raise exception 'reason must be at least 10 characters';
  end if;

  select * into v_cfg from public.export_configurations where org_id = p_org_id;
  if v_cfg.id is null then
    raise exception 'no export_configurations row for org %', p_org_id;
  end if;
  if v_cfg.storage_provider <> 'cs_managed_r2' then
    raise exception 'rotate only supported for cs_managed_r2 (got %)', v_cfg.storage_provider;
  end if;

  v_req := public.dispatch_storage_rotate(p_org_id);

  insert into admin.admin_audit_log
    (admin_user_id, action, target_table, target_id, org_id,
     old_value, new_value, reason)
  values (
    v_admin, 'adr1025_storage_rotate_credentials',
    'public.export_configurations', v_cfg.id, p_org_id,
    jsonb_build_object('bucket', v_cfg.bucket_name, 'provider', v_cfg.storage_provider),
    jsonb_build_object('net_request_id', v_req),
    p_reason
  );

  return jsonb_build_object(
    'enqueued',       true,
    'org_id',         p_org_id,
    'net_request_id', v_req
  );
end;
$$;

grant execute on function admin.storage_rotate_credentials(uuid, text) to cs_admin;

comment on function admin.storage_rotate_credentials(uuid, text) is
  'ADR-1025 Sprint 4.1. Rotates the bucket-scoped R2 token for a '
  'CS-managed bucket. Audit-logged. Dispatch is async; completion '
  'is observable via export_configurations.last_rotation_at + '
  'last_rotation_error columns.';

-- ═══════════════════════════════════════════════════════════
-- 6/7 · Operator seed (documentation only)
-- ═══════════════════════════════════════════════════════════
-- Run in Supabase Studio SQL Editor:
--   select vault.create_secret(
--     'https://app.consentshield.in/api/internal/storage-verify',
--     'cs_storage_verify_url'
--   );
--   select vault.create_secret(
--     'https://app.consentshield.in/api/internal/storage-rotate',
--     'cs_storage_rotate_url'
--   );
--   select vault.create_secret(
--     'https://app.consentshield.in/api/internal/storage-retention-cleanup',
--     'cs_storage_retention_url'
--   );
-- The bearer reuses cs_provision_storage_secret (same trust boundary).

-- ═══════════════════════════════════════════════════════════
-- 7/7 · Verification queries
-- ═══════════════════════════════════════════════════════════
-- select column_name from information_schema.columns
--  where table_schema = 'public' and table_name = 'storage_migrations'
--    and column_name = 'retention_processed_at';
-- select column_name from information_schema.columns
--  where table_schema = 'public' and table_name = 'export_configurations'
--    and column_name in ('last_rotation_at', 'last_rotation_error');
-- select jobname, schedule, active from cron.job
--  where jobname in ('storage-nightly-verify', 'storage-retention-cleanup');
-- select pg_get_functiondef(
--   'admin.storage_rotate_credentials(uuid, text)'::regprocedure
-- );
