-- ADR-1017 Sprint 1.1 — admin.ops_readiness_flags table + RPCs + seed.
--
-- Surfaces external / organisational blockers (legal counsel, partner
-- engagement, infra provisioning, SE hiring) in the operator console so
-- they can't be forgotten between ADR sprint handoffs.

-- ============================================================================
-- 1. Table + constraints + indexes
-- ============================================================================

create table if not exists admin.ops_readiness_flags (
  id             uuid primary key default gen_random_uuid(),
  title          text not null,
  description    text not null,
  source_adr     text not null,
  blocker_type   text not null,
  severity       text not null default 'medium',
  status         text not null default 'pending',
  owner          text,
  resolution_notes text,
  resolved_by    uuid references auth.users(id) on delete set null,
  resolved_at    timestamptz,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

alter table admin.ops_readiness_flags
  drop constraint if exists ops_readiness_flags_blocker_type_check;
alter table admin.ops_readiness_flags
  add constraint ops_readiness_flags_blocker_type_check
  check (blocker_type in (
    'legal', 'partner', 'infra', 'contract', 'hiring', 'other'
  ));

alter table admin.ops_readiness_flags
  drop constraint if exists ops_readiness_flags_severity_check;
alter table admin.ops_readiness_flags
  add constraint ops_readiness_flags_severity_check
  check (severity in ('critical', 'high', 'medium', 'low'));

alter table admin.ops_readiness_flags
  drop constraint if exists ops_readiness_flags_status_check;
alter table admin.ops_readiness_flags
  add constraint ops_readiness_flags_status_check
  check (status in ('pending', 'in_progress', 'resolved', 'deferred'));

create index if not exists idx_ops_readiness_flags_status_severity
  on admin.ops_readiness_flags (status, severity);

create index if not exists idx_ops_readiness_flags_source_adr
  on admin.ops_readiness_flags (source_adr);

drop trigger if exists trg_ops_readiness_flags_updated_at
  on admin.ops_readiness_flags;
create trigger trg_ops_readiness_flags_updated_at
  before update on admin.ops_readiness_flags
  for each row execute function public.set_updated_at();

comment on table admin.ops_readiness_flags is
  'ADR-1017 — pending external / organisational blockers tracked from '
  'ADR sprint backlogs (legal counsel, partner engagement, infra '
  'provisioning, SE hiring, contract terms). One row per blocker; '
  'operators see a list view + a dashboard banner for pending '
  'high/critical severity. status=resolved/deferred rows are still '
  'visible for history.';

-- ============================================================================
-- 2. RLS — gated on is_admin JWT claim (same pattern as admin.feature_flags)
-- ============================================================================

alter table admin.ops_readiness_flags enable row level security;

drop policy if exists ops_readiness_flags_admin_all on admin.ops_readiness_flags;
create policy ops_readiness_flags_admin_all
  on admin.ops_readiness_flags
  for all to authenticated
  using (admin.is_admin())
  with check (admin.is_admin());

grant select, insert, update on admin.ops_readiness_flags
  to authenticated, cs_admin;

-- ============================================================================
-- 3. RPCs
-- ============================================================================

-- 3.1 list_ops_readiness_flags — returns all rows, pending/in_progress first.
create or replace function admin.list_ops_readiness_flags()
returns table (
  id               uuid,
  title            text,
  description      text,
  source_adr       text,
  blocker_type     text,
  severity         text,
  status           text,
  owner            text,
  resolution_notes text,
  resolved_by      uuid,
  resolved_by_email text,
  resolved_at      timestamptz,
  created_at       timestamptz,
  updated_at       timestamptz
)
language sql
stable
security definer
set search_path = admin, public, extensions, pg_catalog
as $$
  select
    f.id, f.title, f.description, f.source_adr, f.blocker_type,
    f.severity, f.status, f.owner, f.resolution_notes,
    f.resolved_by, u.email::text as resolved_by_email,
    f.resolved_at, f.created_at, f.updated_at
    from admin.ops_readiness_flags f
    left join auth.users u on u.id = f.resolved_by
   where admin.is_admin()
   order by
     case f.status
       when 'pending' then 0
       when 'in_progress' then 1
       when 'deferred' then 2
       when 'resolved' then 3
     end,
     case f.severity
       when 'critical' then 0
       when 'high' then 1
       when 'medium' then 2
       when 'low' then 3
     end,
     f.created_at desc;
$$;

grant execute on function admin.list_ops_readiness_flags()
  to authenticated, cs_admin;

-- 3.2 set_ops_readiness_flag_status — operator-tier only; audit-logged.
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
  v_role text := admin.current_admin_role();
  v_actor uuid;
  v_row admin.ops_readiness_flags%rowtype;
begin
  perform admin.require_admin('support');
  -- Extra gate: only platform_operator / platform_owner may resolve;
  -- support tier can mark in_progress but not resolved/deferred.
  if p_status in ('resolved', 'deferred')
     and v_role not in ('platform_operator', 'platform_owner') then
    raise exception 'platform_operator or platform_owner required to mark %', p_status
      using errcode = '42501';
  end if;

  if p_status not in ('pending', 'in_progress', 'resolved', 'deferred') then
    raise exception 'invalid_status: %', p_status using errcode = '22023';
  end if;

  v_actor := auth.uid();

  update admin.ops_readiness_flags
     set status            = p_status,
         resolution_notes  = coalesce(p_resolution_notes, resolution_notes),
         resolved_by       = case when p_status in ('resolved', 'deferred') then v_actor else null end,
         resolved_at       = case when p_status in ('resolved', 'deferred') then now() else null end
   where id = p_flag_id
  returning * into v_row;

  if not found then
    raise exception 'flag_not_found: %', p_flag_id using errcode = 'P0002';
  end if;

  insert into admin.admin_audit_log (
    occurred_at, admin_user_id, action, target_kind, target_id, payload
  ) values (
    now(),
    v_actor,
    'ops_readiness_flag.status_changed',
    'ops_readiness_flag',
    p_flag_id,
    jsonb_build_object(
      'new_status', p_status,
      'notes',      p_resolution_notes,
      'source_adr', v_row.source_adr,
      'severity',   v_row.severity
    )
  );

  return v_row;
end;
$$;

grant execute on function admin.set_ops_readiness_flag_status(uuid, text, text)
  to authenticated, cs_admin;

-- ============================================================================
-- 4. Seed the six current known blockers
-- ============================================================================

insert into admin.ops_readiness_flags (
  title, description, source_adr, blocker_type, severity, status, owner
) values
  (
    'Engage Indian regulatory counsel for BFSI + Healthcare exemption review',
    'Every row in public.regulatory_exemptions ships with '
    'reviewed_at IS NULL and a PENDING_LEGAL_REVIEW marker. Customer '
    'dashboard renders a "pending legal review" badge on each. Engage '
    'counsel (BFSI focus + Healthcare focus, one firm or two); budget '
    '~INR 2-3 lakh. On signoff, UPDATE reviewed_at + reviewer_name + '
    'reviewer_firm + legal_review_notes per reviewed row and flip this '
    'flag to resolved.',
    'ADR-1004 Sprint 1.6',
    'legal',
    'high',
    'pending',
    'Sudhindra (procurement)'
  ),
  (
    'Identify + onboard a webhook reference partner',
    'Marketing-asset only (per 2026-04-22 ADR-1005 Phase 1 scope '
    'amendment). Find one friendly partner (Hyderabad fintech without a '
    'ConsentShield contract; fallback: internal sample backend on '
    'separate Vercel project). Exercise the full webhook protocol in '
    'production-like conditions (>= 100 deletions). Anonymised case '
    'study at docs/case-studies/webhook-reference-2026-Q2.md. Not '
    'blocking any other ADR / phase.',
    'ADR-1005 Phase 1',
    'partner',
    'medium',
    'pending',
    'Sudhindra (GTM)'
  ),
  (
    'Provision PagerDuty account + define on-call rotation',
    'Primary on-call: founder for IST business hours; contractor for '
    'nights/weekends. Incident-creation hotkey on operator dashboard '
    'routes to PagerDuty + status page. Post-incident template at '
    'docs/templates/post-incident-report.md. Until this lands, there '
    'is no paging channel for SEV1/SEV2 incidents.',
    'ADR-1005 Sprint 3.2',
    'infra',
    'high',
    'pending',
    'Sudhindra (procurement)'
  ),
  (
    'Draft SLA docs + severity matrix + BFSI Enterprise contract Schedule B',
    'docs/support/sla.md with 99.5/99.9/99.95 per-tier commitments; '
    'docs/support/severity-matrix.md with SEV1 data loss -> 30 min etc. '
    'BFSI Enterprise contract template needs SLA as Schedule B before '
    'first BFSI Enterprise customer can sign. Not blocking dev; blocks '
    'first BFSI procurement review.',
    'ADR-1005 Sprint 3.1',
    'contract',
    'medium',
    'pending',
    'Sudhindra (legal/commercial)'
  ),
  (
    'Decide SE capacity: hire FT vs contract; name >= 2 contractors',
    'If contract: >= 2 named contractors with BFSI integration '
    'experience + rate cards agreed. If hire: job spec + search + '
    'target start date. BFSI pipeline cap of 2 simultaneous '
    'integrations stays until SE online; sales ops informed.',
    'ADR-1005 Sprint 3.3',
    'hiring',
    'high',
    'pending',
    'Sudhindra (org)'
  ),
  (
    'Cloudflare Worker — wrangler cutover to cs_worker direct-Postgres',
    'Phase 3 Worker source rewrite must ship first. Then: '
    '`wrangler secret put SUPABASE_WORKER_DATABASE_URL=<pooler URL>` + '
    '`wrangler secret delete SUPABASE_WORKER_KEY` + redeploy + smoke '
    'test (banner.js serves; signed event writes a consent_events '
    'row). Standing permission: claude-code may execute the wrangler '
    'commands with operator confirmation, per 2026-04-22 session. '
    'Legacy HS256 kill-timer makes this time-sensitive.',
    'ADR-1010 Phase 4',
    'infra',
    'critical',
    'pending',
    'Sudhindra / claude-code'
  );
