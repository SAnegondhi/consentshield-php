-- ADR-1002 Sprint 1.2 — rpc_consent_verify RPC.
--
-- Thin SECURITY DEFINER wrapper that:
--   1. Verifies property_id belongs to p_org_id (raises property_not_found).
--   2. Hashes the identifier via hash_data_principal_identifier (single source
--      of truth for normalisation; same rule used by /v1/consent/record).
--   3. Picks the most-authoritative row from consent_artefact_index.
--   4. Returns the §5.1 envelope as jsonb.
--
-- Called by app/src/app/api/v1/consent/verify/route.ts via the service-role
-- client. Grant is limited to service_role — no authenticated exposure.

create or replace function public.rpc_consent_verify(
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
  -- Step 1: property ownership.
  if not exists (
    select 1 from public.web_properties
     where id = p_property_id and org_id = p_org_id
  ) then
    raise exception 'property_not_found' using errcode = 'P0001';
  end if;

  -- Step 2: hash (raises on empty / unknown type).
  v_hash := public.hash_data_principal_identifier(p_org_id, p_identifier, p_identifier_type);

  -- Step 3: pick the row.
  -- Priority: active before expired before revoked; within the same state,
  -- newest first. This ensures a re-consent after revocation surfaces the
  -- active row, not the prior revoked one.
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

  -- Step 4: effective status — active rows whose expires_at has passed
  -- are reported as expired even if the background cron hasn't yet
  -- flipped validity_state.
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

revoke all on function public.rpc_consent_verify(uuid, uuid, text, text, text) from public;
grant execute on function public.rpc_consent_verify(uuid, uuid, text, text, text) to service_role;

comment on function public.rpc_consent_verify(uuid, uuid, text, text, text) is
  'ADR-1002 Sprint 1.2 — single-identifier consent verification. Returns §5.1 '
  'envelope. Raises property_not_found (P0001) if the property does not belong '
  'to the org, or propagates hash_data_principal_identifier errors (22023) for '
  'empty / unknown-type identifiers.';
