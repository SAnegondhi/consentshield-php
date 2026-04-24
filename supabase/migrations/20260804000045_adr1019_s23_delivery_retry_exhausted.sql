-- ADR-1019 Sprint 2.3 — manual-review escalation when a delivery_buffer
-- row crosses attempt_count >= 10.
--
-- cs_delivery calls admin.record_delivery_retry_exhausted(...) after
-- markFailure bumps attempt_count to the threshold. The RPC is idempotent
-- by (org_id, event_type) within the set of pending / in_progress flags
-- so operators don't get duplicate pages while they investigate.
--
-- SECURITY DEFINER runs the INSERT as the function owner (postgres,
-- bypassrls), so the ops_readiness_flags RLS policy
-- (using (admin.is_admin())) doesn't block the cs_delivery caller.

grant usage on schema admin to cs_delivery;

create or replace function admin.record_delivery_retry_exhausted(
  p_row_id     uuid,
  p_org_id     uuid,
  p_event_type text,
  p_last_error text
)
returns boolean
language plpgsql
security definer
set search_path = admin, public, extensions, pg_catalog
as $$
declare
  v_existing_id uuid;
begin
  -- Dedup: one pending / in_progress flag per (org_id, event_type) at a
  -- time. Once an operator marks the flag resolved, a fresh failure wave
  -- creates a new one.
  select id into v_existing_id
    from admin.ops_readiness_flags
   where status in ('pending', 'in_progress')
     and source_adr = 'ADR-1019-retry-exhausted'
     and description like '%org_id=' || p_org_id::text || '%'
     and description like '%event_type=' || p_event_type || '%'
   limit 1;

  if found then
    return false;
  end if;

  insert into admin.ops_readiness_flags (
    title, description, source_adr, blocker_type, severity, status, owner
  ) values (
    format('Delivery retry exhausted — %s', p_event_type),
    format(
      'A public.delivery_buffer row reached attempt_count >= 10 and was '
      'marked MANUAL_REVIEW. Investigate the customer''s R2 bucket, '
      'credentials, and export_configurations row. After fixing, resolve '
      'this flag to let fresh rows for this (org_id, event_type) '
      'deliver normally. row_id=%s org_id=%s event_type=%s '
      'last_error=%s',
      p_row_id,
      p_org_id,
      p_event_type,
      coalesce(p_last_error, '')
    ),
    'ADR-1019-retry-exhausted',
    'infra',
    'high',
    'pending',
    'ops'
  );
  return true;
end;
$$;

comment on function admin.record_delivery_retry_exhausted(uuid, uuid, text, text) is
  'ADR-1019 Sprint 2.3. Called by the deliver-consent-events Next.js '
  'route (under cs_delivery) when a delivery_buffer row crosses '
  'attempt_count >= 10. Idempotent by (org_id, event_type) within '
  'pending / in_progress flags. Returns true when a new flag was '
  'inserted, false when an existing open flag covered it.';

grant execute on function admin.record_delivery_retry_exhausted(uuid, uuid, text, text)
  to cs_delivery;
