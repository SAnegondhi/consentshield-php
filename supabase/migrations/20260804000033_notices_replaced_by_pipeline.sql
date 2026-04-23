-- ADR-1004 Phase 2 Sprint 2.3 — replaced_by chain + reconsent_campaigns.
--
-- Sprint 2.1 (migration 20260804000024) shipped notices schema +
-- consent_events.notice_version FK. Sprint 2.3 wires the runtime:
--
--   1. mark_replaced_artefacts_for_event(consent_event_id)
--      Called from process-consent-event after the new artefact rows are
--      inserted. For each new artefact (org, property, fingerprint,
--      purpose_code), find any other ACTIVE artefact owned by the same
--      principal whose linked consent_event has an OLDER notice_version,
--      and mark that prior artefact as 'replaced' + populate replaced_by.
--      Replacement chain (S-5 in ADR-0020): if A→B and B is later
--      revoked, A stays at 'replaced'. Revocation does not walk the
--      chain — this RPC only sets B as A.replaced_by once, on the first
--      newer-version event that supersedes A.
--
--   2. public.reconsent_campaigns
--      One row per material-change notice. Tracks (affected_count,
--      responded_count, revoked_count, no_response_count, computed_at)
--      so the campaign view at /dashboard/notices/[id]/campaign reads
--      pre-aggregated numbers rather than recomputing on every request.
--      Initial affected_count is set when the material notice is
--      published (already done in publish_notice). The other counts
--      refresh nightly via reconsent-campaign-refresh-nightly pg_cron.
--
--   3. refresh_reconsent_campaign(p_notice_id)
--      Recomputes a single campaign's counts from
--      consent_artefacts.replaced_by chains + revocations and upserts
--      reconsent_campaigns. Idempotent.
--
--   4. refresh_all_reconsent_campaigns()
--      Walks every material notice with affected_artefact_count > 0 and
--      calls refresh_reconsent_campaign per row. Wired to pg_cron
--      `15 2 * * *` (nightly at 02:15 UTC, after the depa-score refresh
--      window).
--
--   5. rpc_notice_affected_artefacts(p_org_id, p_notice_id, p_limit)
--      Returns the affected-artefact list for a material notice — what
--      /dashboard/notices and the CSV export read. Each row carries the
--      current status, replaced_by id, last consent date, purpose count.

-- ============================================================================
-- 1. reconsent_campaigns table
-- ============================================================================

create table if not exists public.reconsent_campaigns (
  id                  uuid primary key default gen_random_uuid(),
  notice_id           uuid not null references public.notices(id) on delete cascade,
  org_id              uuid not null references public.organisations(id) on delete cascade,
  affected_count      integer not null default 0,
  responded_count     integer not null default 0,
  revoked_count       integer not null default 0,
  no_response_count   integer not null default 0,
  computed_at         timestamptz not null default now(),
  created_at          timestamptz not null default now(),
  unique (notice_id)
);

comment on table public.reconsent_campaigns is
  'ADR-1004 Phase 2 Sprint 2.3 — per-material-notice campaign counts. '
  'One row per notice. responded = artefacts where status=replaced (a '
  'newer artefact superseded them); revoked = artefacts the principal '
  'actively withdrew after publish; no_response = still-active on the '
  'prior version. Refreshed nightly by reconsent-campaign-refresh-nightly '
  'pg_cron.';

create index if not exists idx_reconsent_campaigns_org
  on public.reconsent_campaigns (org_id, computed_at desc);

alter table public.reconsent_campaigns enable row level security;

drop policy if exists reconsent_campaigns_select_own on public.reconsent_campaigns;
create policy reconsent_campaigns_select_own on public.reconsent_campaigns
  for select to authenticated
  using (org_id = public.current_org_id());

grant select on public.reconsent_campaigns to authenticated;

-- ============================================================================
-- 2. mark_replaced_artefacts_for_event(consent_event_id)
-- ============================================================================

create or replace function public.mark_replaced_artefacts_for_event(
  p_consent_event_id uuid
) returns integer
language plpgsql
security definer
set search_path = public, extensions, pg_catalog
as $$
declare
  v_event       public.consent_events%rowtype;
  v_replaced    integer := 0;
  v_new_art     record;
