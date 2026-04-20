-- Migration: ADR-0046 Phase 3 — Data Auditor Engagements.
--
-- Adds `public.data_auditor_engagements` so SDF-designated organisations
-- can record their independent auditor engagements under DPDP §10(c).
--
-- Rule 3 respected:
--   · `auditor_name` is the firm name (public identity, not personal data)
--   · `registration_category` is a category declaration (e.g. 'ca_firm',
--     'sebi_registered') — never the actual PAN or firm registration number
--   · `attestation_ref` is a URL / pointer to customer-held audit artefacts —
--     never the audit report bytes
--
-- A single row per audit cycle. Associated DPIA records reference this
-- engagement via `dpia_records.auditor_attestation_ref` (string match) —
-- no hard FK so DPIA lifecycle stays independent.

-- ============================================================================
-- 1. public.data_auditor_engagements
-- ============================================================================
create table if not exists public.data_auditor_engagements (
  id                     uuid        primary key default gen_random_uuid(),
  org_id                 uuid        not null references public.organisations(id) on delete cascade,
  auditor_name           text        not null check (length(auditor_name) between 2 and 200),
  -- Category declarations only — not the actual registration number
  registration_category  text        not null check (registration_category in (
                            'ca_firm',
                            'sebi_registered',
                            'iso_27001_certified_cb',
                            'dpdp_empanelled',
                            'rbi_empanelled',
                            'other'
                         )),
  registration_ref       text        check (registration_ref is null or length(registration_ref) <= 500),
  scope                  text        not null check (length(scope) between 3 and 2000),
  engagement_start       date        not null,
  engagement_end         date,
  attestation_ref        text        check (attestation_ref is null or length(attestation_ref) <= 500),
  status                 text        not null default 'active'
                           check (status in ('active','completed','terminated')),
  notes                  text        check (notes is null or length(notes) <= 2000),
  terminated_reason      text,
  created_by             uuid        not null references auth.users(id),
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);

create index if not exists auditor_engagements_org_idx
  on public.data_auditor_engagements (org_id, status, engagement_start desc);
create index if not exists auditor_engagements_active_idx
  on public.data_auditor_engagements (org_id)
  where status = 'active';

alter table public.data_auditor_engagements enable row level security;

-- Read: any member of the org (account_owner inheritance via effective_org_role)
drop policy if exists auditor_engagements_read on public.data_auditor_engagements;
create policy auditor_engagements_read on public.data_auditor_engagements
  for select to authenticated
  using (public.effective_org_role(org_id) is not null);

revoke insert, update, delete on public.data_auditor_engagements from authenticated, anon, public;
grant select on public.data_auditor_engagements to authenticated;
grant select, insert, update on public.data_auditor_engagements to cs_orchestrator;

-- ============================================================================
-- 2. updated_at trigger
-- ============================================================================
create or replace function public.data_auditor_engagements_set_updated_at()
returns trigger
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
begin
  NEW.updated_at := now();
  return NEW;
end;
$$;

drop trigger if exists auditor_engagements_updated_at_trigger on public.data_auditor_engagements;
create trigger auditor_engagements_updated_at_trigger
  before update on public.data_auditor_engagements
  for each row execute function public.data_auditor_engagements_set_updated_at();

