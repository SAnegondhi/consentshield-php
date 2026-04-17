-- ADR-0037 Sprint 1.1 — V2-D1 expiry-triggered connector fan-out.
--
-- Closes the symmetry gap between revocation (ADR-0022: fans out to
-- deletion_receipts) and expiry (ADR-0023: only staged a delivery_buffer
-- R2-export row, never instructed connectors). TTL-lapse expiry of an
-- artefact with purpose.auto_delete_on_expiry=true now also produces
-- one deletion_receipts row per active connector mapped to that purpose,
-- scoped to the data_categories ∩ data_scope intersection.
--
-- Idempotency: UNIQUE partial index on (artefact_id, connector_id)
-- WHERE trigger_type = 'consent_expired'. A repeat cron run on the same
-- already-expired artefact will not double-insert. Uses artefact_id (not
-- trigger_id) because expiry is not a row-scoped event like revocation
-- and has no natural trigger row — artefact_id is stable and sufficient.
--
-- Depends on:
--   - ADR-0022 migration 20260420000001 (deletion_receipts.artefact_id
--     column was added there for the revocation path; we reuse it).
--   - pgcrypto extension for digest() (already enabled pre-DEPA).

-- ═══════════════════════════════════════════════════════════
-- Idempotency guard for consent_expired receipts.
-- ═══════════════════════════════════════════════════════════
create unique index deletion_receipts_expiry_artefact_connector_uq
  on deletion_receipts (artefact_id, connector_id)
  where trigger_type = 'consent_expired';

comment on index deletion_receipts_expiry_artefact_connector_uq is
  'ADR-0037 V2-D1 idempotency guard. One deletion_receipts row per '
  '(expired artefact × connector). Prevents duplicates if '
  'enforce_artefact_expiry() is invoked twice for the same already-'
  'expired artefact via the repeat cron path.';

-- ═══════════════════════════════════════════════════════════
-- Extend enforce_artefact_expiry() to fan out to deletion_receipts
-- alongside the existing delivery_buffer R2-export row.
--
-- The new behaviour fires ONLY when purpose.auto_delete_on_expiry is
-- true AND there is at least one active connector mapping with a
-- non-empty scope intersection. Otherwise only delivery_buffer is
-- written, preserving ADR-0023 semantics for customers without
-- configured connectors.
-- ═══════════════════════════════════════════════════════════
create or replace function enforce_artefact_expiry()
returns void language plpgsql security definer as $$
declare
  v_artefact       record;
  v_auto_delete    boolean;
  v_mapping        record;
  v_connector_name text;
  v_scoped_fields  text[];
  v_identifier_h   text;
begin
  for v_artefact in
    select ca.id, ca.org_id, ca.artefact_id, ca.purpose_definition_id,
           ca.data_scope, ca.session_fingerprint
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
      -- R2-export staging row (ADR-0023 behaviour, unchanged).
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

      -- ADR-0037 V2-D1: connector fan-out. One deletion_receipts row
      -- per mapped active connector, scoped to the intersection of
      -- mapping.data_categories with artefact.data_scope.
      v_identifier_h := encode(
        digest(v_artefact.session_fingerprint, 'sha256'),
        'hex'
      );

      for v_mapping in
        select pcm.connector_id, pcm.data_categories, ic.display_name, ic.status
          from purpose_connector_mappings pcm
          join integration_connectors ic on ic.id = pcm.connector_id
         where pcm.purpose_definition_id = v_artefact.purpose_definition_id
           and pcm.org_id                = v_artefact.org_id
           and ic.status                 = 'active'
      loop
        v_scoped_fields := array(
          select unnest(v_mapping.data_categories)
          intersect
          select unnest(v_artefact.data_scope)
        );

        if array_length(v_scoped_fields, 1) is null then
          continue;  -- empty intersection → skip.
        end if;

        insert into deletion_receipts (
          org_id, trigger_type, trigger_id, connector_id, target_system,
          identifier_hash, artefact_id, status, request_payload
        ) values (
          v_artefact.org_id,
          'consent_expired',
          null,
          v_mapping.connector_id,
          v_mapping.display_name,
          v_identifier_h,
          v_artefact.artefact_id,
          'pending',
          jsonb_build_object(
            'artefact_id', v_artefact.artefact_id,
            'data_scope',  v_scoped_fields,
            'reason',      'consent_expired'
          )
        )
        on conflict (artefact_id, connector_id)
          where trigger_type = 'consent_expired'
          do nothing;
      end loop;
    end if;

    update consent_expiry_queue
       set processed_at = now()
     where artefact_id = v_artefact.artefact_id
       and processed_at is null;
  end loop;
end;
$$;

comment on function enforce_artefact_expiry() is
  'ADR-0023 + ADR-0037 V2-D1. Daily pg_cron helper. Transitions active '
  'artefacts past their expires_at to expired, removes from '
  'consent_artefact_index, audit-logs, stages R2 export via '
  'delivery_buffer if purpose has auto_delete_on_expiry=true, AND '
  'writes one deletion_receipts row per active mapped connector '
  '(scoped to data_categories ∩ data_scope) so third-party connectors '
  'receive the same delete instruction that revocation produces. '
  'Marks consent_expiry_queue.processed_at. Idempotent.';

-- Verification:
--
-- Query A (new UNIQUE index):
--   select indexname, indexdef from pg_indexes
--    where indexname = 'deletion_receipts_expiry_artefact_connector_uq';
--    → 1 row, partial index on (artefact_id, connector_id)
--      WHERE trigger_type = 'consent_expired'
--
-- Query B (function body mentions deletion_receipts):
--   select pg_get_functiondef(oid) from pg_proc
--    where proname = 'enforce_artefact_expiry'
--      and pronamespace = 'public'::regnamespace;
--    → body contains 'insert into deletion_receipts' and
--      'trigger_type = ''consent_expired'''