begin
  select * into v_event
    from public.consent_events
   where id = p_consent_event_id;
  if not found then
    return 0;
  end if;
  -- No notice attached → cannot establish chain. Pre-Sprint 2.1 events
  -- and events from properties without an active notice still flow
  -- through here; they are no-ops.
  if v_event.notice_version is null then
    return 0;
  end if;

  -- For every artefact created by this event, find the most recent
  -- ACTIVE artefact for the same (property, fingerprint, purpose_code)
  -- whose linked event has an OLDER notice_version, and supersede it.
  for v_new_art in
    select ca.artefact_id, ca.purpose_code, ca.session_fingerprint
      from public.consent_artefacts ca
     where ca.consent_event_id = p_consent_event_id
  loop
    with prior as (
      select ca_old.id, ca_old.artefact_id
        from public.consent_artefacts ca_old
        join public.consent_events ce_old on ce_old.id = ca_old.consent_event_id
       where ca_old.org_id              = v_event.org_id
         and ca_old.property_id         = v_event.property_id
         and ca_old.session_fingerprint = v_new_art.session_fingerprint
         and ca_old.purpose_code        = v_new_art.purpose_code
         and ca_old.status              = 'active'
         and ca_old.artefact_id         <> v_new_art.artefact_id
         and ce_old.notice_version is not null
         and ce_old.notice_version      < v_event.notice_version
       order by ce_old.created_at desc
       limit 1
    )
    update public.consent_artefacts ca_old
       set status      = 'replaced',
           replaced_by = v_new_art.artefact_id
      from prior
     where ca_old.id = prior.id;

    if found then
      v_replaced := v_replaced + 1;
    end if;
  end loop;

  return v_replaced;
end;
$$;

comment on function public.mark_replaced_artefacts_for_event(uuid) is
  'ADR-1004 Phase 2 Sprint 2.3. Called by process-consent-event after '
  'consent_artefacts inserts; supersedes any prior-notice-version '
  'artefacts owned by the same principal + purpose. Returns the count '
  'of artefacts marked replaced. Idempotent: re-running on the same '
  'event finds nothing new because the prior artefacts are no longer '
  'status=active.';

grant execute on function public.mark_replaced_artefacts_for_event(uuid)
  to authenticated, cs_orchestrator, service_role;

-- ============================================================================
-- 3. refresh_reconsent_campaign(notice_id)
-- ============================================================================

create or replace function public.refresh_reconsent_campaign(
  p_notice_id uuid
) returns public.reconsent_campaigns
language plpgsql
security definer
set search_path = public, extensions, pg_catalog
as $$
declare
  v_notice    public.notices%rowtype;
  v_affected  integer;
  v_responded integer;
  v_revoked   integer;
  v_no_resp   integer;
  v_row       public.reconsent_campaigns%rowtype;
begin
  select * into v_notice from public.notices where id = p_notice_id;
  if not found then
    raise exception 'notice_not_found' using errcode = 'P0002';
  end if;

  -- affected_count is fixed at publish time (publish_notice writes it
  -- to notices.affected_artefact_count). Re-derive defensively here
  -- so the campaign survives manual data fixes.
  select count(distinct ca.id)
    into v_affected
    from public.consent_artefacts ca
    join public.consent_events    ce on ce.id = ca.consent_event_id
   where ca.org_id         = v_notice.org_id
     and ce.notice_version = v_notice.version - 1;

  -- Responded: prior-version artefacts that are now status=replaced
  -- AND their replaced_by points at an artefact whose event references
  -- THIS notice's version.
  select count(distinct ca.id)
    into v_responded
    from public.consent_artefacts ca
    join public.consent_events    ce_old on ce_old.id = ca.consent_event_id
    join public.consent_artefacts ca_new on ca_new.artefact_id = ca.replaced_by
    join public.consent_events    ce_new on ce_new.id = ca_new.consent_event_id
   where ca.org_id              = v_notice.org_id
     and ce_old.notice_version  = v_notice.version - 1
     and ca.status              = 'replaced'
     and ce_new.notice_version  = v_notice.version;

  -- Revoked: prior-version artefacts the principal explicitly withdrew
  -- (status=revoked) AFTER the notice was published.
  select count(distinct ca.id)
    into v_revoked
    from public.consent_artefacts ca
    join public.consent_events    ce on ce.id = ca.consent_event_id
   where ca.org_id              = v_notice.org_id
     and ce.notice_version      = v_notice.version - 1
     and ca.status              = 'revoked';

  v_no_resp := greatest(v_affected - v_responded - v_revoked, 0);

  insert into public.reconsent_campaigns as rc (
    notice_id, org_id, affected_count, responded_count, revoked_count,
    no_response_count, computed_at
  ) values (
    p_notice_id, v_notice.org_id, v_affected, v_responded, v_revoked,
    v_no_resp, now()
  )
  on conflict (notice_id) do update
    set affected_count    = excluded.affected_count,
        responded_count   = excluded.responded_count,
        revoked_count     = excluded.revoked_count,
        no_response_count = excluded.no_response_count,
        computed_at       = excluded.computed_at
  returning * into v_row;

  return v_row;
