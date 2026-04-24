-- ADR-1019 Sprint 3.1 — trigger + cron wiring for deliver-consent-events.
--
-- Hybrid dispatch pattern, identical shape to ADR-1025 Sprint 2.1's
-- provision-storage wiring (20260804000036):
--
--   · AFTER INSERT trigger on public.delivery_buffer fires a per-row
--     dispatch via net.http_post → /api/internal/deliver-consent-events
--     with {delivery_buffer_id: <uuid>}. Primary path.
--   · pg_cron 'deliver-consent-events-scan' runs every 60 s and fires
--     the same endpoint with {scan: true}. Safety-net batch path — picks
--     up rows the trigger missed (producer didn't fire the trigger,
--     Vault was misconfigured at insert time, net.http_post transient
--     failure, etc.).
--
-- The route itself (Sprint 2.1 / 2.2) is idempotent: already_delivered
-- short-circuits, the backoff gate rate-limits retries, and the
-- manual-review escalation (Sprint 2.3) stops runaway loops. So
-- duplicate dispatches between the trigger and the cron are always safe.
--
-- Vault secrets (operator action, outside this migration):
--
--   select vault.create_secret(
--     '<https://app.consentshield.in/api/internal/deliver-consent-events>',
--     'cs_deliver_events_url'
--   );
--
-- The bearer is shared with the ADR-1025 internal storage routes
-- (cs_provision_storage_secret). No new bearer required — same trust
-- boundary (internal-only routes under the same shared secret the
-- operator rotates in one place).

-- ═══════════════════════════════════════════════════════════
-- 1/3 · public.dispatch_deliver_consent_events(p_row_id?)
-- ═══════════════════════════════════════════════════════════
-- Dual-purpose: a non-null p_row_id posts {delivery_buffer_id: p_row_id};
-- a null p_row_id posts {scan: true}. The route (Sprint 2.2) handles
-- both. Returns the pg_net request id so triggers + cron can log it.

create or replace function public.dispatch_deliver_consent_events(
  p_row_id uuid default null
)
returns bigint
language plpgsql
security definer
set search_path = public, pg_catalog, extensions
as $$
declare
  v_url        text;
  v_secret     text;
  v_request_id bigint;
  v_body       jsonb;
begin
  select decrypted_secret into v_url
    from vault.decrypted_secrets
   where name = 'cs_deliver_events_url'
   limit 1;

  select decrypted_secret into v_secret
    from vault.decrypted_secrets
   where name = 'cs_provision_storage_secret'
   limit 1;

  if v_url is null or v_secret is null then
    -- Missing Vault secret → soft failure. Never raise from a trigger.
    -- The cron will retry every 60 s once the operator configures the
    -- URL, and the scan path will sweep any backlog.
    return null;
  end if;

  v_body := case
    when p_row_id is null then jsonb_build_object('scan', true)
    else jsonb_build_object('delivery_buffer_id', p_row_id)
  end;

  select net.http_post(
    url     := v_url,
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || v_secret,
      'Content-Type',  'application/json'
    ),
    body    := v_body
  ) into v_request_id;

  return v_request_id;
end;
$$;

comment on function public.dispatch_deliver_consent_events(uuid) is
  'ADR-1019 Sprint 3.1. Fires net.http_post to the Next.js '
  '/api/internal/deliver-consent-events endpoint. Null p_row_id → '
  '{scan: true} (batch mode). Non-null → {delivery_buffer_id: p_row_id} '
  '(single-row mode). Soft-fails if Vault secrets are absent — the '
  '60s cron safety-net retries until configured. Idempotent by design: '
  'the route handles already_delivered short-circuit, backoff, and '
  'manual-review escalation.';

revoke execute on function public.dispatch_deliver_consent_events(uuid) from public;
grant  execute on function public.dispatch_deliver_consent_events(uuid) to cs_orchestrator;

-- ═══════════════════════════════════════════════════════════
-- 2/3 · AFTER INSERT trigger on public.delivery_buffer
-- ═══════════════════════════════════════════════════════════
-- Fires per-row dispatch for every new delivery_buffer row. The trigger
-- function is SECURITY DEFINER so producers under cs_worker /
-- cs_orchestrator / cs_admin etc. can all insert without needing EXECUTE
-- on dispatch_deliver_consent_events themselves.

create or replace function public.delivery_buffer_after_insert_deliver()
returns trigger
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
begin
  -- Best-effort dispatch. EXCEPTION WHEN OTHERS is load-bearing:
  -- producers MUST NOT see their INSERT roll back because the delivery
  -- route is unreachable or the Vault entry is missing. The cron catches
  -- the miss.
  begin
    perform public.dispatch_deliver_consent_events(new.id);
  exception when others then
    null;
  end;

  return null; -- AFTER INSERT — return value ignored.
end;
$$;

comment on function public.delivery_buffer_after_insert_deliver() is
  'ADR-1019 Sprint 3.1. Fires a per-row delivery dispatch on every '
  'delivery_buffer INSERT. EXCEPTION swallow is load-bearing — a '
  'trigger failure MUST NOT roll back the producer''s INSERT. The 60s '
  'cron safety-net covers any miss.';

drop trigger if exists delivery_buffer_dispatch_delivery
  on public.delivery_buffer;

create trigger delivery_buffer_dispatch_delivery
  after insert on public.delivery_buffer
  for each row
  execute function public.delivery_buffer_after_insert_deliver();

-- ═══════════════════════════════════════════════════════════
-- 3/3 · pg_cron safety-net — every 60 s (scan mode)
-- ═══════════════════════════════════════════════════════════
-- Every 60 s, invoke the route with {scan: true}. The route's
-- deliverBatch (Sprint 2.2) handles the selection, backoff, and per-
-- request wall-time budget internally. One cron, one net.http_post —
-- the route does the rest.

do $$
begin
  perform cron.unschedule('deliver-consent-events-scan');
  exception when others then null;
end $$;

select cron.schedule(
  'deliver-consent-events-scan',
  '* * * * *',
  $$select public.dispatch_deliver_consent_events();$$
);

-- ═══════════════════════════════════════════════════════════
-- Verification queries (run after `bunx supabase db push`):
-- ═══════════════════════════════════════════════════════════
--
--   select pg_get_functiondef('public.dispatch_deliver_consent_events(uuid)'::regprocedure);
--   select pg_get_functiondef('public.delivery_buffer_after_insert_deliver()'::regprocedure);
--
--   select tgname from pg_trigger
--    where tgrelid = 'public.delivery_buffer'::regclass
--      and tgname  = 'delivery_buffer_dispatch_delivery';
--     → expect 1 row
--
--   select jobname, schedule, active from cron.job
--    where jobname = 'deliver-consent-events-scan';
--     → expect 1 row, '* * * * *', active = true
--
--   -- End-to-end smoke: insert a probe row on a test org with a
--   -- verified export_configurations, wait 5 s, verify R2 object + row
--   -- absence:
--   -- (run from scripts/verify-adr-1019-sprint-31.ts once it exists)
