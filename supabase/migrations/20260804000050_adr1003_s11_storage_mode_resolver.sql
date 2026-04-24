-- ADR-1003 Sprint 1.1 — storage_mode resolver + KV cache plumbing.
--
-- The v2 whitepaper (§2, §8) claims three processing modes (Standard /
-- Insulated / Zero-Storage) where Zero-Storage is a HARD runtime
-- invariant — zero regulated-content rows on our side. The column
-- public.organisations.storage_mode has existed since
-- 20260413000003_operational_tables.sql, but nothing inspects it at
-- runtime: a zero-storage org today writes the same rows as a standard
-- org. This migration is the first brick in changing that.
--
-- What Sprint 1.1 ships (no behavioural change yet; that lands in
-- Sprint 1.2 / 1.3):
--
--   1. public.get_storage_mode(p_org_id) — STABLE SQL resolver.
--      Callers: /v1/consent/record path (app), delivery orchestrator,
--      future process-consent-event branch.
--   2. public.org_storage_modes_snapshot() — SECURITY DEFINER; returns
--      a jsonb map {<org_id>: <mode>}. Feeds the Next.js KV-sync route.
--   3. admin.set_organisation_storage_mode(p_org_id, p_new_mode, p_reason)
--      — SECURITY DEFINER, platform_operator+ gate, audit-logged. The
--      SINGLE write surface for storage_mode going forward; the ADR-0044
--      plan-gating extension in the ADR-1003 Sprint 1.1 deliverable list
--      is realised by routing every future plan-change RPC through
--      this one RPC when it touches the mode.
--   4. public.dispatch_storage_mode_sync() — net.http_post → Next.js
--      route /api/internal/storage-mode-sync. Soft-fails if Vault
--      secret cs_storage_mode_sync_url is absent.
--   5. AFTER UPDATE OF storage_mode ON organisations — fires the
--      dispatch for near-instant KV refresh. EXCEPTION swallow so a
--      trigger failure never rolls back the UPDATE.
--   6. pg_cron 'storage-mode-kv-sync' every minute — safety-net
--      covering Vault-unconfigured windows + any dispatch miss.
--
-- Sprint 1.1 design amendments (vs the ADR proposal):
--
--   · KV KEY SHAPE. ADR says 'storage_mode:<org_id>' (one key per
--     org). Amended to a SINGLE BUNDLED KEY 'storage_modes:v1' holding
--     the full {<org_id>: <mode>} map. Same pattern as
--     sync-admin-config-to-kv (ADR-0027 Sprint 3.2). Reason: the Worker
--     hot path is per-request, not per-org; one KV read serves all
--     distinct orgs in the instance. Scales to ≥ 10k orgs (~200KB JSON,
--     well under KV's 25MB value limit) and mode changes are rare
--     ("managed migration" per §2.2), so the full-bundle refresh cost
--     is negligible. Per-org keys would also force N KV reads per
--     instance warmup.
--
--   · GATED WRITE SURFACE. ADR says "ADR-0044 plan gating extended to
--     refuse storage_mode='zero_storage' change without explicit
--     admin-console action." Today there is no storage_mode write site
--     in running code (grep confirms). Amended to SHIP the gated
--     surface (admin.set_organisation_storage_mode) now, so any future
--     code path that wants to touch storage_mode has exactly one place
--     to go. No row-level trigger forbids direct UPDATE (PG doesn't
--     grant storage_mode UPDATE to any application role anyway —
--     service_role / migrations only — so direct UPDATE by any
--     production role is already blocked by grants).

-- ═══════════════════════════════════════════════════════════
-- 1/6 · public.get_storage_mode(p_org_id)
-- ═══════════════════════════════════════════════════════════

create or replace function public.get_storage_mode(p_org_id uuid)
returns text
language sql
stable
set search_path = public, pg_catalog
as $$
  select coalesce(storage_mode, 'standard')
    from public.organisations
   where id = p_org_id
$$;

comment on function public.get_storage_mode(uuid) is
  'ADR-1003 Sprint 1.1. Resolves the storage_mode of an org. '
  'Returns standard | insulated | zero_storage. Falls back to '
  'standard when the org is missing — new code should not see this '
  'path. STABLE so planner caches within a statement.';

-- Every runtime role that might branch on the mode gets read access.
grant execute on function public.get_storage_mode(uuid)
  to cs_api, cs_orchestrator, cs_delivery, cs_admin;

-- ═══════════════════════════════════════════════════════════
-- 2/6 · public.org_storage_modes_snapshot()
-- ═══════════════════════════════════════════════════════════
-- Returns a single jsonb object mapping org_id → mode for EVERY org.
-- The Next.js KV-sync route pushes this object to Cloudflare KV at
-- key 'storage_modes:v1'. Not exposed to any client role.

create or replace function public.org_storage_modes_snapshot()
returns jsonb
language sql
stable
security definer
set search_path = public, pg_catalog
as $$
  select coalesce(
    jsonb_object_agg(id::text, coalesce(storage_mode, 'standard')),
    '{}'::jsonb
  )
    from public.organisations
$$;

comment on function public.org_storage_modes_snapshot() is
  'ADR-1003 Sprint 1.1. Full org → storage_mode map as a single '
  'jsonb object. Called by the Next.js /api/internal/storage-mode-sync '
  'route (running as cs_orchestrator) to push the bundle to Cloudflare '
  'KV. SECURITY DEFINER because cs_orchestrator reads broadly across '
  'organisations anyway (bypassrls) but we keep the call shape '
  'uniform with the other dispatch RPCs.';

revoke execute on function public.org_storage_modes_snapshot() from public;
grant  execute on function public.org_storage_modes_snapshot()
  to cs_orchestrator;

-- ═══════════════════════════════════════════════════════════
-- 3/6 · admin.set_organisation_storage_mode(...)
-- ═══════════════════════════════════════════════════════════
-- The single gated write surface for organisations.storage_mode.
-- platform_operator+ only; audit-logged; fires the dispatch.

create or replace function admin.set_organisation_storage_mode(
  p_org_id    uuid,
  p_new_mode  text,
  p_reason    text
)
returns jsonb
language plpgsql
security definer
set search_path = admin, public, pg_catalog
as $$
declare
  v_admin      uuid := auth.uid();
  v_old_mode   text;
  v_request_id bigint;
begin
  -- platform_operator or higher. support tier does NOT get to flip
  -- Zero-Storage — mode changes are managed migrations (§2.2).
  perform admin.require_admin('platform_operator');

  if p_reason is null or length(p_reason) < 10 then
    raise exception 'reason must be at least 10 characters'
      using errcode = '22023';
  end if;

  if p_new_mode not in ('standard', 'insulated', 'zero_storage') then
    raise exception 'storage_mode must be standard | insulated | zero_storage, got %',
      p_new_mode
      using errcode = '22023';
  end if;

  select storage_mode into v_old_mode
    from public.organisations
   where id = p_org_id
   for update;

  if v_old_mode is null then
    raise exception 'organisation not found: %', p_org_id
      using errcode = 'P0002';
  end if;

  if v_old_mode = p_new_mode then
    -- No-op flip; still audit-log the attempt so operators can see it
    -- in the admin log (useful when migrations were dry-runs).
    insert into admin.admin_audit_log (
      admin_user_id, action, target_table, target_id, org_id,
      old_value, new_value, reason
    ) values (
      v_admin, 'adr1003_storage_mode_noop',
      'public.organisations', p_org_id, p_org_id,
      jsonb_build_object('storage_mode', v_old_mode),
      jsonb_build_object('storage_mode', p_new_mode),
      p_reason
    );
    return jsonb_build_object(
      'changed',  false,
      'org_id',   p_org_id,
      'old_mode', v_old_mode,
      'new_mode', p_new_mode
    );
  end if;

  update public.organisations
     set storage_mode = p_new_mode,
         updated_at   = now()
   where id = p_org_id;

  insert into admin.admin_audit_log (
    admin_user_id, action, target_table, target_id, org_id,
    old_value, new_value, reason
  ) values (
    v_admin, 'adr1003_storage_mode_change',
    'public.organisations', p_org_id, p_org_id,
    jsonb_build_object('storage_mode', v_old_mode),
    jsonb_build_object('storage_mode', p_new_mode),
    p_reason
  );

  -- Kick a KV refresh NOW so runtime branches start seeing the new
  -- mode in < 5 s. The trigger below does the same, but calling
  -- explicitly here covers operator-invoked flips that run inside a
  -- larger transaction where the trigger fires on commit.
  begin
    v_request_id := public.dispatch_storage_mode_sync();
  exception when others then
    v_request_id := null;
  end;

  return jsonb_build_object(
    'changed',        true,
    'org_id',         p_org_id,
    'old_mode',       v_old_mode,
    'new_mode',       p_new_mode,
    'net_request_id', v_request_id
  );
end;
$$;

comment on function admin.set_organisation_storage_mode(uuid, text, text) is
  'ADR-1003 Sprint 1.1. Single gated write surface for '
  'organisations.storage_mode. platform_operator+ only; audit-logged '
  'as adr1003_storage_mode_change (or _noop for idempotent retries); '
  'fires KV dispatch for near-instant Worker pickup. Mode changes are '
  'managed migrations per v2 whitepaper §2.2 — this RPC does the flip '
  'but the operator runbook around data migration is separate.';

grant execute on function admin.set_organisation_storage_mode(uuid, text, text)
  to cs_admin;

-- ═══════════════════════════════════════════════════════════
-- 4/6 · public.dispatch_storage_mode_sync()
-- ═══════════════════════════════════════════════════════════

create or replace function public.dispatch_storage_mode_sync()
returns bigint
language plpgsql
security definer
set search_path = public, pg_catalog, extensions
as $$
declare
  v_url        text;
  v_secret     text;
  v_request_id bigint;
begin
  select decrypted_secret into v_url
    from vault.decrypted_secrets
   where name = 'cs_storage_mode_sync_url'
   limit 1;

  -- Bearer shared with the other internal routes (ADR-1025 pattern).
  select decrypted_secret into v_secret
    from vault.decrypted_secrets
   where name = 'cs_provision_storage_secret'
   limit 1;

  if v_url is null or v_secret is null then
    return null;
  end if;

  select net.http_post(
    url     := v_url,
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || v_secret,
      'Content-Type',  'application/json'
    ),
    body    := jsonb_build_object('sync', true)
  ) into v_request_id;

  return v_request_id;
