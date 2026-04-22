-- ADR-1016 — v1 API RPCs for the 3 remaining orphan scopes.
--
--   rpc_audit_log_list    — GET /v1/audit           (read:audit)
--   rpc_security_scans_list — GET /v1/security/scans (read:security)
--   rpc_depa_score_self   — GET /v1/score            (read:score)
--
-- All three are SECURITY DEFINER, fenced by assert_api_key_binding, and
-- follow the rpc_event_list keyset-cursor pattern where relevant.
--
-- Buffer-lifecycle note: audit_log + security_scans are transient buffers
-- (Rule 1). Rows are delivered to customer R2/S3 and deleted within ~5
-- minutes. The canonical historical audit lives in customer storage;
-- these endpoints serve only the undelivered + recently-delivered window,
-- useful for real-time ops dashboards and SIEM polling. Documented in
-- each route's OpenAPI description. depa_compliance_metrics is a
-- persistent single-row cache (one row per org, UPSERTed nightly by
-- ADR-0025's `refresh_depa_compliance_metrics()` cron).

-- ============================================================================
-- 1. rpc_audit_log_list
-- ============================================================================
--
-- Response envelope: { items: [...], next_cursor }
-- ip_address is deliberately excluded — PII. Callers can correlate via
-- actor_email if they need per-person attribution.

drop function if exists public.rpc_audit_log_list(
  uuid, uuid, text, text, timestamptz, timestamptz, text, int
);

create or replace function public.rpc_audit_log_list(
  p_key_id         uuid,
  p_org_id         uuid,
  p_event_type     text        default null,
  p_entity_type    text        default null,
  p_created_after  timestamptz default null,
  p_created_before timestamptz default null,
  p_cursor         text        default null,
  p_limit          int         default 50
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

  with filtered as (
    select id, actor_id, actor_email, event_type, entity_type, entity_id,
           payload, created_at
      from public.audit_log
     where org_id = p_org_id
       and (p_event_type     is null or event_type  = p_event_type)
       and (p_entity_type    is null or entity_type = p_entity_type)
       and (p_created_after  is null or created_at >= p_created_after)
       and (p_created_before is null or created_at <= p_created_before)
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
          'id',          id,
          'actor_id',    actor_id,
          'actor_email', actor_email,
          'event_type',  event_type,
          'entity_type', entity_type,
          'entity_id',   entity_id,
          'payload',     payload,
          'created_at',  created_at
        )
        order by created_at desc, id desc
      ) as items,
      count(*) as cnt
    from ordered
  )
  select items, cnt into v_items, v_count from agg;

  if v_items is null then
    v_items := '[]'::jsonb;
  end if;

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
  end if;

  return jsonb_build_object('items', v_items, 'next_cursor', v_next_cursor);
end;
$$;

revoke all on function public.rpc_audit_log_list(
  uuid, uuid, text, text, timestamptz, timestamptz, text, int
) from public;

comment on function public.rpc_audit_log_list(
  uuid, uuid, text, text, timestamptz, timestamptz, text, int
) is
  'ADR-1016 Sprint 1.1 — GET /v1/audit. Keyset-paginated audit_log for '
  'the caller''s org. Serves recent events only (buffer lifecycle); '
  'customers query canonical history from their own R2/S3. ip_address '
  'excluded from response envelope.';

-- ============================================================================
-- 2. rpc_security_scans_list
-- ============================================================================

drop function if exists public.rpc_security_scans_list(
  uuid, uuid, uuid, text, text, timestamptz, timestamptz, text, int
);

create or replace function public.rpc_security_scans_list(
  p_key_id         uuid,
  p_org_id         uuid,
  p_property_id    uuid        default null,
  p_severity       text        default null,
  p_signal_key     text        default null,
  p_scanned_after  timestamptz default null,
  p_scanned_before timestamptz default null,
  p_cursor         text        default null,
  p_limit          int         default 50
) returns jsonb
language plpgsql
security definer
set search_path = public, extensions, pg_catalog
as $$
declare
  v_limit          int;
  v_cursor_jsonb   jsonb;
  v_cursor_scanned timestamptz;
  v_cursor_id      uuid;
  v_items          jsonb;
  v_count          int;
  v_next_cursor    text;
