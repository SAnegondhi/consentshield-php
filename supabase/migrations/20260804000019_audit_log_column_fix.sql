-- ADR-1017 Sprint 1.3 (+ ADR-1018 follow-up) — fix admin_audit_log column
-- misuse in the ops-readiness + status-page RPCs.
--
-- Bug: migrations 20260804000012 + 20260804000013 inserted into
-- admin.admin_audit_log using non-existent columns (`target_kind`,
-- `payload`) and omitted the NOT NULL + length>=10 `reason` column.
-- Function bodies compiled (CREATE OR REPLACE FUNCTION does not
-- validate inner INSERT column references until invocation), so the
-- bug stayed latent until Sprint 1.3 started writing tests that
-- actually call the RPCs.
--
-- Canonical admin_audit_log column layout (20260416000015):
--   admin_user_id, action, target_table, target_id, target_pk, org_id,
--   old_value, new_value, reason (not null, length >= 10).
--
-- All five RPCs are rewritten CREATE OR REPLACE so function signatures
-- are unchanged — no grant redo, no caller update needed.

-- ============================================================================
-- 1. ADR-1017 — admin.set_ops_readiness_flag_status
-- ============================================================================

create or replace function admin.set_ops_readiness_flag_status(
  p_flag_id          uuid,
  p_status           text,
  p_resolution_notes text default null
)
returns admin.ops_readiness_flags
language plpgsql
security definer
set search_path = admin, public, extensions, pg_catalog
as $$
declare
  v_role   text := admin.current_admin_role();
  v_actor  uuid;
  v_old    admin.ops_readiness_flags%rowtype;
  v_row    admin.ops_readiness_flags%rowtype;
  v_reason text;
begin
  perform admin.require_admin('support');
  -- Extra gate: only platform_operator / platform_owner may close out a
  -- readiness flag. Support-tier may mark in_progress but not resolved
  -- or deferred.
  if p_status in ('resolved', 'deferred')
     and v_role not in ('platform_operator', 'platform_owner') then
    raise exception 'platform_operator or platform_owner required to mark %', p_status
      using errcode = '42501';
  end if;

  if p_status not in ('pending', 'in_progress', 'resolved', 'deferred') then
    raise exception 'invalid_status: %', p_status using errcode = '22023';
  end if;

  v_actor := auth.uid();

  select * into v_old
    from admin.ops_readiness_flags
   where id = p_flag_id;

  if not found then
    raise exception 'flag_not_found: %', p_flag_id using errcode = 'P0002';
  end if;

  update admin.ops_readiness_flags
     set status            = p_status,
         resolution_notes  = coalesce(p_resolution_notes, resolution_notes),
         resolved_by       = case when p_status in ('resolved', 'deferred') then v_actor else null end,
         resolved_at       = case when p_status in ('resolved', 'deferred') then now() else null end
   where id = p_flag_id
  returning * into v_row;

  -- audit_log.reason is NOT NULL length>=10. Synthesise a reason that
  -- meets the check when p_resolution_notes is null or too short.
  v_reason := 'ops_readiness_flag:' || p_status ||
              ' — ' || coalesce(nullif(p_resolution_notes, ''), 'no notes');

  insert into admin.admin_audit_log (
    admin_user_id, action, target_table, target_id, old_value, new_value, reason
  ) values (
    v_actor,
    'ops_readiness_flag.status_changed',
    'admin.ops_readiness_flags',
    p_flag_id,
    to_jsonb(v_old),
    to_jsonb(v_row),
    v_reason
  );

  return v_row;
end;
$$;

-- ============================================================================
-- 2. ADR-1018 — admin.set_status_subsystem_state
-- ============================================================================

create or replace function admin.set_status_subsystem_state(
  p_slug  text,
  p_state text,
  p_note  text default null
)
returns public.status_subsystems
language plpgsql
security definer
set search_path = admin, public, extensions, pg_catalog
as $$
declare
  v_actor uuid := auth.uid();
  v_old   public.status_subsystems%rowtype;
  v_row   public.status_subsystems%rowtype;
begin
  perform admin.require_admin('support');

  if p_state not in ('operational', 'degraded', 'down', 'maintenance') then
    raise exception 'invalid_state: %', p_state using errcode = '22023';
  end if;

  select * into v_old
    from public.status_subsystems
   where slug = p_slug;

  if not found then
    raise exception 'subsystem_not_found: %', p_slug using errcode = 'P0002';
  end if;

  update public.status_subsystems
     set current_state          = p_state,
         last_state_change_at   = now(),
         last_state_change_note = p_note
   where slug = p_slug
  returning * into v_row;

  insert into admin.admin_audit_log (
    admin_user_id, action, target_table, target_id, target_pk,
    old_value, new_value, reason
  ) values (
    v_actor,
    'status.subsystem_state_changed',
    'public.status_subsystems',
    v_row.id,
    p_slug,
    jsonb_build_object('current_state', v_old.current_state),
    jsonb_build_object('current_state', p_state, 'note', p_note),
    'status subsystem ' || p_slug || ' -> ' || p_state
  );

  return v_row;
end;
$$;

-- ============================================================================
-- 3. ADR-1018 — admin.post_status_incident
-- ============================================================================

create or replace function admin.post_status_incident(
  p_title                text,
  p_description          text,
  p_severity             text,
  p_affected_subsystems  uuid[] default '{}',
  p_initial_status       text default 'investigating'
)
returns public.status_incidents
language plpgsql
security definer
set search_path = admin, public, extensions, pg_catalog
as $$
declare
  v_actor uuid := auth.uid();
  v_row   public.status_incidents%rowtype;
