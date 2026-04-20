-- Migration: ADR-0048 follow-up — `public.assert_org_not_suspended(p_org_id)`.
--
-- Helper used by compliance-workflow write RPCs (DPIA records, auditor
-- engagements) to refuse advancement when the parent account is
-- suspended or the org itself is suspended. Raises cleanly so the UI
-- can surface a suspension-specific error instead of a generic
-- access_denied.
--
-- Write RPCs that DO NOT get this gate (intentional):
--   · update_account_billing_profile — customer needs to update billing to pay their way out
--   · update_org_industry            — harmless and no compliance impact
--   · create_invitation / membership — team management must keep working
--   · billing_issue_invoice          — admin-side; operator decides
--
-- This is additive. Existing RPCs continue to work until they opt in.

create or replace function public.assert_org_not_suspended(p_org_id uuid)
returns void
language plpgsql
stable
security definer
set search_path = public, pg_catalog
as $$
declare
  v_account_id uuid;
  v_org_status text;
  v_acc_status text;
begin
  select o.account_id, o.status
    into v_account_id, v_org_status
    from public.organisations o
   where o.id = p_org_id;

  if v_org_status is null then
    raise exception 'org_not_found' using errcode = '42501';
  end if;

  if v_org_status = 'suspended' then
    raise exception 'org_suspended' using errcode = '42501';
  end if;

  if v_account_id is not null then
    select a.status into v_acc_status
      from public.accounts a where a.id = v_account_id;

    if v_acc_status = 'suspended' then
      raise exception 'account_suspended' using errcode = '42501';
    end if;
  end if;
end;
$$;

revoke execute on function public.assert_org_not_suspended(uuid) from public;
grant execute on function public.assert_org_not_suspended(uuid) to authenticated;

-- ============================================================================
-- Wire the gate into compliance-workflow write RPCs.
-- ============================================================================

-- DPIA records — create/publish/supersede refuse during suspension.
create or replace function public.create_dpia_record(
  p_org_id                  uuid,
  p_title                   text,
  p_processing_description  text,
  p_data_categories         jsonb,
  p_risk_level              text,
  p_mitigations             jsonb,
  p_auditor_attestation_ref text,
  p_auditor_name            text,
  p_conducted_at            date,
  p_next_review_at          date
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_uid        uuid := public.current_uid();
  v_eff_role   text;
  v_id         uuid;
begin
  if v_uid is null then
    raise exception 'no_auth_context' using errcode = '42501';
  end if;

  v_eff_role := public.effective_org_role(p_org_id);
  if v_eff_role is null or v_eff_role not in ('org_admin', 'admin') then
    raise exception 'access_denied' using errcode = '42501';
  end if;

  perform public.assert_org_not_suspended(p_org_id);

  if p_conducted_at is null then
    raise exception 'conducted_at required';
  end if;
  if p_next_review_at is not null and p_next_review_at < p_conducted_at then
    raise exception 'next_review_at cannot precede conducted_at';
  end if;

  insert into public.dpia_records (
    org_id, title, processing_description, data_categories, risk_level,
    mitigations, auditor_attestation_ref, auditor_name,
    conducted_at, next_review_at, status, created_by
  ) values (
    p_org_id, p_title, p_processing_description,
    coalesce(p_data_categories, '[]'::jsonb), p_risk_level,
    coalesce(p_mitigations, '{}'::jsonb), p_auditor_attestation_ref, p_auditor_name,
    p_conducted_at, p_next_review_at, 'draft', v_uid
  )
  returning id into v_id;

  return v_id;
end;
$$;

create or replace function public.publish_dpia_record(p_dpia_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_org_id     uuid;
  v_status     text;
  v_eff_role   text;
begin
  select org_id, status into v_org_id, v_status
    from public.dpia_records where id = p_dpia_id;

  if v_org_id is null then
    raise exception 'dpia_not_found' using errcode = '42501';
  end if;

  v_eff_role := public.effective_org_role(v_org_id);
  if v_eff_role is null or v_eff_role not in ('org_admin', 'admin') then
    raise exception 'access_denied' using errcode = '42501';
  end if;

  perform public.assert_org_not_suspended(v_org_id);

  if v_status != 'draft' then
    raise exception 'cannot_publish_from_status:%', v_status;
  end if;

  update public.dpia_records
     set status = 'published', published_at = now()
   where id = p_dpia_id;
end;
$$;

-- Auditor engagements — create/complete/update refuse during suspension.
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

  perform public.assert_org_not_suspended(p_org_id);

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
