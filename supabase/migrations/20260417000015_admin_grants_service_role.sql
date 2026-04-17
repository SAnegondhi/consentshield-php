-- ADR-0027 Sprint 3.1 follow-up — grant admin schema access to service_role.
--
-- The Supabase service role (used by the `SUPABASE_SERVICE_ROLE_KEY`)
-- needs USAGE on the admin schema + full table grants for two reasons:
--
--   1. Test harnesses and one-shot scripts (e.g. bootstrap-admin in
--      Sprint 4.1) use the service role to insert the initial
--      admin.admin_users row before any admin JWT can call an RPC.
--
--   2. The Supabase Dashboard's Table Editor connects as service_role;
--      without USAGE, the admin schema is invisible in the UI.
--
-- service_role has BYPASSRLS, so giving it full schema access does not
-- weaken RLS for the customer-facing authenticated path. The admin
-- platform's actual write discipline (audit-logged RPCs) operates on
-- the `authenticated` JWT path — service_role is only used by
-- privileged tooling.

grant usage on schema admin to service_role;

grant select, insert, update, delete on all tables in schema admin to service_role;
grant usage, select on all sequences in schema admin to service_role;
grant execute on all functions in schema admin to service_role;

-- Default privileges on future admin objects.
alter default privileges in schema admin grant select, insert, update, delete on tables to service_role;
alter default privileges in schema admin grant usage, select on sequences to service_role;
alter default privileges in schema admin grant execute on functions to service_role;

-- Verification:
--   select has_schema_privilege('service_role','admin','usage'); → t
--   select has_table_privilege('service_role','admin.admin_users','insert'); → t
