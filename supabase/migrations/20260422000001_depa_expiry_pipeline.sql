-- ADR-0023 Sprint 1.1 — DEPA expiry pipeline.
--
-- Two helper functions + two pg_cron jobs per schema-design §11.2 / §11.10.
--
-- enforce_artefact_expiry()  — transitions active artefacts past their
--   expires_at to status='expired', removes them from the validity cache,
--   audit-logs the transition, and stages an R2-export row in
--   delivery_buffer if the purpose has auto_delete_on_expiry=true. Marks
--   consent_expiry_queue.processed_at in the same loop.
--
-- send_expiry_alerts() — iterates consent_expiry_queue rows whose notify_at
--   has lapsed (and which are not superseded/processed/already notified),
--   marks notified_at, and stages an alert row in delivery_buffer.
--
-- Both functions are idempotent under concurrent invocation by construction:
--   - enforce_artefact_expiry filters on status='active'; a second run
--     finds no rows for the same artefact.
--   - send_expiry_alerts filters on notified_at IS NULL; the UPDATE inside
--     the loop closes the gate before any delivery_buffer insert.
--
-- Depends on:
--   - ADR-0020 schema (consent_artefacts, consent_expiry_queue,
--     consent_artefact_index, purpose_definitions.auto_delete_on_expiry).
--   - delivery_buffer (pre-existing; audit-export consumer).
--   - organisations.compliance_contact_email (pre-existing).
--   - pg_cron extension (20260413000014).

-- ═══════════════════════════════════════════════════════════
-- enforce_artefact_expiry() — per schema-design §11.2
-- ═══════════════════════════════════════════════════════════
create or replace function enforce_artefact_expiry()
returns void language plpgsql security definer as $$
declare
  v_artefact    record;
  v_auto_delete boolean;
begin
  for v_artefact in
    select ca.id, ca.org_id, ca.artefact_id, ca.purpose_definition_id, ca.data_scope
      from consent_artefacts ca
     where ca.status = 'active'
       and ca.expires_at <= now()
  loop
    update consent_artefacts set status = 'expired' where id = v_artefact.id;

    delete from consent_artefact_index
     where artefact_id = v_artefact.artefact_id
       and org_id = v_artefact.org_id;

    insert into audit_log (org_id, event_type, entity_type, entity_id, payload)
    values (
      v_artefact.org_id,
      'consent_artefact_expired',
      'consent_artefacts',
      v_artefact.id,
      jsonb_build_object(
        'artefact_id', v_artefact.artefact_id,
        'reason',      'ttl_exceeded'
      )
    );

    select auto_delete_on_expiry into v_auto_delete
      from purpose_definitions
     where id = v_artefact.purpose_definition_id;

    if v_auto_delete then
      insert into delivery_buffer (org_id, event_type, payload)
      values (
        v_artefact.org_id,
        'artefact_expiry_deletion',
        jsonb_build_object(
          'artefact_id', v_artefact.artefact_id,
          'data_scope',  v_artefact.data_scope,
          'reason',      'consent_expired'
        )
      );
    end if;

    update consent_expiry_queue
       set processed_at = now()
     where artefact_id = v_artefact.artefact_id
       and processed_at is null;
  end loop;
end;
$$;

comment on function enforce_artefact_expiry() is
  'ADR-0023. Daily pg_cron helper. Transitions active artefacts past '
  'their expires_at to expired, removes from consent_artefact_index, '
  'audit-logs, and stages R2 export via delivery_buffer if the purpose '
  'has auto_delete_on_expiry=true. Marks consent_expiry_queue processed_at. '
  'Idempotent by status=''active'' filter. Expiry-triggered connector '
  'fan-out (deletion_receipts) is V2-D1 and not wired here.';

-- ═══════════════════════════════════════════════════════════
-- send_expiry_alerts() — per schema-design §11.2
-- ═══════════════════════════════════════════════════════════
create or replace function send_expiry_alerts()
returns void language plpgsql security definer as $$
declare
  v_entry record;
begin
  for v_entry in
    select ceq.id, ceq.org_id, ceq.artefact_id, ceq.purpose_code,
           ceq.expires_at, o.compliance_contact_email
      from consent_expiry_queue ceq
      join organisations o on o.id = ceq.org_id
     where ceq.notify_at <= now()
       and ceq.notified_at is null
       and ceq.processed_at is null
       and ceq.superseded = false
  loop
    update consent_expiry_queue set notified_at = now() where id = v_entry.id;

    insert into delivery_buffer (org_id, event_type, payload)
    values (
      v_entry.org_id,
      'consent_expiry_alert',
      jsonb_build_object(
        'artefact_id',        v_entry.artefact_id,
        'purpose_code',       v_entry.purpose_code,
        'expires_at',         v_entry.expires_at,
        'compliance_contact', v_entry.compliance_contact_email
      )
    );
  end loop;
end;
$$;

comment on function send_expiry_alerts() is
  'ADR-0023. Daily pg_cron helper. Picks consent_expiry_queue rows whose '
  'notify_at has lapsed (notify_at = expires_at - 30 days) and stages '
  'alert payloads in delivery_buffer for R2 export. Idempotent by '
  'notified_at IS NULL filter.';

-- Tests + manual invocations need EXECUTE access. cs_orchestrator is the
-- nominal executor in production (cron fires as the superuser but sets
-- security definer); granting authenticated keeps local test ergonomics.
grant execute on function enforce_artefact_expiry() to authenticated, cs_orchestrator;
grant execute on function send_expiry_alerts()       to authenticated, cs_orchestrator;

-- ═══════════════════════════════════════════════════════════
-- pg_cron: expiry-enforcement-daily at 19:00 UTC (00:30 IST)
-- Runs before the alert job so any newly-expired artefacts are
-- cleaned before the day's alert batch fires.
-- ═══════════════════════════════════════════════════════════
do $$ begin perform cron.unschedule('expiry-enforcement-daily');
exception when others then null; end $$;

select cron.schedule(
  'expiry-enforcement-daily',
  '0 19 * * *',
  $$select enforce_artefact_expiry()$$
);

-- ═══════════════════════════════════════════════════════════
-- pg_cron: expiry-alerts-daily at 02:30 UTC (08:00 IST)
-- ═══════════════════════════════════════════════════════════
do $$ begin perform cron.unschedule('expiry-alerts-daily');
exception when others then null; end $$;

select cron.schedule(
  'expiry-alerts-daily',
  '30 2 * * *',
  $$select send_expiry_alerts()$$
);

-- Verification:
--
-- Query A (functions exist):
--   select proname from pg_proc
--    where proname in ('enforce_artefact_expiry', 'send_expiry_alerts')
--      and pronamespace = 'public'::regnamespace;
--    → 2 rows
--
-- Query B (cron entries):
--   select jobname, schedule, active from cron.job
--    where jobname in ('expiry-enforcement-daily', 'expiry-alerts-daily');
--    → 2 rows, both active
