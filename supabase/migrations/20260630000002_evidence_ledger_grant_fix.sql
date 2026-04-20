-- Migration: ADR-0051 Sprint 1.1 follow-up — grant the ledger read RPC to
-- `authenticated` so admin-identity sessions (is_admin=true) can call it via
-- the admin proxy. `require_admin('platform_operator')` inside the function
-- still gates access correctly.

grant execute on function admin.billing_evidence_ledger_for_account(uuid, timestamptz, timestamptz, int)
  to authenticated;
