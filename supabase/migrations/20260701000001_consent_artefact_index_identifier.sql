-- ADR-1002 Sprint 1.1 — Extend consent_artefact_index for identifier-based lookup.
--
-- Current shape (pre-DEPA stub + 20260418000008 framework/purpose_code):
--   (id, org_id, artefact_id, validity_state, expires_at, created_at, framework, purpose_code)
--
-- Problem: /v1/consent/verify needs to query by
--   (property_id, data_principal_identifier, identifier_type, purpose_code)
-- and must distinguish `revoked` from `never_consented`. The existing revocation
-- cascade trigger DELETEs the row — this migration replaces it with UPDATE so
-- revoked rows remain queryable.
--
-- All new columns are nullable — web-channel artefacts (Mode A) have no
-- customer-supplied identifier. Only Mode B (ADR-1002 Sprint 2.1) will populate
-- identifier_hash + identifier_type.

-- ── 1. New columns ────────────────────────────────────────────────────────────

alter table public.consent_artefact_index
  add column if not exists property_id          uuid references public.web_properties(id) on delete cascade,
  add column if not exists identifier_hash      text,
  add column if not exists identifier_type      text check (identifier_type in ('email','phone','pan','aadhaar','custom')),
  add column if not exists consent_event_id     uuid references public.consent_events(id) on delete set null,
  add column if not exists revoked_at           timestamptz,
  add column if not exists revocation_record_id uuid references public.artefact_revocations(id) on delete set null;

comment on column public.consent_artefact_index.property_id is
  'The web_property this artefact was issued against. Nullable during the '
  'transition (2026-04-20); all new rows written by the pipeline carry it.';

comment on column public.consent_artefact_index.identifier_hash is
  'SHA-256(normalised_identifier || '':'' || organisations.encryption_salt). '
  'NULL for Mode A (web-channel anonymous consent). Populated only by '
  '/v1/consent/record (ADR-1002 Sprint 2.1). The plaintext identifier is '
  'NEVER stored — Rule 3 (regulated sensitive content) applies strictly to '
  'identifier_type=aadhaar/pan; for email/phone the hash-only storage also '
  'serves as a defence against identifier enumeration.';

comment on column public.consent_artefact_index.identifier_type is
  'Type tag the caller used when hashing. Callers must pass the SAME type '
  'to /v1/consent/verify; the resolver hashes the candidate with this type '
  'before matching. No cross-type matching is allowed.';

-- ── 2. Hot-path partial index ─────────────────────────────────────────────────

create index if not exists idx_consent_artefact_index_identifier_hot
  on public.consent_artefact_index (org_id, property_id, identifier_hash, purpose_code)
  where validity_state = 'active' and identifier_hash is not null;

-- ── 3. hash_data_principal_identifier helper ──────────────────────────────────
-- Uses the per-org encryption_salt (already provisioned per Rule 11) so that
-- identical identifiers in two orgs produce different hashes. Rejects empty
-- input to force caller-side validation.

create or replace function public.hash_data_principal_identifier(
  p_org_id          uuid,
  p_identifier      text,
  p_identifier_type text
) returns text
language plpgsql
security definer
set search_path = public, extensions, pg_catalog
as $$
declare
  v_normalised text;
  v_salt       text;
begin
  if p_identifier is null or length(trim(p_identifier)) = 0 then
    raise exception 'identifier is empty' using errcode = '22023';
  end if;

  if p_identifier_type not in ('email','phone','pan','aadhaar','custom') then
    raise exception 'unknown identifier_type: %', p_identifier_type using errcode = '22023';
  end if;

  -- Normalise per type. Same normalisation rule MUST be applied at write time
  -- (record endpoint) and read time (verify endpoint); this function is the
  -- single source of truth.
  v_normalised := case p_identifier_type
    when 'email'  then lower(trim(p_identifier))
    when 'phone'  then regexp_replace(p_identifier, '\D', '', 'g')
    when 'pan'    then upper(trim(p_identifier))
    when 'aadhaar' then regexp_replace(p_identifier, '\D', '', 'g')
    when 'custom' then trim(p_identifier)
  end;

  if length(v_normalised) = 0 then
    raise exception 'identifier normalises to empty' using errcode = '22023';
  end if;

  select encryption_salt into v_salt
    from public.organisations
   where id = p_org_id;

  if v_salt is null then
    raise exception 'organisation % has no encryption_salt', p_org_id using errcode = '42P01';
  end if;

  return encode(extensions.digest(v_normalised || ':' || v_salt, 'sha256'), 'hex');
end;
$$;

revoke all on function public.hash_data_principal_identifier(uuid, text, text) from public;
grant execute on function public.hash_data_principal_identifier(uuid, text, text) to authenticated, service_role, cs_orchestrator;

comment on function public.hash_data_principal_identifier(uuid, text, text) is
  'ADR-1002 Sprint 1.1 — normalise + salted-SHA256 of a data principal '
  'identifier. Normalisation rules: email=lowercase+trim; phone/aadhaar='
  'digits only; pan=uppercase+trim; custom=trim. Single source of truth '
  'for both /v1/consent/record and /v1/consent/verify.';

-- ── 4. Replace revocation cascade trigger ─────────────────────────────────────
-- Old behaviour: DELETE FROM consent_artefact_index on revoke.
-- New behaviour: UPDATE validity_state + revoked_at + revocation_record_id.
-- Revoked rows remain queryable so /v1/consent/verify can return `revoked`
-- rather than `never_consented`.

create or replace function public.trg_artefact_revocation_cascade()
returns trigger language plpgsql security definer as $$
begin
  update public.consent_artefacts
     set status = 'revoked'
   where artefact_id = new.artefact_id
     and status = 'active';

  if not found then
    raise exception 'Cannot revoke artefact %: not found or not active', new.artefact_id;
  end if;

  -- ADR-1002 Sprint 1.1 — preserve the row for audit + verify; stamp revoked_at
  -- and the pointer back to artefact_revocations. Was DELETE before 2026-04-20.
  update public.consent_artefact_index
     set validity_state       = 'revoked',
         revoked_at            = now(),
         revocation_record_id  = new.id
   where artefact_id = new.artefact_id
     and validity_state = 'active';

  update public.consent_expiry_queue
     set superseded = true
   where artefact_id = new.artefact_id
     and processed_at is null;

  insert into public.audit_log (org_id, event_type, entity_type, entity_id, payload)
  values (
    new.org_id,
    'consent_artefact_revoked',
    'consent_artefacts',
    (select id from public.consent_artefacts where artefact_id = new.artefact_id),
    jsonb_build_object(
      'artefact_id', new.artefact_id,
      'reason',      new.reason,
      'revoked_by',  new.revoked_by_type
    )
  );

  return new;
end;
$$;

-- The trigger itself is recreated from 20260418000005 and remains unchanged.
-- CREATE OR REPLACE on the function is enough; the trigger binding is intact.

-- ── 5. cs_orchestrator needs update on the new columns (used by scheduled jobs) ──

grant update (validity_state, revoked_at, revocation_record_id) on public.consent_artefact_index to cs_orchestrator;
