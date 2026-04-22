-- ADR-1004 Sprint 1.1 — Regulatory Exemption Engine schema.
--
-- A row in regulatory_exemptions declares "under <statute>, data categories
-- <X, Y, Z> must be retained for <period> for <sector>/<purposes>". The
-- deletion orchestrator (process-artefact-revocation, modified in Sprint
-- 1.4) consults applicable_exemptions() before creating any deletion_receipt
-- — categories covered by an active exemption are stripped from the receipt
-- payload and logged in retention_suppressions.
--
-- Platform defaults (org_id IS NULL) ship as migrations and are visible to
-- every org; per-org overrides (org_id = <uuid>) are owned by that org and
-- win via lower `precedence`. Schema mirrors admin.feature_flags (ADR-0036)
-- which uses the same (null = global, uuid = override) pattern.

-- ============================================================================
-- 1. regulatory_exemptions
-- ============================================================================

create table if not exists public.regulatory_exemptions (
  id                    uuid primary key default gen_random_uuid(),
  org_id                uuid references public.organisations(id) on delete cascade,
  sector                text not null,
  statute               text not null,
  statute_code          text not null,
  data_categories       text[] not null default '{}',
  retention_period      interval,
  source_citation       text,
  precedence            integer not null default 100,
  applies_to_purposes   text[],
  legal_review_notes    text,
  reviewed_at           timestamptz,
  reviewer_name         text,
  reviewer_firm         text,
  is_active             boolean not null default true,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

-- Sector enum is encoded as a CHECK, not an enum type, so adding future
-- sectors does not require an ALTER TYPE. Values mirror
-- organisations.industry (ADR-0057 Sprint 1.1) plus `all` as an escape
-- hatch for cross-sector statutes (e.g. IT Act §43A).
alter table public.regulatory_exemptions
  drop constraint if exists regulatory_exemptions_sector_check;
alter table public.regulatory_exemptions
  add constraint regulatory_exemptions_sector_check
  check (sector in (
    'saas', 'edtech', 'healthcare', 'ecommerce', 'hrtech',
    'fintech', 'bfsi', 'general', 'all'
  ));

-- A single (statute_code, org_id) tuple may exist at most once. Platform
-- default rows use a literal sentinel uuid for the index because Postgres
-- treats NULLs as non-equal in a unique constraint.
create unique index if not exists regulatory_exemptions_statute_org_uq
  on public.regulatory_exemptions (
    statute_code,
    coalesce(org_id, '00000000-0000-0000-0000-000000000000'::uuid)
  );

create index if not exists idx_regulatory_exemptions_lookup
  on public.regulatory_exemptions (sector, is_active, precedence)
  where is_active;

create index if not exists idx_regulatory_exemptions_org
  on public.regulatory_exemptions (org_id)
  where org_id is not null;

-- updated_at trigger: reuse the project's shared helper.
drop trigger if exists trg_regulatory_exemptions_updated_at
  on public.regulatory_exemptions;
create trigger trg_regulatory_exemptions_updated_at
  before update on public.regulatory_exemptions
  for each row execute function public.set_updated_at();

-- ============================================================================
-- 2. RLS
-- ============================================================================

alter table public.regulatory_exemptions enable row level security;

-- Platform defaults (org_id IS NULL) are visible to any authenticated user.
-- Per-org rows are only visible to members of that org.
drop policy if exists regulatory_exemptions_select on public.regulatory_exemptions;
create policy regulatory_exemptions_select
  on public.regulatory_exemptions
  for select to authenticated
  using (
    org_id is null
    or org_id = public.current_org_id()
  );

-- Customers cannot mutate platform defaults; only account_owner (ADR-0044
-- account-tier role) can insert/update/delete rows scoped to their own org.
-- Uses public.current_account_role() which reads the caller's role from
-- account_memberships for the current_account_id().
drop policy if exists regulatory_exemptions_insert on public.regulatory_exemptions;
create policy regulatory_exemptions_insert
  on public.regulatory_exemptions
  for insert to authenticated
  with check (
    org_id is not null
    and org_id = public.current_org_id()
    and public.current_account_role() = 'account_owner'
  );

drop policy if exists regulatory_exemptions_update on public.regulatory_exemptions;
create policy regulatory_exemptions_update
  on public.regulatory_exemptions
  for update to authenticated
  using (
    org_id is not null
    and org_id = public.current_org_id()
    and public.current_account_role() = 'account_owner'
  )
  with check (
    org_id is not null
    and org_id = public.current_org_id()
    and public.current_account_role() = 'account_owner'
  );

drop policy if exists regulatory_exemptions_delete on public.regulatory_exemptions;
create policy regulatory_exemptions_delete
  on public.regulatory_exemptions
  for delete to authenticated
  using (
    org_id is not null
    and org_id = public.current_org_id()
    and public.current_account_role() = 'account_owner'
  );

-- ============================================================================
-- 3. retention_suppressions — audit rows written by the orchestrator
--    when an exemption blocks (some or all) categories from a deletion
-- ============================================================================

create table if not exists public.retention_suppressions (
  id                         uuid primary key default gen_random_uuid(),
  org_id                     uuid not null references public.organisations(id) on delete cascade,
  artefact_id                text not null,
  artefact_uuid              uuid references public.consent_artefacts(id) on delete set null,
  revocation_id              uuid references public.artefact_revocations(id) on delete set null,
  exemption_id               uuid not null references public.regulatory_exemptions(id) on delete restrict,
  suppressed_data_categories text[] not null,
  statute                    text not null,
  statute_code               text not null,
  source_citation            text,
  suppressed_at              timestamptz not null default now(),
  created_at                 timestamptz not null default now()
);

create index if not exists idx_retention_suppressions_artefact
  on public.retention_suppressions (org_id, artefact_id);

create index if not exists idx_retention_suppressions_exemption
  on public.retention_suppressions (exemption_id);

create index if not exists idx_retention_suppressions_time
  on public.retention_suppressions (org_id, suppressed_at desc);

alter table public.retention_suppressions enable row level security;

drop policy if exists retention_suppressions_select on public.retention_suppressions;
create policy retention_suppressions_select
  on public.retention_suppressions
  for select to authenticated
  using (org_id = public.current_org_id());

-- This is an audit table. Writes happen only inside the Edge Function via
-- cs_orchestrator; no INSERT/UPDATE/DELETE policy is exposed to the
-- `authenticated` role. Sprint 1.4 adds the GRANT to cs_orchestrator.

grant select on public.retention_suppressions to authenticated;

-- ============================================================================
-- 4. cs_orchestrator grants (needed for Sprint 1.4 orchestrator integration)
-- ============================================================================

grant select on public.regulatory_exemptions  to cs_orchestrator;
grant insert on public.retention_suppressions to cs_orchestrator;

-- ============================================================================
-- 5. applicable_exemptions(p_org_id, p_purpose_code) — precedence-sorted
-- ============================================================================
--
-- Returns the active exemptions that apply to the given org + purpose,
-- ordered by precedence ascending (lower number wins). Includes both
-- platform defaults (org_id IS NULL) AND per-org overrides (org_id = p_org_id).
--
-- Call-site semantics in Sprint 1.4:
--   for each exemption row, subtract exemption.data_categories from the
--   deletion's data_scope. If the intersection is non-empty, record a
--   retention_suppressions row with the intersected categories. If all
--   categories are covered, the deletion is fully suppressed (no receipt).

create or replace function public.applicable_exemptions(
  p_org_id       uuid,
  p_purpose_code text
)
returns table (
  id                 uuid,
  org_id             uuid,
  sector             text,
  statute            text,
  statute_code       text,
  data_categories    text[],
  retention_period   interval,
  source_citation    text,
  precedence         integer,
  applies_to_purposes text[]
)
language sql
stable
security definer
set search_path = public, extensions, pg_catalog
as $$
  select
    e.id,
    e.org_id,
    e.sector,
    e.statute,
    e.statute_code,
    e.data_categories,
    e.retention_period,
    e.source_citation,
    e.precedence,
    e.applies_to_purposes
    from public.regulatory_exemptions e
    join public.organisations o on o.id = p_org_id
   where e.is_active
     and (e.org_id is null or e.org_id = p_org_id)
     and (
       e.applies_to_purposes is null
       or array_length(e.applies_to_purposes, 1) is null
       or p_purpose_code = any (e.applies_to_purposes)
     )
     and (e.sector = 'all' or e.sector = o.industry)
   order by e.precedence asc, e.statute_code asc;
$$;

revoke all on function public.applicable_exemptions(uuid, text) from public;
grant execute on function public.applicable_exemptions(uuid, text)
  to authenticated, cs_orchestrator;

comment on function public.applicable_exemptions(uuid, text) is
  'ADR-1004 Sprint 1.1 — returns active regulatory exemptions (platform '
  'defaults + per-org overrides) applicable to the given org + purpose, '
  'ordered by precedence ascending. Called from process-artefact-revocation '
  'before creating deletion_receipts.';

comment on table public.regulatory_exemptions is
  'ADR-1004 Phase 1 — Regulatory Exemption Engine. Rows with org_id IS NULL '
  'are platform defaults (shipped as seed migrations); rows with org_id '
  'NOT NULL are per-org overrides. Lower precedence wins when multiple '
  'rules apply.';

comment on table public.retention_suppressions is
  'ADR-1004 Sprint 1.4 — audit trail of every time an exemption blocked '
  'some or all data categories from a deletion. Written by the Edge '
  'Function; surfaced in the customer dashboard and audit export.';
