-- ADR-0011 Sprint 1.1 — schema for the deletion retry / timeout pipeline.
--
-- Adds a `next_retry_at` timestamp so the hourly `check-stuck-deletions`
-- Edge Function can cheaply find receipts whose backoff window has elapsed.
-- Extends the cs_orchestrator UPDATE column grant to include the new field.

alter table deletion_receipts
  add column if not exists next_retry_at timestamptz;

-- Partial index: keeps the hourly scan bounded to receipts that are actually
-- candidates for retry (most rows are `delivered`, `confirmed`, or `failed`).
create index if not exists idx_deletion_receipts_retry
  on deletion_receipts (next_retry_at)
  where status = 'awaiting_callback';

-- Extend the scoped-role column grant from migration 010.
-- We must revoke the existing column-list grant and re-grant with the new
-- column; PostgreSQL does not support "add column to existing column grant".
revoke update (status, confirmed_at, response_payload, failure_reason, retry_count)
  on deletion_receipts from cs_orchestrator;

grant update (status, confirmed_at, response_payload, failure_reason, retry_count, next_retry_at)
  on deletion_receipts to cs_orchestrator;
