-- ADR-1014 Sprint 3.4 follow-up — grant cs_orchestrator SELECT on deletion_receipts.
--
-- `public.rpc_deletion_receipt_confirm` (migration 20260414000005) is SECURITY
-- DEFINER owned by cs_orchestrator and begins with:
--
--   select org_id, status into v_org_id, v_status
--     from deletion_receipts where id = p_receipt_id;
--
-- The scoped-roles migration 20260413000010 granted cs_orchestrator INSERT
-- and UPDATE(status, confirmed_at, response_payload, failure_reason,
-- retry_count) on deletion_receipts — but NOT SELECT. The RPC has therefore
-- been latently broken: any call fails with `permission denied for table
-- deletion_receipts` at the SELECT before reaching the state-machine logic.
--
-- Not tripped in production yet because the customer-facing deletion
-- callback flow hadn't been exercised end-to-end against live data —
-- connectors are pending, and the only prior test coverage was RPC-external.
-- ADR-1014 Sprint 3.4's `tests/integration/deletion-receipt-confirm.test.ts`
-- is the first thing that actually calls the RPC; all 8 state-machine cases
-- failed with the above error.
--
-- Fix is strictly additive: grant SELECT so the SECURITY DEFINER body can
-- read the row. The EXECUTE grant to anon is unchanged (the route-handler
-- authentication boundary is the signed-callback HMAC, enforced before the
-- RPC is called — see app/src/lib/rights/callback-signing.ts).

grant select on deletion_receipts to cs_orchestrator;

comment on column deletion_receipts.status is
  'State machine: pending | awaiting_callback | confirmed | partial | failed | completed. '
  'cs_orchestrator reads this in rpc_deletion_receipt_confirm to gate state transitions; '
  'SELECT grant added 2026-04-23 under ADR-1014 Sprint 3.4.';
