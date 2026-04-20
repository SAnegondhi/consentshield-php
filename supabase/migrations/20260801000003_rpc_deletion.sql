-- ADR-1002 Sprint 4.1 — Deletion API RPCs.
--
-- Two RPCs, both SECURITY DEFINER + service_role:
--   rpc_deletion_trigger       — inserts artefact_revocations rows; the ADR-0022
--                                 cascade + process-artefact-revocation Edge
--                                 Function create deletion_receipts asynchronously.
--   rpc_deletion_receipts_list — cursor-paginated list with filters.
--
-- Trigger modes:
--   consent_revoked   — purpose_codes required; sweeps active artefacts matching
--                       (property, identifier, purpose_code).
--   erasure_request   — sweeps ALL active artefacts for (property, identifier).
--                       DPDP §13 erasure scope.
--   retention_expired — deferred (requires data-scope sweep orchestration).
--                       Returns retention_mode_not_yet_implemented (22023).

create or replace function public.rpc_deletion_trigger(
  p_org_id            uuid,
  p_property_id       uuid,
  p_identifier        text,
  p_identifier_type   text,
  p_reason            text,
  p_purpose_codes     text[] default null,
  p_scope_override    text[] default null,
  p_actor_type        text default 'user',
  p_actor_ref         text default null
) returns jsonb
language plpgsql
security definer
set search_path = public, extensions, pg_catalog
as $$
declare
  v_hash           text;
  v_artefact_ids   text[];
  v_revoked_ids    text[] := '{}'::text[];
  v_artefact_id    text;
  v_new_rev_id     uuid;
  v_reason_code    text;
  v_revoked_by     text;
  v_invalid_reason boolean;
begin
  -- Validate property ownership.
  if not exists (
    select 1 from public.web_properties
     where id = p_property_id and org_id = p_org_id
  ) then
    raise exception 'property_not_found' using errcode = 'P0001';
  end if;

  -- Validate reason.
  if p_reason not in ('consent_revoked', 'erasure_request', 'retention_expired') then
    raise exception 'unknown_reason: %', p_reason using errcode = '22023';
  end if;

  if p_reason = 'retention_expired' then
    raise exception 'retention_mode_not_yet_implemented' using errcode = '22023';
  end if;

  if p_reason = 'consent_revoked' then
    if p_purpose_codes is null or array_length(p_purpose_codes, 1) is null then
      raise exception 'purpose_codes_required_for_consent_revoked' using errcode = '22023';
    end if;
  end if;

  if p_actor_type not in ('user', 'operator', 'system') then
    raise exception 'unknown_actor_type: %', p_actor_type using errcode = '22023';
  end if;

  -- Hash identifier (propagates 22023 on empty / unknown type).
  v_hash := public.hash_data_principal_identifier(p_org_id, p_identifier, p_identifier_type);

  -- Collect active artefacts that match the scope.
  if p_reason = 'consent_revoked' then
    select array_agg(ca.artefact_id)
      into v_artefact_ids
      from public.consent_artefact_index cai
      join public.consent_artefacts     ca on ca.artefact_id = cai.artefact_id
     where cai.org_id          = p_org_id
       and cai.property_id     = p_property_id
       and cai.identifier_hash = v_hash
       and cai.purpose_code    = any(p_purpose_codes)
       and ca.status           = 'active'
       and cai.validity_state  = 'active';
  else  -- erasure_request
    select array_agg(ca.artefact_id)
      into v_artefact_ids
      from public.consent_artefact_index cai
      join public.consent_artefacts     ca on ca.artefact_id = cai.artefact_id
     where cai.org_id          = p_org_id
       and cai.property_id     = p_property_id
       and cai.identifier_hash = v_hash
       and ca.status           = 'active'
       and cai.validity_state  = 'active';
  end if;

  v_artefact_ids := coalesce(v_artefact_ids, '{}'::text[]);

  -- Map reason → reason_code (the column value on artefact_revocations).
  v_reason_code := case p_reason
    when 'consent_revoked' then 'user_preference_change'
    when 'erasure_request' then 'user_withdrawal'
  end;

  v_revoked_by := case p_actor_type
    when 'user'     then 'data_principal'
    when 'operator' then 'organisation'
    else                 'system'
  end;

  -- Fire revocation for each matching artefact. Cascade trigger handles
  -- consent_artefacts.status + consent_artefact_index updates; the async
  -- dispatch trigger creates deletion_receipts.
  foreach v_artefact_id in array v_artefact_ids
  loop
    insert into public.artefact_revocations (
      org_id, artefact_id, reason, revoked_by_type, revoked_by_ref, notes
    ) values (
      p_org_id, v_artefact_id, v_reason_code, v_revoked_by,
      p_actor_ref,
      'Triggered via /v1/deletion/trigger reason=' || p_reason
    )
    returning id into v_new_rev_id;

    v_revoked_ids := v_revoked_ids || v_artefact_id;
  end loop;

  return jsonb_build_object(
    'reason',               p_reason,
    'revoked_artefact_ids', v_revoked_ids,
    'revoked_count',        array_length(v_revoked_ids, 1),
    'initial_status',       'pending',
    'note',                 'deletion_receipts are created asynchronously by the process-artefact-revocation pipeline; poll /v1/deletion/receipts with artefact_id or issued_after to observe.'
  );