begin
  perform admin.require_admin('support');

  if p_severity not in ('sev1', 'sev2', 'sev3') then
    raise exception 'invalid_severity: %', p_severity using errcode = '22023';
  end if;
  if p_initial_status not in ('investigating', 'identified', 'monitoring') then
    raise exception 'invalid_initial_status: %', p_initial_status using errcode = '22023';
  end if;

  insert into public.status_incidents (
    title, description, severity, status,
    affected_subsystems, started_at, created_by
  ) values (
    p_title, p_description, p_severity, p_initial_status,
    coalesce(p_affected_subsystems, '{}'), now(), v_actor
  )
  returning * into v_row;

  insert into admin.admin_audit_log (
    admin_user_id, action, target_table, target_id,
    new_value, reason
  ) values (
    v_actor,
    'status.incident_posted',
    'public.status_incidents',
    v_row.id,
    to_jsonb(v_row),
    'posted status incident: ' || left(p_title, 200) ||
      ' (' || p_severity || ')'
  );

  return v_row;
end;
$$;

-- ============================================================================
-- 4. ADR-1018 — admin.update_status_incident
-- ============================================================================

create or replace function admin.update_status_incident(
  p_incident_id      uuid,
  p_new_status       text,
  p_last_update_note text default null
)
returns public.status_incidents
language plpgsql
security definer
set search_path = admin, public, extensions, pg_catalog
as $$
declare
  v_actor uuid := auth.uid();
  v_old   public.status_incidents%rowtype;
  v_row   public.status_incidents%rowtype;
begin
  perform admin.require_admin('support');

  if p_new_status not in ('investigating', 'identified', 'monitoring', 'resolved') then
    raise exception 'invalid_status: %', p_new_status using errcode = '22023';
  end if;

  select * into v_old
    from public.status_incidents
   where id = p_incident_id;

  if not found then
    raise exception 'incident_not_found: %', p_incident_id using errcode = 'P0002';
  end if;

  update public.status_incidents
     set status = p_new_status,
         last_update_note = coalesce(p_last_update_note, last_update_note),
         identified_at = case
           when p_new_status = 'identified' and identified_at is null then now()
           else identified_at
         end,
         monitoring_at = case
           when p_new_status = 'monitoring' and monitoring_at is null then now()
           else monitoring_at
         end,
         resolved_at = case
           when p_new_status = 'resolved' then now()
           else resolved_at
         end
   where id = p_incident_id
  returning * into v_row;

  insert into admin.admin_audit_log (
    admin_user_id, action, target_table, target_id,
    old_value, new_value, reason
  ) values (
    v_actor,
    'status.incident_updated',
    'public.status_incidents',
    p_incident_id,
    jsonb_build_object('status', v_old.status),
    jsonb_build_object('status', p_new_status, 'note', p_last_update_note),
    'incident ' || p_incident_id::text || ' -> ' || p_new_status
  );

  return v_row;
end;
$$;

-- ============================================================================
-- 5. ADR-1018 — admin.resolve_status_incident
-- ============================================================================

create or replace function admin.resolve_status_incident(
  p_incident_id    uuid,
  p_postmortem_url text default null,
  p_resolution_note text default null
)
returns public.status_incidents
language plpgsql
security definer
set search_path = admin, public, extensions, pg_catalog
as $$
declare
  v_actor uuid := auth.uid();
  v_old   public.status_incidents%rowtype;
  v_row   public.status_incidents%rowtype;
begin
  perform admin.require_admin('support');

  select * into v_old
    from public.status_incidents
   where id = p_incident_id;

  if not found then
    raise exception 'incident_not_found: %', p_incident_id using errcode = 'P0002';
  end if;

  update public.status_incidents
     set status            = 'resolved',
         resolved_at       = now(),
         postmortem_url    = coalesce(p_postmortem_url, postmortem_url),
         last_update_note  = coalesce(p_resolution_note, last_update_note)
   where id = p_incident_id
  returning * into v_row;

  insert into admin.admin_audit_log (
    admin_user_id, action, target_table, target_id,
    old_value, new_value, reason
  ) values (
    v_actor,
    'status.incident_resolved',
    'public.status_incidents',
    p_incident_id,
    jsonb_build_object('status', v_old.status),
    jsonb_build_object(
      'status', 'resolved',
      'postmortem_url', p_postmortem_url
    ),
    'incident ' || p_incident_id::text || ' resolved' ||
      case when p_postmortem_url is not null then ' (postmortem attached)' else '' end
  );

  return v_row;
end;
$$;

comment on function admin.set_ops_readiness_flag_status(uuid, text, text) is
  'ADR-1017 Sprint 1.3 — audit-log column-misuse fix (20260804000019).';
comment on function admin.set_status_subsystem_state(text, text, text) is
  'ADR-1018 follow-up — audit-log column-misuse fix (20260804000019).';
comment on function admin.post_status_incident(text, text, text, uuid[], text) is
  'ADR-1018 follow-up — audit-log column-misuse fix (20260804000019).';
comment on function admin.update_status_incident(uuid, text, text) is
  'ADR-1018 follow-up — audit-log column-misuse fix (20260804000019).';
comment on function admin.resolve_status_incident(uuid, text, text) is
  'ADR-1018 follow-up — audit-log column-misuse fix (20260804000019).';
