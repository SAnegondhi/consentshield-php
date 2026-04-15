-- Make the ADR-0009 security-definer RPCs actually work over the REST API.
--
-- Observed failure on the first live deploy:
--   1. Anon calls rpc_get_rights_portal (owned by cs_orchestrator, security
--      definer). The function body SELECTs from `organisations`.
--   2. `organisations` has RLS; the existing policy filters by
--      `id = current_org_id()`, which internally calls `auth.jwt()`.
--   3. cs_orchestrator has no USAGE on schema `auth`, so `auth.jwt()` fails
--      with "permission denied for schema auth".
--   4. Even if auth.jwt() returned NULL, the RLS predicate wouldn't match.
--
-- Fix: give the scoped roles what they need to evaluate RLS and, for roles
-- that orchestrate across orgs, let them bypass RLS inside their own
-- security-definer functions. BYPASSRLS applies to the role regardless of
-- the outer JWT, because security-definer runs with owner's privileges.

grant usage on schema auth to cs_orchestrator, cs_delivery;

alter role cs_orchestrator bypassrls;
alter role cs_delivery      bypassrls;