end;
$$;

revoke all on function public.rpc_deletion_trigger(uuid, uuid, text, text, text, text[], text[], text, text) from public;
grant execute on function public.rpc_deletion_trigger(uuid, uuid, text, text, text, text[], text[], text, text) to service_role;

comment on function public.rpc_deletion_trigger(uuid, uuid, text, text, text, text[], text[], text, text) is
  'ADR-1002 Sprint 4.1 — deletion orchestration entry point. Inserts '
  'artefact_revocations rows; the ADR-0022 cascade + process-artefact-'
  'revocation Edge Function create deletion_receipts asynchronously. '
  'Supports reason=consent_revoked (purpose_codes required) and '
  'reason=erasure_request (sweeps all active artefacts for the principal).';

-- ── rpc_deletion_receipts_list ───────────────────────────────────────────────

create or replace function public.rpc_deletion_receipts_list(
  p_org_id        uuid,
  p_status        text default null,
  p_connector_id  uuid default null,
  p_artefact_id   text default null,
  p_issued_after  timestamptz default null,
  p_issued_before timestamptz default null,
  p_cursor        text default null,
  p_limit         int default 50
) returns jsonb
language plpgsql
security definer
set search_path = public, extensions, pg_catalog
as $$
declare
  v_limit          int;
  v_cursor_jsonb   jsonb;
  v_cursor_created timestamptz;
  v_cursor_id      uuid;
  v_items          jsonb;
  v_count          int;
  v_next_cursor    text;
begin
  v_limit := greatest(1, least(coalesce(p_limit, 50), 200));

  if p_cursor is not null and length(p_cursor) > 0 then
    begin
      v_cursor_jsonb   := convert_from(decode(p_cursor, 'base64'), 'UTF8')::jsonb;
      v_cursor_created := (v_cursor_jsonb->>'c')::timestamptz;
      v_cursor_id      := (v_cursor_jsonb->>'i')::uuid;
    exception when others then
      raise exception 'bad_cursor' using errcode = '22023';
    end;
  end if;

  -- Filter by artefact_id requires a join through artefact_revocations →
  -- trigger_id. Rather than complicate the query, store this as a separate
  -- optional CTE.
  with base as (
    select dr.id, dr.trigger_type, dr.trigger_id, dr.connector_id,
           dr.target_system, dr.status, dr.retry_count, dr.failure_reason,
           dr.requested_at, dr.confirmed_at, dr.created_at,
           ar.artefact_id as source_artefact_id
      from public.deletion_receipts dr
      left join public.artefact_revocations ar on ar.id = dr.trigger_id
     where dr.org_id = p_org_id
       and (p_status         is null or dr.status       = p_status)
       and (p_connector_id   is null or dr.connector_id = p_connector_id)
       and (p_artefact_id    is null or ar.artefact_id  = p_artefact_id)
       and (p_issued_after   is null or dr.created_at  >= p_issued_after)
       and (p_issued_before  is null or dr.created_at  <= p_issued_before)
  ),
  keyset as (
    select * from base
     where v_cursor_created is null
        or (created_at, id) < (v_cursor_created, v_cursor_id)
     order by created_at desc, id desc
     limit v_limit + 1
  ),
  ordered as (
    select * from keyset order by created_at desc, id desc
  ),
  agg as (
    select
      jsonb_agg(
        jsonb_build_object(
          'id',             id,
          'trigger_type',   trigger_type,
          'trigger_id',     trigger_id,
          'artefact_id',    source_artefact_id,
          'connector_id',   connector_id,
          'target_system',  target_system,
          'status',         status,
          'retry_count',    retry_count,
          'failure_reason', failure_reason,
          'requested_at',   requested_at,
          'confirmed_at',   confirmed_at,
          'created_at',     created_at
        )
        order by created_at desc, id desc
      ) as items,
      count(*) as cnt
    from ordered
  )
  select items, cnt into v_items, v_count from agg;

  if v_count > v_limit then
    v_items := v_items - v_limit;
    v_next_cursor := encode(
      convert_to(
        jsonb_build_object(
          'c', ((v_items -> (v_limit - 1))->>'created_at')::timestamptz,
          'i', ((v_items -> (v_limit - 1))->>'id')::uuid
        )::text,
        'UTF8'
      ),
      'base64'
    );
  else
    v_next_cursor := null;
  end if;

  return jsonb_build_object(
    'items',       coalesce(v_items, '[]'::jsonb),
    'next_cursor', v_next_cursor
  );
end;
$$;

revoke all on function public.rpc_deletion_receipts_list(uuid, text, uuid, text, timestamptz, timestamptz, text, int) from public;
grant execute on function public.rpc_deletion_receipts_list(uuid, text, uuid, text, timestamptz, timestamptz, text, int) to service_role;
