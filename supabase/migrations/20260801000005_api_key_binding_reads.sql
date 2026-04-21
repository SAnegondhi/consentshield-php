-- ADR-1009 Sprint 1.2 — DB-level tenant fence for v1 API read RPCs.
--
-- Phase 1 companion to 20260801000004. Adds `p_key_id` (first param) +
-- `assert_api_key_binding(p_key_id, p_org_id)` at the top of every read
-- path RPC the /v1/* handlers call. Same discipline: DB refuses cross-key
-- access before any tenant-visible work.
--
-- Covers: rpc_consent_verify, rpc_consent_verify_batch, rpc_artefact_list,
-- rpc_artefact_get, rpc_event_list, rpc_deletion_receipts_list.
--
-- Grants stay on service_role only — Phase 2 flips them to cs_api.

-- ============================================================================
-- 1. rpc_consent_verify
-- ============================================================================

drop function if exists public.rpc_consent_verify(uuid, uuid, text, text, text);

create or replace function public.rpc_consent_verify(
  p_key_id          uuid,
  p_org_id          uuid,
  p_property_id     uuid,
  p_identifier      text,
  p_identifier_type text,
  p_purpose_code    text
) returns jsonb
language plpgsql
security definer
set search_path = public, extensions, pg_catalog
as $$
declare
  v_hash         text;
  v_row          public.consent_artefact_index%rowtype;
  v_status       text;
  v_evaluated_at timestamptz := now();
begin
  perform public.assert_api_key_binding(p_key_id, p_org_id);

  if not exists (
    select 1 from public.web_properties
     where id = p_property_id and org_id = p_org_id
  ) then
    raise exception 'property_not_found' using errcode = 'P0001';
  end if;

  v_hash := public.hash_data_principal_identifier(p_org_id, p_identifier, p_identifier_type);

  select *
    into v_row
    from public.consent_artefact_index
   where org_id         = p_org_id
     and property_id    = p_property_id
     and identifier_hash = v_hash
     and purpose_code   = p_purpose_code
   order by case validity_state
              when 'active'  then 0
              when 'expired' then 1
              when 'revoked' then 2
              else 3
            end,
            created_at desc
   limit 1;

  if not found then
    return jsonb_build_object(
      'property_id',         p_property_id,
      'identifier_type',     p_identifier_type,
      'purpose_code',        p_purpose_code,
      'status',              'never_consented',
      'active_artefact_id',  null,
      'revoked_at',          null,
      'revocation_record_id', null,
      'expires_at',          null,
      'evaluated_at',        v_evaluated_at
    );
  end if;

  if v_row.validity_state = 'revoked' then
    v_status := 'revoked';
  elsif v_row.validity_state = 'expired' then
    v_status := 'expired';
  elsif v_row.validity_state = 'active' and v_row.expires_at is not null and v_row.expires_at < v_evaluated_at then
    v_status := 'expired';
  else
    v_status := 'granted';
  end if;

  return jsonb_build_object(
    'property_id',         p_property_id,
    'identifier_type',     p_identifier_type,
    'purpose_code',        p_purpose_code,
    'status',              v_status,
    'active_artefact_id',  case when v_status = 'granted' then v_row.artefact_id else null end,
    'revoked_at',          v_row.revoked_at,
    'revocation_record_id', v_row.revocation_record_id,
    'expires_at',          v_row.expires_at,
    'evaluated_at',        v_evaluated_at
  );
end;
$$;

revoke all on function public.rpc_consent_verify(uuid, uuid, uuid, text, text, text) from public;
grant execute on function public.rpc_consent_verify(uuid, uuid, uuid, text, text, text) to service_role;

-- ============================================================================
-- 2. rpc_consent_verify_batch
-- ============================================================================

drop function if exists public.rpc_consent_verify_batch(uuid, uuid, text, text, text[]);

create or replace function public.rpc_consent_verify_batch(
  p_key_id          uuid,
  p_org_id          uuid,
  p_property_id     uuid,
  p_identifier_type text,
  p_purpose_code    text,
  p_identifiers     text[]
) returns jsonb
language plpgsql
security definer
set search_path = public, extensions, pg_catalog
as $$
declare
  v_hashes       text[];
  v_evaluated_at timestamptz := now();
  v_results      jsonb;
  v_count        int;
begin
  perform public.assert_api_key_binding(p_key_id, p_org_id);

  if p_identifiers is null then
    raise exception 'identifiers_empty' using errcode = '22023';
  end if;

  v_count := coalesce(array_length(p_identifiers, 1), 0);

  if v_count = 0 then
    raise exception 'identifiers_empty' using errcode = '22023';
  end if;

  if v_count > 10000 then
    raise exception 'identifiers_too_large: % > 10000', v_count using errcode = '22023';
  end if;

  if not exists (
    select 1 from public.web_properties
     where id = p_property_id and org_id = p_org_id
  ) then
    raise exception 'property_not_found' using errcode = 'P0001';
  end if;

  select array_agg(
           public.hash_data_principal_identifier(p_org_id, t.ident, p_identifier_type)
           order by t.ord
         )
    into v_hashes
    from unnest(p_identifiers) with ordinality as t(ident, ord);

  with input as (
    select ord, p_identifiers[ord] as identifier, v_hashes[ord] as hash
      from generate_series(1, v_count) as ord
  ),
  resolved as (
    select
      input.ord,
      input.identifier,
      best.artefact_id,
      best.validity_state,
      best.revoked_at,
      best.revocation_record_id,
      best.expires_at
    from input
    left join lateral (
      select artefact_id, validity_state, revoked_at, revocation_record_id, expires_at
        from public.consent_artefact_index r
       where r.org_id          = p_org_id
         and r.property_id     = p_property_id
         and r.identifier_hash = input.hash
         and r.purpose_code    = p_purpose_code
       order by case r.validity_state
                  when 'active'  then 0
                  when 'expired' then 1
                  when 'revoked' then 2
                  else 3
                end,
                r.created_at desc
       limit 1
    ) best on true
  )
  select jsonb_agg(
           jsonb_build_object(
             'identifier',         identifier,
             'status',
               case
                 when validity_state is null                                          then 'never_consented'
                 when validity_state = 'revoked'                                      then 'revoked'
                 when validity_state = 'expired'                                      then 'expired'
                 when validity_state = 'active'
                  and expires_at is not null
                  and expires_at < v_evaluated_at                                     then 'expired'
                 else 'granted'
               end,
             'active_artefact_id',
               case
                 when validity_state = 'active'
                  and (expires_at is null or expires_at >= v_evaluated_at)            then artefact_id
                 else null
               end,
             'revoked_at',           revoked_at,
             'revocation_record_id', revocation_record_id,
             'expires_at',           expires_at
           )
           order by ord
         )
    into v_results
    from resolved;

  return jsonb_build_object(
    'property_id',     p_property_id,
    'identifier_type', p_identifier_type,
    'purpose_code',    p_purpose_code,
    'evaluated_at',    v_evaluated_at,
    'results',         coalesce(v_results, '[]'::jsonb)
  );
end;
$$;

revoke all on function public.rpc_consent_verify_batch(uuid, uuid, uuid, text, text, text[]) from public;
grant execute on function public.rpc_consent_verify_batch(uuid, uuid, uuid, text, text, text[]) to service_role;

-- ============================================================================
-- 3. rpc_artefact_list
-- ============================================================================

drop function if exists public.rpc_artefact_list(
  uuid, uuid, text, text, text, text, timestamptz, timestamptz, text, int
);

create or replace function public.rpc_artefact_list(
  p_key_id          uuid,
  p_org_id          uuid,
  p_property_id     uuid default null,
  p_identifier      text default null,
  p_identifier_type text default null,
  p_status          text default null,
  p_purpose_code    text default null,
  p_expires_before  timestamptz default null,
  p_expires_after   timestamptz default null,
  p_cursor          text default null,
  p_limit           int default 50
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
  v_identifier_hash text;
  v_items          jsonb;
  v_next_cursor    text;
  v_count          int;
begin
  perform public.assert_api_key_binding(p_key_id, p_org_id);

  v_limit := greatest(1, least(coalesce(p_limit, 50), 200));

  if p_identifier is not null and p_identifier_type is not null then
    v_identifier_hash := public.hash_data_principal_identifier(
      p_org_id, p_identifier, p_identifier_type
    );
  elsif p_identifier is not null or p_identifier_type is not null then
    raise exception 'identifier_requires_both_fields' using errcode = '22023';
  end if;

  if p_cursor is not null and length(p_cursor) > 0 then
    begin
      v_cursor_jsonb := convert_from(decode(p_cursor, 'base64'), 'UTF8')::jsonb;
      v_cursor_created := (v_cursor_jsonb->>'c')::timestamptz;
      v_cursor_id := (v_cursor_jsonb->>'i')::uuid;
    exception when others then
      raise exception 'bad_cursor' using errcode = '22023';
    end;
  end if;

  with filtered as (
    select
      ca.id,
      ca.artefact_id,
      ca.property_id,
      ca.purpose_code,
      ca.purpose_definition_id,
      ca.data_scope,
      ca.framework,
      ca.status,
      ca.expires_at,
      ca.replaced_by,
      ca.created_at,
      cai.identifier_type,
      cai.revoked_at,
      cai.revocation_record_id,
      case
        when ca.status = 'revoked'                                    then 'revoked'
        when ca.status = 'replaced'                                   then 'replaced'
        when ca.status = 'active'
         and ca.expires_at is not null
         and ca.expires_at < now()                                    then 'expired'
        when ca.status = 'expired'                                    then 'expired'
        else 'active'
      end as effective_status
    from public.consent_artefacts ca
    left join public.consent_artefact_index cai
      on cai.artefact_id = ca.artefact_id
    where ca.org_id = p_org_id
      and (p_property_id  is null or ca.property_id  = p_property_id)
      and (p_purpose_code is null or ca.purpose_code = p_purpose_code)
      and (p_expires_before is null or ca.expires_at < p_expires_before)
      and (p_expires_after  is null or ca.expires_at > p_expires_after)
      and (v_identifier_hash is null or cai.identifier_hash = v_identifier_hash)
  ),
  status_filtered as (
    select * from filtered
     where p_status is null or effective_status = p_status
  ),
  keyset as (
    select * from status_filtered
     where v_cursor_created is null
        or (created_at, id) < (v_cursor_created, v_cursor_id)
     order by created_at desc, id desc
     limit v_limit + 1
  )
  select
    jsonb_agg(
      jsonb_build_object(
        'artefact_id',          artefact_id,
        'property_id',          property_id,
        'purpose_code',         purpose_code,
        'purpose_definition_id', purpose_definition_id,
        'data_scope',           data_scope,
        'framework',            framework,
        'status',               effective_status,
        'expires_at',           expires_at,
        'revoked_at',           revoked_at,
        'revocation_record_id', revocation_record_id,
        'replaced_by',          replaced_by,
        'identifier_type',      identifier_type,
        'created_at',           created_at
      )
      order by created_at desc, id desc
    ),
    count(*)
    into v_items, v_count
    from keyset
   where true;

  if v_count > v_limit then
    v_items := (v_items - (v_limit));
    declare
      v_id uuid;
    begin
      select id into v_id from public.consent_artefacts
       where artefact_id = (v_items -> (v_limit - 1))->>'artefact_id' and org_id = p_org_id;

      v_next_cursor := encode(
        convert_to(
          jsonb_build_object(
            'c', ((v_items -> (v_limit - 1))->>'created_at')::timestamptz,
            'i', v_id
          )::text,
          'UTF8'
        ),
        'base64'
      );
    end;
  else
    v_next_cursor := null;
  end if;

  return jsonb_build_object(
    'items',       coalesce(v_items, '[]'::jsonb),
    'next_cursor', v_next_cursor
  );
end;
$$;

revoke all on function public.rpc_artefact_list(
  uuid, uuid, uuid, text, text, text, text, timestamptz, timestamptz, text, int
) from public;
grant execute on function public.rpc_artefact_list(
  uuid, uuid, uuid, text, text, text, text, timestamptz, timestamptz, text, int
) to service_role;

-- ============================================================================
-- 4. rpc_artefact_get
-- ============================================================================

drop function if exists public.rpc_artefact_get(uuid, text);

create or replace function public.rpc_artefact_get(
  p_key_id      uuid,
  p_org_id      uuid,
  p_artefact_id text
) returns jsonb
language plpgsql
security definer
set search_path = public, extensions, pg_catalog
as $$
declare
  v_art      record;
  v_cai      record;
  v_chain    jsonb := '[]'::jsonb;
begin
  perform public.assert_api_key_binding(p_key_id, p_org_id);

  select * into v_art
    from public.consent_artefacts
   where artefact_id = p_artefact_id and org_id = p_org_id;

  if not found then
    return null;
  end if;

  select * into v_cai
    from public.consent_artefact_index
   where artefact_id = p_artefact_id and org_id = p_org_id
   limit 1;

  with recursive backward as (
    select artefact_id, replaced_by, created_at, 1 as depth
      from public.consent_artefacts
     where replaced_by = p_artefact_id and org_id = p_org_id
    union all
    select ca.artefact_id, ca.replaced_by, ca.created_at, b.depth + 1
      from public.consent_artefacts ca
      join backward b on ca.replaced_by = b.artefact_id
     where ca.org_id = p_org_id
       and b.depth < 100
  ),
  forward as (
    select artefact_id, replaced_by, created_at, 1 as depth
      from public.consent_artefacts
     where artefact_id = v_art.replaced_by
       and org_id = p_org_id
    union all
    select ca.artefact_id, ca.replaced_by, ca.created_at, f.depth + 1
      from public.consent_artefacts ca
      join forward f on ca.artefact_id = f.replaced_by
     where ca.org_id = p_org_id
       and f.depth < 100
  ),
  combined as (
    select artefact_id, created_at from backward
    union all
    select p_artefact_id, v_art.created_at
    union all
    select artefact_id, created_at from forward
  )
  select coalesce(
           jsonb_agg(artefact_id order by created_at asc),
           jsonb_build_array(p_artefact_id)
         )
    into v_chain
    from combined;

  return jsonb_build_object(
    'artefact_id',          v_art.artefact_id,
    'property_id',          v_art.property_id,
    'purpose_code',         v_art.purpose_code,
    'purpose_definition_id', v_art.purpose_definition_id,
    'data_scope',           v_art.data_scope,
    'framework',            v_art.framework,
    'status',               v_art.status,
    'expires_at',           v_art.expires_at,
    'replaced_by',          v_art.replaced_by,
    'created_at',           v_art.created_at,
    'identifier_type',      v_cai.identifier_type,
    'revocation', (
      select jsonb_build_object(
               'id',              r.id,
               'reason',          r.reason,
               'revoked_by_type', r.revoked_by_type,
               'revoked_by_ref',  r.revoked_by_ref,
               'created_at',      r.created_at
             )
        from public.artefact_revocations r
       where r.id = v_cai.revocation_record_id
    ),
    'replacement_chain', v_chain
  );
end;
$$;

revoke all on function public.rpc_artefact_get(uuid, uuid, text) from public;
grant execute on function public.rpc_artefact_get(uuid, uuid, text) to service_role;

-- ============================================================================
-- 5. rpc_event_list
-- ============================================================================

drop function if exists public.rpc_event_list(
  uuid, uuid, timestamptz, timestamptz, text, text, int
);

create or replace function public.rpc_event_list(
  p_key_id         uuid,
  p_org_id         uuid,
  p_property_id    uuid default null,
  p_created_after  timestamptz default null,
  p_created_before timestamptz default null,
  p_source         text default null,
  p_cursor         text default null,
  p_limit          int default 50
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
  perform public.assert_api_key_binding(p_key_id, p_org_id);

  v_limit := greatest(1, least(coalesce(p_limit, 50), 200));

  if p_cursor is not null and length(p_cursor) > 0 then
    begin
      v_cursor_jsonb := convert_from(decode(p_cursor, 'base64'), 'UTF8')::jsonb;
      v_cursor_created := (v_cursor_jsonb->>'c')::timestamptz;
      v_cursor_id := (v_cursor_jsonb->>'i')::uuid;
    exception when others then
      raise exception 'bad_cursor' using errcode = '22023';
    end;
  end if;

  with filtered as (
    select id, property_id, source, event_type,
           jsonb_array_length(coalesce(purposes_accepted, '[]'::jsonb)) as purposes_accepted_count,
           jsonb_array_length(coalesce(purposes_rejected, '[]'::jsonb)) as purposes_rejected_count,
           identifier_type,
           array_length(coalesce(artefact_ids, '{}'::text[]), 1) as artefact_count,
           created_at
      from public.consent_events
     where org_id = p_org_id
       and (p_property_id    is null or property_id = p_property_id)
       and (p_created_after  is null or created_at >= p_created_after)
       and (p_created_before is null or created_at <= p_created_before)
       and (p_source         is null or source = p_source)
  ),
  keyset as (
    select * from filtered
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
          'id',                      id,
          'property_id',             property_id,
          'source',                  source,
          'event_type',              event_type,
          'purposes_accepted_count', purposes_accepted_count,
          'purposes_rejected_count', purposes_rejected_count,
          'identifier_type',         identifier_type,
          'artefact_count',          coalesce(artefact_count, 0),
          'created_at',              created_at
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

revoke all on function public.rpc_event_list(
  uuid, uuid, uuid, timestamptz, timestamptz, text, text, int
) from public;
grant execute on function public.rpc_event_list(
  uuid, uuid, uuid, timestamptz, timestamptz, text, text, int
) to service_role;

-- ============================================================================
-- 6. rpc_deletion_receipts_list
-- ============================================================================

drop function if exists public.rpc_deletion_receipts_list(
  uuid, text, uuid, text, timestamptz, timestamptz, text, int
);

create or replace function public.rpc_deletion_receipts_list(
  p_key_id        uuid,
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
  perform public.assert_api_key_binding(p_key_id, p_org_id);

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

revoke all on function public.rpc_deletion_receipts_list(
  uuid, uuid, text, uuid, text, timestamptz, timestamptz, text, int
) from public;
grant execute on function public.rpc_deletion_receipts_list(
  uuid, uuid, text, uuid, text, timestamptz, timestamptz, text, int
) to service_role;