-- ============================================================================
-- 3. public.create_auditor_engagement
-- ============================================================================
create or replace function public.create_auditor_engagement(
  p_org_id                uuid,
  p_auditor_name          text,
  p_registration_category text,
  p_registration_ref      text,
  p_scope                 text,
  p_engagement_start      date,
  p_attestation_ref       text
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_uid      uuid := public.current_uid();
  v_role     text;
  v_id       uuid;
begin
  if v_uid is null then
    raise exception 'no_auth_context' using errcode = '42501';
  end if;

  v_role := public.effective_org_role(p_org_id);
  if v_role is null or v_role not in ('org_admin', 'admin') then
    raise exception 'access_denied' using errcode = '42501';
  end if;

  if p_engagement_start is null then
    raise exception 'engagement_start required';
  end if;

  insert into public.data_auditor_engagements (
    org_id, auditor_name, registration_category, registration_ref,
    scope, engagement_start, attestation_ref, status, created_by
  ) values (
    p_org_id, p_auditor_name, p_registration_category, p_registration_ref,
    p_scope, p_engagement_start, p_attestation_ref, 'active', v_uid
  )
  returning id into v_id;

  return v_id;
end;
$$;

revoke execute on function public.create_auditor_engagement(uuid, text, text, text, text, date, text) from public;
grant execute on function public.create_auditor_engagement(uuid, text, text, text, text, date, text) to authenticated;

-- ============================================================================
-- 4. public.complete_auditor_engagement
-- ============================================================================
create or replace function public.complete_auditor_engagement(
  p_id              uuid,
  p_engagement_end  date,
  p_attestation_ref text
)
returns void
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_org_id uuid;
  v_status text;
  v_start  date;
  v_role   text;
begin
  select org_id, status, engagement_start
    into v_org_id, v_status, v_start
    from public.data_auditor_engagements where id = p_id;
  if v_org_id is null then
    raise exception 'engagement_not_found' using errcode = '42501';
  end if;

  v_role := public.effective_org_role(v_org_id);
  if v_role is null or v_role not in ('org_admin', 'admin') then
    raise exception 'access_denied' using errcode = '42501';
  end if;

  if v_status != 'active' then
    raise exception 'cannot_complete_from_status:%', v_status;
  end if;

  if p_engagement_end is null or p_engagement_end < v_start then
    raise exception 'engagement_end must be on or after engagement_start';
  end if;

  update public.data_auditor_engagements
     set status = 'completed',
         engagement_end = p_engagement_end,
         attestation_ref = coalesce(p_attestation_ref, attestation_ref)
   where id = p_id;
end;
$$;

revoke execute on function public.complete_auditor_engagement(uuid, date, text) from public;
grant execute on function public.complete_auditor_engagement(uuid, date, text) to authenticated;

-- ============================================================================
-- 5. public.terminate_auditor_engagement
-- ============================================================================
create or replace function public.terminate_auditor_engagement(
  p_id              uuid,
  p_engagement_end  date,
  p_reason          text
)
returns void
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_org_id uuid;
  v_status text;
  v_role   text;
begin
  if length(coalesce(p_reason, '')) < 3 then
    raise exception 'reason required';
  end if;

  select org_id, status
    into v_org_id, v_status
    from public.data_auditor_engagements where id = p_id;
  if v_org_id is null then
    raise exception 'engagement_not_found' using errcode = '42501';
  end if;

  v_role := public.effective_org_role(v_org_id);
  if v_role is null or v_role not in ('org_admin', 'admin') then
    raise exception 'access_denied' using errcode = '42501';
  end if;

  if v_status != 'active' then
    raise exception 'cannot_terminate_from_status:%', v_status;
  end if;

  update public.data_auditor_engagements
     set status = 'terminated',
         engagement_end = p_engagement_end,
         terminated_reason = p_reason
   where id = p_id;
end;
$$;

revoke execute on function public.terminate_auditor_engagement(uuid, date, text) from public;
grant execute on function public.terminate_auditor_engagement(uuid, date, text) to authenticated;

-- ============================================================================
-- 6. public.update_auditor_engagement (editable fields on active rows)
-- ============================================================================
create or replace function public.update_auditor_engagement(
  p_id              uuid,
  p_scope           text,
  p_notes           text,
  p_attestation_ref text
)
returns void
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_org_id uuid;
  v_status text;
  v_role   text;
begin
  select org_id, status
    into v_org_id, v_status
    from public.data_auditor_engagements where id = p_id;
  if v_org_id is null then
    raise exception 'engagement_not_found' using errcode = '42501';
  end if;

  v_role := public.effective_org_role(v_org_id);
  if v_role is null or v_role not in ('org_admin', 'admin') then
    raise exception 'access_denied' using errcode = '42501';
  end if;

  -- Allow editing scope/notes/attestation on active OR completed;
  -- terminated rows are frozen.
  if v_status = 'terminated' then
    raise exception 'cannot_update_terminated_engagement';
  end if;

  update public.data_auditor_engagements
     set scope = coalesce(p_scope, scope),
         notes = p_notes,
         attestation_ref = coalesce(p_attestation_ref, attestation_ref)
   where id = p_id;
end;
$$;

revoke execute on function public.update_auditor_engagement(uuid, text, text, text) from public;
grant execute on function public.update_auditor_engagement(uuid, text, text, text) to authenticated;
