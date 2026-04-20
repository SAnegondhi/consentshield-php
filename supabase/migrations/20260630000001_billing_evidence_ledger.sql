-- Migration: ADR-0051 Sprint 1.1 — billing.evidence_ledger + trigger capture.
--
-- Dedicated append-only log of chargeback-relevant events captured AT THE
-- MOMENT they happen — not aggregated from other tables at dispute time.
-- Feeds the dispute-bundle assembler (ADR-0050 Sprint 3.2) with structured
-- event history that `admin_audit_log` + webhook verbatim store don't cover
-- in a uniform shape.
--
-- Write path: trigger-driven from `admin.admin_audit_log` (billing_* actions)
-- and `billing.razorpay_webhook_events` (subscription/payment/invoice events),
-- plus a direct trigger on `public.invoices.email_delivered_at` for invoice
-- email receipts. No application-code RPC edits required — purely database-
-- level capture.
--
-- Rule 3: metadata is category-only (webhook event_id, audit_log row id,
-- invoice id, truncated actor references). Never holds PII / body bytes.

-- ============================================================================
-- 1. billing.evidence_ledger
-- ============================================================================
create table if not exists billing.evidence_ledger (
  id              uuid        primary key default gen_random_uuid(),
  account_id      uuid        not null references public.accounts(id) on delete cascade,
  org_id          uuid        references public.organisations(id) on delete set null,
  event_type      text        not null check (event_type in (
                    -- plan / billing actions
                    'admin_plan_change',
                    'admin_refund_issued',
                    'admin_plan_adjustment',
                    'admin_account_suspended',
                    'admin_account_restored',
                    -- subscription lifecycle (from Razorpay webhooks)
                    'subscription_activated',
                    'subscription_charged',
                    'subscription_cancelled',
                    'subscription_paused',
                    'subscription_resumed',
                    'payment_captured',
                    'payment_failed',
                    -- invoice lifecycle
                    'invoice_issued',
                    'invoice_emailed',
                    'invoice_paid',
                    'invoice_voided',
                    -- dispute
                    'dispute_opened',
                    'dispute_resolved'
                  )),
  event_source    text        not null check (event_source in (
                    'admin_audit_trigger',
                    'webhook_trigger',
                    'invoice_trigger',
                    'rpc_direct'
                  )),
  occurred_at     timestamptz not null,
  actor_user_id   uuid,
  actor_admin_id  uuid,
  source_ref      text,         -- pointer back to source row (audit_log id, webhook event_id, invoice id)
  metadata        jsonb        not null default '{}'::jsonb,
  created_at      timestamptz  not null default now()
);

create index if not exists evidence_ledger_account_idx
  on billing.evidence_ledger (account_id, occurred_at desc);
create index if not exists evidence_ledger_event_type_idx
  on billing.evidence_ledger (event_type, occurred_at desc);
create index if not exists evidence_ledger_source_ref_idx
  on billing.evidence_ledger (source_ref)
  where source_ref is not null;

alter table billing.evidence_ledger enable row level security;

-- cs_admin: SELECT only (dispute bundle assembly + future ledger viewer)
revoke all on billing.evidence_ledger from public, authenticated, anon;
grant select on billing.evidence_ledger to cs_admin;
grant select, insert on billing.evidence_ledger to cs_orchestrator;

-- Append-only for all app-code roles; no UPDATE / DELETE policies.
create policy evidence_ledger_read_admin on billing.evidence_ledger
  for select to cs_admin
  using (true);

-- ============================================================================
-- 2. Helper: billing.record_evidence_event (for future direct-call capture points)
-- ============================================================================
create or replace function billing.record_evidence_event(
  p_account_id    uuid,
  p_org_id        uuid,
  p_event_type    text,
  p_event_source  text,
  p_occurred_at   timestamptz,
  p_actor_user_id uuid,
  p_actor_admin_id uuid,
  p_source_ref    text,
  p_metadata      jsonb
)
returns uuid
language plpgsql
security definer
set search_path = billing, public, pg_catalog
as $$
declare
  v_id uuid;
begin
  if p_account_id is null then
    raise exception 'account_id required';
  end if;

  insert into billing.evidence_ledger (
    account_id, org_id, event_type, event_source, occurred_at,
    actor_user_id, actor_admin_id, source_ref, metadata
  )
  values (
    p_account_id, p_org_id, p_event_type, p_event_source, p_occurred_at,
    p_actor_user_id, p_actor_admin_id, p_source_ref, coalesce(p_metadata, '{}'::jsonb)
  )
  returning id into v_id;

  return v_id;