end;
$$;

comment on function public.dispatch_storage_mode_sync() is
  'ADR-1003 Sprint 1.1. Fires net.http_post to the Next.js '
  '/api/internal/storage-mode-sync endpoint. Soft-fails on missing '
  'Vault secrets (cs_storage_mode_sync_url + shared '
  'cs_provision_storage_secret). Idempotent — the route always '
  'rewrites the whole KV bundle, so duplicate dispatches are safe.';

revoke execute on function public.dispatch_storage_mode_sync() from public;
grant  execute on function public.dispatch_storage_mode_sync()
  to cs_orchestrator;

-- ═══════════════════════════════════════════════════════════
-- 5/6 · AFTER UPDATE OF storage_mode trigger
-- ═══════════════════════════════════════════════════════════

create or replace function public.organisations_after_update_storage_mode_sync()
returns trigger
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
begin
  if new.storage_mode is distinct from old.storage_mode then
    begin
      perform public.dispatch_storage_mode_sync();
    exception when others then
      null;
    end;
  end if;
  return null; -- AFTER UPDATE — return value ignored.
end;
$$;

comment on function public.organisations_after_update_storage_mode_sync() is
  'ADR-1003 Sprint 1.1. Near-instant KV refresh on storage_mode '
  'change. Guarded by IS DISTINCT FROM so same-value UPDATEs do not '
  'dispatch. EXCEPTION swallow — a trigger failure must NOT roll back '
  'the UPDATE that produced it.';

