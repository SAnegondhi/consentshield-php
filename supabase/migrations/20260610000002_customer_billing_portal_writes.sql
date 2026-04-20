-- Migration: ADR-0054 Sprint 1.2 — Customer billing portal (write path).
--
-- Adds:
--   public.account_audit_log             — account-level audit events (non-membership)
--   public.update_account_billing_profile(...)  — account_owner writes; validated;
--                                                  audit-logged.
--
-- Complements the membership_audit_log from ADR-0047 — that table tracks
-- membership changes; this one tracks account-scoped settings changes.

-- ============================================================================
-- 1. public.account_audit_log
-- ============================================================================
create table if not exists public.account_audit_log (
  id              bigserial   primary key,
  occurred_at     timestamptz not null default now(),
  account_id      uuid        not null references public.accounts(id) on delete cascade,
  actor_user_id   uuid        not null,
  action          text        not null check (action in (
                    'billing_profile_update'
                  )),
  old_value       jsonb,
  new_value       jsonb,
  reason          text
);

create index if not exists account_audit_log_account_idx
  on public.account_audit_log (account_id, occurred_at desc);

alter table public.account_audit_log enable row level security;

-- account_owner of the account can SELECT their account's audit rows.
-- (Future: surface as an "Account activity" section in the UI.)
drop policy if exists account_audit_log_read_by_owner on public.account_audit_log;
create policy account_audit_log_read_by_owner on public.account_audit_log
  for select to authenticated
  using (
    exists (
      select 1 from public.account_memberships am
       where am.account_id = account_audit_log.account_id
         and am.user_id = auth.uid()
         and am.role = 'account_owner'
    )
    or (auth.jwt() -> 'app_metadata' ->> 'is_admin')::boolean = true
  );

revoke insert, update, delete on public.account_audit_log from authenticated, anon;
grant select, insert on public.account_audit_log to cs_orchestrator;

-- ============================================================================
-- 2. public.update_account_billing_profile
--
-- Called by the customer /dashboard/settings/billing page. Restricted to
-- account_owner (not account_viewer). Validates every field before write.
-- Every write emits an account_audit_log row with before/after JSON so the
-- GSTIN / billing address / state code history is preserved (the issuer
-- needs to match at invoice issuance time — ADR-0050 Rule 19).
-- ============================================================================
create or replace function public.update_account_billing_profile(
  p_legal_name  text,
  p_gstin       text,  -- nullable (optional)
  p_state_code  text,
  p_address     text,
  p_email       text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_uid         uuid := public.current_uid();
  v_role        text;
  v_account_id  uuid;
  v_old         jsonb;
  v_new         jsonb;
begin
  v_role := public.current_account_role();
  if v_role is null or v_role != 'account_owner' then
    raise exception 'access_denied' using errcode = '42501';
  end if;

  v_account_id := public.current_account_id();
  if v_account_id is null then
    raise exception 'no_account_context' using errcode = '42501';
  end if;

  -- ──── Field validation ────
  if length(coalesce(p_legal_name, '')) < 2 or length(p_legal_name) > 200 then
    raise exception 'invalid_legal_name: must be 2 to 200 characters';
  end if;

  -- GSTIN format: 2 digits (state) + 5 alpha + 4 digits + 1 alpha + 1 alphanum + Z + 1 alphanum
  if p_gstin is not null and p_gstin <> '' then
    if p_gstin !~ '^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$' then
      raise exception 'invalid_gstin: must match GSTIN format (15 chars, e.g. 29ABCDE1234F1Z5)';
    end if;
  end if;

  -- State code: 2-digit Indian state code (01-37)
  if p_state_code is null or p_state_code !~ '^(0[1-9]|[1-2][0-9]|3[0-7])$' then
    raise exception 'invalid_state_code: must be a 2-digit Indian state code (e.g. 29 for Karnataka)';
  end if;

  if length(coalesce(p_address, '')) < 1 or length(p_address) > 500 then
    raise exception 'invalid_address: must be 1 to 500 characters';
  end if;

  -- Minimal email format check
  if p_email is null or p_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
    raise exception 'invalid_email';
  end if;

  -- ──── Capture old state for audit ────
  select jsonb_build_object(
    'billing_legal_name', billing_legal_name,
    'billing_gstin',      billing_gstin,
    'billing_state_code', billing_state_code,
    'billing_address',    billing_address,
    'billing_email',      billing_email
  ) into v_old
    from public.accounts
   where id = v_account_id;

  -- ──── Apply update ────
  update public.accounts
     set billing_legal_name         = p_legal_name,
         billing_gstin              = nullif(p_gstin, ''),
         billing_state_code         = p_state_code,
         billing_address            = p_address,
         billing_email              = p_email,
         billing_profile_updated_at = now()
   where id = v_account_id;

  -- ──── Audit log ────
  v_new := jsonb_build_object(
    'billing_legal_name', p_legal_name,
    'billing_gstin',      nullif(p_gstin, ''),
    'billing_state_code', p_state_code,
    'billing_address',    p_address,
    'billing_email',      p_email
  );

  insert into public.account_audit_log (account_id, actor_user_id, action, old_value, new_value)
    values (v_account_id, v_uid, 'billing_profile_update', v_old, v_new);

  return jsonb_build_object('ok', true, 'updated_at', now());
end;
$$;

revoke execute on function public.update_account_billing_profile(text, text, text, text, text) from public;
grant execute on function public.update_account_billing_profile(text, text, text, text, text) to authenticated;

-- ============================================================================
-- Verification (manual)
-- ============================================================================
-- select proname from pg_proc where pronamespace = 'public'::regnamespace
--   and proname = 'update_account_billing_profile';
-- select polname from pg_policies where tablename = 'account_audit_log';