end;
$$;

revoke execute on function billing.record_evidence_event(uuid, uuid, text, text, timestamptz, uuid, uuid, text, jsonb) from public;
grant execute on function billing.record_evidence_event(uuid, uuid, text, text, timestamptz, uuid, uuid, text, jsonb)
  to cs_admin, cs_orchestrator;

-- ============================================================================
-- 3. Trigger: admin.admin_audit_log → billing.evidence_ledger
--
-- Fires on AFTER INSERT for action values that matter for chargeback defense.
-- Resolves account_id from target_id / org_id on the audit row.
-- ============================================================================
create or replace function billing.evidence_capture_from_audit_log()
returns trigger
language plpgsql
security definer
set search_path = billing, admin, public, pg_catalog
as $$
declare
  v_event_type text;
  v_account_id uuid;
  v_org_id     uuid;
begin
  v_event_type := case NEW.action
    when 'billing_plan_change'         then 'admin_plan_change'
    when 'billing_upsert_plan_adjustment' then 'admin_plan_adjustment'
    when 'billing_create_refund'       then 'admin_refund_issued'
    when 'billing_suspend_account'     then 'admin_account_suspended'
    when 'billing_restore_account'     then 'admin_account_restored'
    else null
  end;

  if v_event_type is null then
    return NEW;
  end if;

  -- Resolve account_id. Prefer target_id when target_table is 'public.accounts';
  -- otherwise fall back to the org's account_id.
  if NEW.target_table = 'public.accounts' and NEW.target_id is not null then
    v_account_id := NEW.target_id;
  elsif NEW.org_id is not null then
    select account_id into v_account_id
      from public.organisations where id = NEW.org_id;
    v_org_id := NEW.org_id;
  end if;

  if v_account_id is null then
    -- Can't place this event on a ledger timeline; skip (not every audit row
    -- has billing context).
    return NEW;
  end if;

  insert into billing.evidence_ledger (
    account_id, org_id, event_type, event_source, occurred_at,
    actor_admin_id, source_ref, metadata
  )
  values (
    v_account_id, v_org_id, v_event_type, 'admin_audit_trigger', NEW.occurred_at,
    NEW.admin_user_id, NEW.id::text,
    jsonb_build_object(
      'action',       NEW.action,
      'target_table', NEW.target_table,
      'reason',       NEW.reason,
      'old_value',    NEW.old_value,
      'new_value',    NEW.new_value
    )
  );

  return NEW;
end;
$$;

drop trigger if exists evidence_capture_from_audit_log_trigger on admin.admin_audit_log;
create trigger evidence_capture_from_audit_log_trigger
  after insert on admin.admin_audit_log
  for each row execute function billing.evidence_capture_from_audit_log();

-- ============================================================================
-- 4. Trigger: billing.razorpay_webhook_events → billing.evidence_ledger
--
-- Only capture events that are material to chargeback defense; skip the
-- high-volume verbatim rows that aren't state transitions.
-- ============================================================================
create or replace function billing.evidence_capture_from_webhook()
returns trigger
language plpgsql
security definer
set search_path = billing, public, pg_catalog
as $$
declare
  v_event_type text;
  v_payment_id text;
begin
  if NEW.account_id is null then
    return NEW;
  end if;

  v_event_type := case NEW.event_type
    when 'subscription.activated' then 'subscription_activated'
    when 'subscription.charged'   then 'subscription_charged'
    when 'subscription.cancelled' then 'subscription_cancelled'
    when 'subscription.paused'    then 'subscription_paused'
    when 'subscription.resumed'   then 'subscription_resumed'
    when 'payment.captured'       then 'payment_captured'
    when 'payment.failed'         then 'payment_failed'
    when 'invoice.paid'           then 'invoice_paid'
    when 'dispute.created'        then 'dispute_opened'
    when 'dispute.won'            then 'dispute_resolved'
    when 'dispute.lost'           then 'dispute_resolved'
    when 'dispute.closed'         then 'dispute_resolved'
    else null
  end;

  if v_event_type is null then
    return NEW;
  end if;

  v_payment_id := NEW.payload->'payload'->'payment'->'entity'->>'id';

  insert into billing.evidence_ledger (
    account_id, event_type, event_source, occurred_at, source_ref, metadata
  )
  values (
    NEW.account_id, v_event_type, 'webhook_trigger', NEW.received_at, NEW.event_id,
    jsonb_build_object(
      'razorpay_event_id',   NEW.event_id,
      'razorpay_event_type', NEW.event_type,
      'payment_id',          v_payment_id,
      'signature_verified',  NEW.signature_verified
    )
  );

  return NEW;