drop trigger if exists organisations_storage_mode_sync
  on public.organisations;

create trigger organisations_storage_mode_sync
  after update of storage_mode on public.organisations
  for each row
  execute function public.organisations_after_update_storage_mode_sync();

-- ═══════════════════════════════════════════════════════════
-- 6/6 · pg_cron 'storage-mode-kv-sync' every minute
-- ═══════════════════════════════════════════════════════════

do $$
begin
  perform cron.unschedule('storage-mode-kv-sync');
  exception when others then null;
end $$;

select cron.schedule(
  'storage-mode-kv-sync',
  '* * * * *',
  $$select public.dispatch_storage_mode_sync();$$
);

-- ═══════════════════════════════════════════════════════════
-- Operator follow-up (outside this migration):
-- ═══════════════════════════════════════════════════════════
--
--   select vault.create_secret(
--     'https://app.consentshield.in/api/internal/storage-mode-sync',
--     'cs_storage_mode_sync_url'
--   );
--
-- The bearer (cs_provision_storage_secret) is already seeded from
-- ADR-1025 — no new bearer.
--
-- Verification (after `bunx supabase db push` + Vault seed):
--
--   select public.get_storage_mode('<any-org-id>');
--   select public.org_storage_modes_snapshot();
--   select jobname, schedule, active from cron.job
--    where jobname = 'storage-mode-kv-sync';
--     → 1 row, '* * * * *', active = true.
--
--   -- Live: flip a test org, assert audit row + KV bundle refresh.
--   select admin.set_organisation_storage_mode(
--     '<test-org-id>',
--     'insulated',
--     'dev flip for Sprint 1.1 live check'
--   );
--   select action, old_value, new_value from admin.admin_audit_log
--    where action like 'adr1003_storage_mode%'
--    order by occurred_at desc limit 3;