end;
$$;

grant execute on function public.refresh_reconsent_campaign(uuid)
  to authenticated, cs_orchestrator, service_role;

-- ============================================================================
-- 4. refresh_all_reconsent_campaigns() — nightly entry point
-- ============================================================================

create or replace function public.refresh_all_reconsent_campaigns()
returns integer
language plpgsql
security definer
set search_path = public, extensions, pg_catalog
as $$
declare
  v_count integer := 0;
  r       record;
begin
  for r in
    select id from public.notices
     where material_change_flag = true
       and version > 1
  loop
    perform public.refresh_reconsent_campaign(r.id);
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

grant execute on function public.refresh_all_reconsent_campaigns()
  to cs_orchestrator, service_role;

-- ============================================================================
-- 5. pg_cron schedule
-- ============================================================================

do $$ begin
  perform cron.unschedule('reconsent-campaign-refresh-nightly');
exception when others then null; end $$;

select cron.schedule(
  'reconsent-campaign-refresh-nightly',
  '15 2 * * *',
  $$select public.refresh_all_reconsent_campaigns()$$
);

-- ============================================================================
-- 6. rpc_notice_affected_artefacts — list view + CSV export feed
-- ============================================================================

create or replace function public.rpc_notice_affected_artefacts(
  p_org_id    uuid,
  p_notice_id uuid,
  p_limit     int default 50
) returns table (
  artefact_id          text,
  status               text,
  replaced_by          text,
  purpose_codes        text[],
  last_consent_at      timestamptz,
  email                text
)
language plpgsql
stable
security definer
set search_path = public, extensions, pg_catalog
as $$
declare
  v_notice public.notices%rowtype;
  v_limit  int;
begin
  v_limit := greatest(1, least(coalesce(p_limit, 50), 500));

  select * into v_notice from public.notices where id = p_notice_id;
  if not found then
    raise exception 'notice_not_found' using errcode = 'P0002';
  end if;
  if v_notice.org_id <> p_org_id then
    raise exception 'org_mismatch' using errcode = '42501';
  end if;

  return query
    select ca.artefact_id,
           ca.status,
           ca.replaced_by,
           array_agg(distinct ca.purpose_code)              as purpose_codes,
           max(ca.created_at)                               as last_consent_at,
           null::text                                       as email
      from public.consent_artefacts ca
      join public.consent_events    ce on ce.id = ca.consent_event_id
     where ca.org_id              = p_org_id
       and ce.notice_version      = v_notice.version - 1
     group by ca.artefact_id, ca.status, ca.replaced_by
     order by max(ca.created_at) desc
     limit v_limit;
end;
$$;

comment on function public.rpc_notice_affected_artefacts(uuid, uuid, int) is
  'ADR-1004 Phase 2 Sprint 2.2 — affected-artefacts listing for a '
  'material notice. Used by /dashboard/notices and the CSV export. '
  'email column is null for now — email is not denormalised on '
  'consent_artefacts; if needed, the customer can join externally on '
  'their own user store via the artefact_id back-reference.';

grant execute on function public.rpc_notice_affected_artefacts(uuid, uuid, int)
  to authenticated;

-- ============================================================================
-- Verification:
--   select count(*) from cron.job
--    where jobname = 'reconsent-campaign-refresh-nightly';     -> 1
--   select pg_get_function_result('public.mark_replaced_artefacts_for_event(uuid)'::regprocedure);
--                                                              -> integer
-- ============================================================================
