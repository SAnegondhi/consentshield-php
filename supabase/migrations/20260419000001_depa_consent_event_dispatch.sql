-- ADR-0021 Sprint 1.1 — consent-event dispatch trigger + safety-net cron.
--
-- Wires the Q2 Option D hybrid trigger+polling pipeline decided in the
-- Phase A review. Primary path: AFTER INSERT trigger on consent_events
-- fires net.http_post to process-consent-event Edge Function. Safety
-- net: pg_cron every 5 minutes sweeps events with empty artefact_ids.
--
-- Idempotency contract (§11.12 guard S-7) is enforced by a UNIQUE
-- constraint on consent_artefacts(consent_event_id, purpose_code) +
-- ON CONFLICT DO NOTHING in the Edge Function. Both trigger and cron
-- paths are safe to fire concurrently.
--
-- Depends on:
--   - ADR-0020 schema (consent_artefacts, consent_events.artefact_ids)
--   - Vault secrets `supabase_url` + `cs_orchestrator_key` (seeded by
--     20260414000009 + 20260416000010)
--   - pg_net extension (20260416000003)
--   - pg_cron extension (20260413000014)
--   - Deployed Edge Function process-consent-event (deployed via
--     `bunx supabase functions deploy process-consent-event` before
--     this migration applies; otherwise the trigger fires net.http_post
--     to a non-existent endpoint and the safety-net cron catches it).

-- ═══════════════════════════════════════════════════════════
-- Idempotency guard — UNIQUE (consent_event_id, purpose_code).
-- One artefact per purpose per consent interaction. Duplicate inserts
-- (from a trigger + cron race) collide at the index level; the Edge
-- Function uses ON CONFLICT DO NOTHING and fetches the existing row.
-- ═══════════════════════════════════════════════════════════
alter table consent_artefacts
  add constraint consent_artefacts_event_purpose_uq
  unique (consent_event_id, purpose_code);

comment on constraint consent_artefacts_event_purpose_uq on consent_artefacts is
  'Guard S-7 (idempotency). Prevents duplicate artefacts when the '
  'AFTER INSERT trigger and the safety-net cron both dispatch for the '
  'same consent_event_id (Q2 Option D hybrid pipeline).';

-- ═══════════════════════════════════════════════════════════
-- trigger_process_consent_event() — AFTER INSERT on consent_events.
-- Per §11.2. Fires net.http_post to process-consent-event. EXCEPTION
-- swallowed so trigger failure never rolls back the INSERT.
-- ═══════════════════════════════════════════════════════════
create or replace function trigger_process_consent_event()
returns trigger language plpgsql security definer as $$
begin
  begin
    perform net.http_post(
      url := (select decrypted_secret from vault.decrypted_secrets
              where name = 'supabase_url' limit 1)
             || '/functions/v1/process-consent-event',
      headers := jsonb_build_object(
        'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets
                                       where name = 'cs_orchestrator_key' limit 1),
        'Content-Type',  'application/json'
      ),
      body := jsonb_build_object('consent_event_id', NEW.id)
    );
  exception when others then
    -- Never block the INSERT. The safety-net cron catches orphans.
    null;
  end;
  return null;  -- AFTER INSERT trigger — return value ignored.
end;
$$;

comment on function trigger_process_consent_event() is
  'AFTER INSERT trigger function on consent_events (Q2 Option D primary '
  'path). Dispatches to process-consent-event Edge Function via '
  'net.http_post. EXCEPTION WHEN OTHERS is load-bearing — a failing '
  'trigger MUST NOT roll back the Worker''s INSERT.';

create trigger trg_consent_event_artefact_dispatch
  after insert on consent_events
  for each row execute function trigger_process_consent_event();

-- ═══════════════════════════════════════════════════════════
-- safety_net_process_consent_events() — picks up consent_events with
-- empty artefact_ids older than 5 minutes and re-fires the Edge
-- Function. Idempotency is guaranteed by the UNIQUE constraint above
-- + ON CONFLICT DO NOTHING in the Edge Function.
-- ═══════════════════════════════════════════════════════════
create or replace function safety_net_process_consent_events()
returns integer language plpgsql security definer as $$
declare
  v_event_id uuid;
  v_count    integer := 0;
begin
  for v_event_id in
    select id from consent_events
     where artefact_ids = '{}'
       and created_at < now() - interval '5 minutes'
       and created_at > now() - interval '24 hours'
     limit 100
  loop
    begin
      perform net.http_post(
        url := (select decrypted_secret from vault.decrypted_secrets
                where name = 'supabase_url' limit 1)
               || '/functions/v1/process-consent-event',
        headers := jsonb_build_object(
          'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets
                                         where name = 'cs_orchestrator_key' limit 1),
          'Content-Type',  'application/json'
        ),
        body := jsonb_build_object('consent_event_id', v_event_id)
      );
      v_count := v_count + 1;
    exception when others then
      null;  -- Continue processing other events.
    end;
  end loop;
  return v_count;
end;
$$;

comment on function safety_net_process_consent_events() is
  'Q2 Option D safety-net path. Scheduled every 5 minutes by pg_cron. '
  'Re-fires process-consent-event for consent_events where artefact_ids '
  'is still empty 5+ minutes after the INSERT (implies the primary '
  'trigger dispatch failed). 100-row batch cap; 24-hour lookback.';

-- Tests + manual invocations need EXECUTE access.
grant execute on function safety_net_process_consent_events() to authenticated, cs_orchestrator;

-- ═══════════════════════════════════════════════════════════
-- pg_cron: consent-events-artefact-safety-net every 5 minutes.
-- ═══════════════════════════════════════════════════════════
do $$ begin perform cron.unschedule('consent-events-artefact-safety-net');
exception when others then null; end $$;

select cron.schedule(
  'consent-events-artefact-safety-net',
  '*/5 * * * *',
  $$select safety_net_process_consent_events()$$
);

-- Verification (§11.11 queries 5 + 7 apply after this migration):
--
-- Query 5 (consent_event_artefact_dispatch trigger):
--   select trigger_name, event_manipulation, action_timing
--     from information_schema.triggers
--    where event_object_table = 'consent_events'
--      and trigger_name = 'trg_consent_event_artefact_dispatch';
--    → 1 row, AFTER INSERT
--
-- Query 7 (safety-net cron):
--   select jobname, schedule, active
--     from cron.job where jobname = 'consent-events-artefact-safety-net';
--    → 1 row, schedule '*/5 * * * *', active = true