begin
  perform public.assert_api_key_binding(p_key_id, p_org_id);

  v_limit := greatest(1, least(coalesce(p_limit, 50), 200));

  if p_severity is not null
     and p_severity not in ('critical', 'high', 'medium', 'low', 'info') then
    raise exception 'invalid_severity' using errcode = '22023';
  end if;

  if p_cursor is not null and length(p_cursor) > 0 then
    begin
      v_cursor_jsonb   := convert_from(decode(p_cursor, 'base64'), 'UTF8')::jsonb;
      v_cursor_scanned := (v_cursor_jsonb->>'c')::timestamptz;
      v_cursor_id      := (v_cursor_jsonb->>'i')::uuid;
    exception when others then
      raise exception 'bad_cursor' using errcode = '22023';
    end;
  end if;

  with filtered as (
    select id, property_id, scan_type, severity, signal_key,
           details, remediation, scanned_at, created_at
      from public.security_scans
     where org_id = p_org_id
       and (p_property_id    is null or property_id = p_property_id)
       and (p_severity       is null or severity    = p_severity)
       and (p_signal_key     is null or signal_key  = p_signal_key)
       and (p_scanned_after  is null or scanned_at >= p_scanned_after)
       and (p_scanned_before is null or scanned_at <= p_scanned_before)
  ),
  keyset as (
    select * from filtered
     where v_cursor_scanned is null
        or (scanned_at, id) < (v_cursor_scanned, v_cursor_id)
     order by scanned_at desc, id desc
     limit v_limit + 1
  ),
  ordered as (
    select * from keyset order by scanned_at desc, id desc
  ),
  agg as (
    select
      jsonb_agg(
        jsonb_build_object(
          'id',          id,
          'property_id', property_id,
          'scan_type',   scan_type,
          'severity',    severity,
          'signal_key',  signal_key,
          'details',     details,
          'remediation', remediation,
          'scanned_at',  scanned_at,
          'created_at',  created_at
        )
        order by scanned_at desc, id desc
      ) as items,
      count(*) as cnt
    from ordered
  )
  select items, cnt into v_items, v_count from agg;

  if v_items is null then
    v_items := '[]'::jsonb;
  end if;

  if v_count > v_limit then
    v_items := v_items - v_limit;
    v_next_cursor := encode(
      convert_to(
        jsonb_build_object(
          'c', ((v_items -> (v_limit - 1))->>'scanned_at')::timestamptz,
          'i', ((v_items -> (v_limit - 1))->>'id')::uuid
        )::text,
        'UTF8'
      ),
      'base64'
    );
  end if;

  return jsonb_build_object('items', v_items, 'next_cursor', v_next_cursor);
end;
$$;

revoke all on function public.rpc_security_scans_list(
  uuid, uuid, uuid, text, text, timestamptz, timestamptz, text, int
) from public;

comment on function public.rpc_security_scans_list(
  uuid, uuid, uuid, text, text, timestamptz, timestamptz, text, int
) is
  'ADR-1016 Sprint 1.2 — GET /v1/security/scans. Keyset-paginated '
  'security_scans for the caller''s org. Serves recent runs (buffer).';

-- ============================================================================
-- 3. rpc_depa_score_self
-- ============================================================================
--
-- Single-row read — one depa_compliance_metrics per org. Returns an
-- envelope with null scores + null computed_at if the nightly refresh
-- hasn't run yet for this org, so clients don't special-case 404.

drop function if exists public.rpc_depa_score_self(uuid, uuid);

create or replace function public.rpc_depa_score_self(
  p_key_id uuid,
  p_org_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = public, extensions, pg_catalog
as $$
declare
  v_row public.depa_compliance_metrics%rowtype;
begin
  perform public.assert_api_key_binding(p_key_id, p_org_id);

  select * into v_row
    from public.depa_compliance_metrics
   where org_id = p_org_id;

  if not found then
    return jsonb_build_object(
      'total_score',      null,
      'coverage_score',   null,
      'expiry_score',     null,
      'freshness_score',  null,
      'revocation_score', null,
      'computed_at',      null,
      'max_score',        20
    );
  end if;

  return jsonb_build_object(
    'total_score',      v_row.total_score,
    'coverage_score',   v_row.coverage_score,
    'expiry_score',     v_row.expiry_score,
    'freshness_score',  v_row.freshness_score,
    'revocation_score', v_row.revocation_score,
    'computed_at',      v_row.computed_at,
    'max_score',        20
  );
end;
$$;

revoke all on function public.rpc_depa_score_self(uuid, uuid) from public;

comment on function public.rpc_depa_score_self(uuid, uuid) is
  'ADR-1016 Sprint 1.3 — GET /v1/score. Returns the cached DEPA score '
  '(ADR-0025 / ADR-0020). max_score=20 is fixed (5 points × 4 dimensions). '
  'All fields null if no metrics row exists yet (nightly cron has not '
  'run for this org).';