end;
$$;

drop trigger if exists evidence_capture_from_webhook_trigger on billing.razorpay_webhook_events;
create trigger evidence_capture_from_webhook_trigger
  after insert on billing.razorpay_webhook_events
  for each row execute function billing.evidence_capture_from_webhook();

-- ============================================================================
-- 5. Trigger: public.invoices → billing.evidence_ledger (issued + emailed + voided)
-- ============================================================================
create or replace function billing.evidence_capture_from_invoice()
returns trigger
language plpgsql
security definer
set search_path = billing, public, pg_catalog
as $$
begin
  -- Invoice issued: fires on INSERT when issued_at is already set (the issue
  -- RPC stamps it at creation).
  if TG_OP = 'INSERT' and NEW.issued_at is not null then
    insert into billing.evidence_ledger (
      account_id, event_type, event_source, occurred_at, source_ref, metadata
    )
    values (
      NEW.account_id, 'invoice_issued', 'invoice_trigger', NEW.issued_at, NEW.id::text,
      jsonb_build_object(
        'invoice_id',     NEW.id,
        'invoice_number', NEW.invoice_number,
        'total_paise',    NEW.total_paise,
        'issuer_id',      NEW.issuer_entity_id
      )
    );
  end if;

  -- Invoice emailed: fires on UPDATE when email_delivered_at transitions
  -- from null to not-null.
  if TG_OP = 'UPDATE'
     and OLD.email_delivered_at is null
     and NEW.email_delivered_at is not null then
    insert into billing.evidence_ledger (
      account_id, event_type, event_source, occurred_at, source_ref, metadata
    )
    values (
      NEW.account_id, 'invoice_emailed', 'invoice_trigger', NEW.email_delivered_at, NEW.id::text,
      jsonb_build_object(
        'invoice_id',       NEW.id,
        'invoice_number',   NEW.invoice_number,
        'email_message_id', NEW.email_message_id
      )
    );
  end if;

  -- Invoice voided: fires on UPDATE when status transitions to 'void'.
  if TG_OP = 'UPDATE'
     and (OLD.status is distinct from NEW.status)
     and NEW.status = 'void' then
    insert into billing.evidence_ledger (
      account_id, event_type, event_source, occurred_at, source_ref, metadata
    )
    values (
      NEW.account_id, 'invoice_voided', 'invoice_trigger',
      coalesce(NEW.voided_at, now()), NEW.id::text,
      jsonb_build_object(
        'invoice_id',     NEW.id,
        'invoice_number', NEW.invoice_number,
        'voided_reason',  NEW.voided_reason
      )
    );
  end if;

  return NEW;
end;
$$;

drop trigger if exists evidence_capture_from_invoice_trigger on public.invoices;
create trigger evidence_capture_from_invoice_trigger
  after insert or update on public.invoices
  for each row execute function billing.evidence_capture_from_invoice();

-- ============================================================================
-- 6. admin.billing_evidence_ledger_for_account — scoped list RPC
-- ============================================================================
create or replace function admin.billing_evidence_ledger_for_account(
  p_account_id uuid,
  p_from       timestamptz default null,
  p_to         timestamptz default null,
  p_limit      int          default 500
)
returns setof billing.evidence_ledger
language plpgsql
security definer
set search_path = admin, billing, public, pg_catalog
as $$
begin
  perform admin.require_admin('platform_operator');

  return query
  select *
    from billing.evidence_ledger
   where account_id = p_account_id
     and (p_from is null or occurred_at >= p_from)
     and (p_to   is null or occurred_at <= p_to)
   order by occurred_at desc, id
   limit p_limit;
end;
$$;

revoke execute on function admin.billing_evidence_ledger_for_account(uuid, timestamptz, timestamptz, int) from public;
grant execute on function admin.billing_evidence_ledger_for_account(uuid, timestamptz, timestamptz, int) to cs_admin;
