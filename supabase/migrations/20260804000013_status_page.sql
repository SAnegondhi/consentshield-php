-- ADR-1018 Sprint 1.1 — self-hosted status-page schema + admin RPCs.
--
-- Three tables under `public`:
--   status_subsystems  — one row per monitored subsystem
--   status_checks      — timeseries of probe results (5-min cron)
--   status_incidents   — human-posted incidents + post-mortem links
--
-- RLS opens SELECT to `anon` + `authenticated` so the public status page
-- can render without auth. Mutations are admin-only via SECURITY DEFINER
-- RPCs (require_admin('support') or platform_operator for destructive ops).

-- ============================================================================
-- 1. status_subsystems
-- ============================================================================

create table if not exists public.status_subsystems (
  id                    uuid primary key default gen_random_uuid(),
  slug                  text not null unique,
  display_name          text not null,
  description           text,
  health_url            text,
  current_state         text not null default 'operational',
  last_state_change_at  timestamptz not null default now(),
  last_state_change_note text,
  sort_order            integer not null default 100,
  is_public             boolean not null default true,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

alter table public.status_subsystems
  drop constraint if exists status_subsystems_state_check;
alter table public.status_subsystems
  add constraint status_subsystems_state_check
  check (current_state in ('operational', 'degraded', 'down', 'maintenance'));

create index if not exists idx_status_subsystems_public_sort
  on public.status_subsystems (sort_order, slug)
  where is_public;

drop trigger if exists trg_status_subsystems_updated_at
  on public.status_subsystems;
create trigger trg_status_subsystems_updated_at
  before update on public.status_subsystems
  for each row execute function public.set_updated_at();

-- ============================================================================
-- 2. status_checks
-- ============================================================================

create table if not exists public.status_checks (
  id            uuid primary key default gen_random_uuid(),
  subsystem_id  uuid not null references public.status_subsystems(id) on delete cascade,
  checked_at    timestamptz not null default now(),
  status        text not null,
  latency_ms    integer,
  error_message text,
  source_region text
);

alter table public.status_checks
  drop constraint if exists status_checks_status_check;
alter table public.status_checks
  add constraint status_checks_status_check
  check (status in ('operational', 'degraded', 'down', 'maintenance', 'error'));

create index if not exists idx_status_checks_recent
  on public.status_checks (subsystem_id, checked_at desc);

-- ============================================================================
-- 3. status_incidents
-- ============================================================================

create table if not exists public.status_incidents (
  id                   uuid primary key default gen_random_uuid(),
  title                text not null,
  description          text not null,
  severity             text not null,
  status               text not null default 'investigating',
  affected_subsystems  uuid[] not null default '{}',
  started_at           timestamptz not null default now(),
  identified_at        timestamptz,
  monitoring_at        timestamptz,
  resolved_at          timestamptz,
  postmortem_url       text,
  created_by           uuid references auth.users(id) on delete set null,
  last_update_note     text,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

alter table public.status_incidents
  drop constraint if exists status_incidents_severity_check;
alter table public.status_incidents
  add constraint status_incidents_severity_check
  check (severity in ('sev1', 'sev2', 'sev3'));

alter table public.status_incidents
  drop constraint if exists status_incidents_status_check;
alter table public.status_incidents
  add constraint status_incidents_status_check
  check (status in ('investigating', 'identified', 'monitoring', 'resolved'));

create index if not exists idx_status_incidents_open
  on public.status_incidents (status, started_at desc)
  where status <> 'resolved';

create index if not exists idx_status_incidents_all
  on public.status_incidents (started_at desc);

drop trigger if exists trg_status_incidents_updated_at
  on public.status_incidents;
create trigger trg_status_incidents_updated_at
  before update on public.status_incidents
  for each row execute function public.set_updated_at();

-- ============================================================================
-- 4. RLS — SELECT open to anon + authenticated; mutations via admin RPC only
-- ============================================================================

alter table public.status_subsystems enable row level security;
alter table public.status_checks     enable row level security;
alter table public.status_incidents  enable row level security;

-- Public-readable subsystems: everyone sees rows where is_public = true.
drop policy if exists status_subsystems_public_select on public.status_subsystems;
create policy status_subsystems_public_select
  on public.status_subsystems
  for select to anon, authenticated
  using (is_public = true);

-- Admins see all subsystems including internal-only.
drop policy if exists status_subsystems_admin_all on public.status_subsystems;
create policy status_subsystems_admin_all
  on public.status_subsystems
  for select to authenticated
  using (admin.is_admin());

-- Checks + incidents — fully public SELECT. Historical probe data is part
-- of the uptime story; hiding it doesn't protect anything.
drop policy if exists status_checks_public_select on public.status_checks;
create policy status_checks_public_select
  on public.status_checks
  for select to anon, authenticated using (true);

drop policy if exists status_incidents_public_select on public.status_incidents;
create policy status_incidents_public_select
  on public.status_incidents
  for select to anon, authenticated using (true);

grant select on public.status_subsystems to anon, authenticated;
grant select on public.status_checks     to anon, authenticated;
grant select on public.status_incidents  to anon, authenticated;
grant select, insert, update on public.status_subsystems to cs_orchestrator;
grant insert                on public.status_checks     to cs_orchestrator;
grant insert, update        on public.status_incidents  to cs_orchestrator;

-- ============================================================================
-- 5. Seed subsystems
-- ============================================================================

insert into public.status_subsystems (slug, display_name, description, health_url, sort_order)
values
  ('banner_cdn',
   'Banner CDN',
   'Cloudflare Worker delivering /v1/banner.js to customer websites.',
   'https://consentshield.workers.dev/v1/health',
   10),
  ('consent_capture_api',
   'Consent Capture API',
   'Cloudflare Worker POST /v1/events + /v1/observations intake.',
   'https://consentshield.workers.dev/v1/health',
   20),
  ('verification_api',
   'Verification API',
   'ConsentShield v1 REST surface for consent verification + artefact ops.',
   'https://app.consentshield.in/api/v1/_ping',
   30),
  ('deletion_orchestration',
   'Deletion Orchestration',
   'Edge Function pipeline that fans revocations out to connector endpoints.',
   null,
   40),
  ('dashboard',
   'Customer Dashboard',
   'Next.js app at app.consentshield.in — authenticated operator surface.',
   'https://app.consentshield.in',
   50),
  ('notification_channels',
   'Notification Channels',
   'Slack / Teams / Discord / PagerDuty / email delivery for operator alerts.',
   null,
   60)
on conflict (slug) do nothing;

-- ============================================================================
-- 6. Admin RPCs — all audit-logged
-- ============================================================================

-- 6.1 set_status_subsystem_state — operator flips a subsystem manually
-- (e.g. scheduled maintenance window). Probes also write here via the
-- Edge Function; this RPC is for *manual* overrides.
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
  v_row   public.status_subsystems%rowtype;
begin
  perform admin.require_admin('support');

  if p_state not in ('operational', 'degraded', 'down', 'maintenance') then
    raise exception 'invalid_state: %', p_state using errcode = '22023';
  end if;

  update public.status_subsystems
     set current_state          = p_state,
         last_state_change_at   = now(),
         last_state_change_note = p_note
   where slug = p_slug
  returning * into v_row;

  if not found then
    raise exception 'subsystem_not_found: %', p_slug using errcode = 'P0002';
  end if;

  insert into admin.admin_audit_log (
    occurred_at, admin_user_id, action, target_kind, target_id, payload
  ) values (
    now(), v_actor, 'status.subsystem_state_changed',
    'status_subsystem', v_row.id,
    jsonb_build_object('slug', p_slug, 'new_state', p_state, 'note', p_note)
  );

  return v_row;
end;
$$;

grant execute on function admin.set_status_subsystem_state(text, text, text)
  to authenticated, cs_admin;

-- 6.2 post_status_incident
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
    occurred_at, admin_user_id, action, target_kind, target_id, payload
  ) values (
    now(), v_actor, 'status.incident_posted',
    'status_incident', v_row.id,
    jsonb_build_object('title', p_title, 'severity', p_severity, 'status', p_initial_status)
  );

  return v_row;
end;
$$;

grant execute on function admin.post_status_incident(text, text, text, uuid[], text)
  to authenticated, cs_admin;

-- 6.3 update_status_incident — lifecycle + progress notes
create or replace function admin.update_status_incident(
  p_incident_id     uuid,
  p_new_status      text,
  p_last_update_note text default null
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

  if p_new_status not in ('investigating', 'identified', 'monitoring', 'resolved') then
    raise exception 'invalid_status: %', p_new_status using errcode = '22023';
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

  if not found then
    raise exception 'incident_not_found: %', p_incident_id using errcode = 'P0002';
  end if;

  insert into admin.admin_audit_log (
    occurred_at, admin_user_id, action, target_kind, target_id, payload
  ) values (
    now(), v_actor, 'status.incident_updated',
    'status_incident', p_incident_id,
    jsonb_build_object('new_status', p_new_status, 'note', p_last_update_note)
  );

  return v_row;
end;
$$;

grant execute on function admin.update_status_incident(uuid, text, text)
  to authenticated, cs_admin;

-- 6.4 resolve_status_incident — wraps update + postmortem_url
create or replace function admin.resolve_status_incident(
  p_incident_id   uuid,
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
  v_row   public.status_incidents%rowtype;
begin
  perform admin.require_admin('support');

  update public.status_incidents
     set status            = 'resolved',
         resolved_at       = now(),
         postmortem_url    = coalesce(p_postmortem_url, postmortem_url),
         last_update_note  = coalesce(p_resolution_note, last_update_note)
   where id = p_incident_id
  returning * into v_row;

  if not found then
    raise exception 'incident_not_found: %', p_incident_id using errcode = 'P0002';
  end if;

  insert into admin.admin_audit_log (
    occurred_at, admin_user_id, action, target_kind, target_id, payload
  ) values (
    now(), v_actor, 'status.incident_resolved',
    'status_incident', p_incident_id,
    jsonb_build_object('postmortem_url', p_postmortem_url)
  );

  return v_row;
end;
$$;

grant execute on function admin.resolve_status_incident(uuid, text, text)
  to authenticated, cs_admin;

comment on table public.status_subsystems is 'ADR-1018 — monitored subsystems surfaced on the public status page.';
comment on table public.status_checks     is 'ADR-1018 — probe history, one row per health check per subsystem.';
comment on table public.status_incidents  is 'ADR-1018 — operator-posted incidents with lifecycle + postmortem link.';
