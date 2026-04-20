-- Migration: ADR-0052 Sprint 1.1 — dispute contest-submission fields + RPCs.
--
-- Extends public.disputes with contest-preparation metadata so the operator
-- workflow is:
--   1. Assemble evidence bundle (ADR-0050 Sprint 3.2)
--   2. Prepare contest packet (this sprint) — authored summary + bundle ref
--   3. Submit to Razorpay (manual today, auto in Sprint 1.2)
--   4. Mark submitted → status flips to `under_review`; Razorpay eventually
--      webhooks back dispute.won / dispute.lost / dispute.closed
--
-- Existing dispute lifecycle (ADR-0050 Sprint 3.2) stays intact. The
-- `submitted_at` column on public.disputes was introduced there but never
-- wired to a dedicated RPC; this migration consolidates the state flip
-- into the new `billing_dispute_mark_contest_submitted` RPC.

alter table public.disputes
  add column if not exists contest_summary               text,
  add column if not exists contest_packet_r2_key         text,
  add column if not exists contest_packet_prepared_at    timestamptz,
  add column if not exists contest_razorpay_response     jsonb;

-- ============================================================================
-- 1. admin.billing_dispute_prepare_contest
--
-- Records the operator's authored contest summary + a pointer to the
-- evidence bundle ZIP (already in R2 via ADR-0050). Does NOT call Razorpay.
-- Idempotent: re-preparing overwrites the summary and bumps the timestamp.
-- ============================================================================
create or replace function admin.billing_dispute_prepare_contest(
  p_dispute_id uuid,
  p_summary    text,
  p_packet_r2_key text default null  -- defaults to dispute.evidence_bundle_r2_key
)
returns void
language plpgsql
security definer
set search_path = admin, public, pg_catalog
as $$
declare
  v_operator uuid := auth.uid();
  v_status   text;
  v_bundle_key text;
begin
  perform admin.require_admin('platform_operator');

  if length(coalesce(p_summary, '')) < 20 then
    raise exception 'contest_summary must be at least 20 characters';
  end if;

  select status, evidence_bundle_r2_key
    into v_status, v_bundle_key
    from public.disputes
   where id = p_dispute_id;

  if v_status is null then
    raise exception 'dispute_not_found' using errcode = '42501';
  end if;

  if v_status in ('won', 'lost', 'closed') then
    raise exception 'cannot_prepare_contest_from_resolved_status:%', v_status;
  end if;

  if v_bundle_key is null and p_packet_r2_key is null then
    raise exception 'no_evidence_bundle: call assemble_evidence_bundle first or pass p_packet_r2_key';
  end if;

  update public.disputes
     set contest_summary             = p_summary,
         contest_packet_r2_key       = coalesce(p_packet_r2_key, v_bundle_key),
         contest_packet_prepared_at  = now()
   where id = p_dispute_id;

  insert into admin.admin_audit_log
    (admin_user_id, action, target_table, target_id, org_id, old_value, new_value, reason)
  values
    (v_operator, 'billing_dispute_contest_prepared', 'public.disputes', p_dispute_id, null,
     null,
     jsonb_build_object('summary_chars', length(p_summary), 'packet_r2_key', coalesce(p_packet_r2_key, v_bundle_key)),
     'Contest packet prepared for Razorpay submission');
end;
$$;

revoke execute on function admin.billing_dispute_prepare_contest(uuid, text, text) from public;
grant execute on function admin.billing_dispute_prepare_contest(uuid, text, text)
  to cs_admin, authenticated;

-- ============================================================================
-- 2. admin.billing_dispute_mark_contest_submitted
--
-- After the operator submits to Razorpay (manual today, via API in Sprint
-- 1.2), records the submission event. Stamps submitted_at, flips status
-- to `under_review`, and stores the response payload (Razorpay API
-- response for auto-submit; null or `{manual: true}` for manual submit).
-- ============================================================================
create or replace function admin.billing_dispute_mark_contest_submitted(
  p_dispute_id uuid,
  p_response   jsonb default null
)
returns void
language plpgsql
security definer
set search_path = admin, public, pg_catalog
as $$
declare
  v_operator uuid := auth.uid();
  v_status   text;
  v_has_packet boolean;
begin
  perform admin.require_admin('platform_operator');

  select status, contest_packet_prepared_at is not null
    into v_status, v_has_packet
    from public.disputes where id = p_dispute_id;

  if v_status is null then
    raise exception 'dispute_not_found' using errcode = '42501';
  end if;

  if not v_has_packet then
    raise exception 'contest_packet_not_prepared: call billing_dispute_prepare_contest first';
  end if;

  if v_status not in ('open', 'under_review') then
    raise exception 'cannot_submit_from_status:%', v_status;
  end if;

  update public.disputes
     set status                    = 'under_review',
         submitted_at              = coalesce(submitted_at, now()),
         contest_razorpay_response = coalesce(p_response, jsonb_build_object('manual', true, 'submitted_at', now()))
   where id = p_dispute_id;

  insert into admin.admin_audit_log
    (admin_user_id, action, target_table, target_id, org_id, old_value, new_value, reason)
  values
    (v_operator, 'billing_dispute_contest_submitted', 'public.disputes', p_dispute_id, null,
     jsonb_build_object('status', v_status),
     jsonb_build_object('status', 'under_review', 'has_response', p_response is not null),
     'Contest submitted to Razorpay');
end;
$$;

revoke execute on function admin.billing_dispute_mark_contest_submitted(uuid, jsonb) from public;
grant execute on function admin.billing_dispute_mark_contest_submitted(uuid, jsonb)
  to cs_admin, authenticated;
