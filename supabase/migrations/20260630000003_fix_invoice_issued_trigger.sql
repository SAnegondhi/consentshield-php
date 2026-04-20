-- Migration: ADR-0051 Sprint 1.1 follow-up — fix invoice_issued trigger to
-- fire on `issued_at` null→ts transition (the admin RPC `billing_issue_invoice`
-- creates rows with issued_at = null, and `billing_finalize_invoice_pdf`
-- stamps it later). The original INSERT-only check missed this sequence.

create or replace function billing.evidence_capture_from_invoice()
returns trigger
language plpgsql
security definer
set search_path = billing, public, pg_catalog
as $$
begin
  -- Invoice issued: fires on INSERT when issued_at is already set, OR on
  -- UPDATE when issued_at transitions from null to not-null (via the
  -- finalize RPC).
  if (TG_OP = 'INSERT' and NEW.issued_at is not null)
     or (TG_OP = 'UPDATE' and OLD.issued_at is null and NEW.issued_at is not null) then
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
