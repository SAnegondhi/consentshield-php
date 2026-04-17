-- ADR-0027 Sprint 3.1 — EXECUTE grants on every admin.* RPC.
--
-- Each admin function is SECURITY DEFINER so it runs as the function
-- owner (postgres) regardless of who calls it. The role gate inside the
-- function body (admin.require_admin) is the actual authorisation check.
-- But PostgREST + PostgreSQL still need `authenticated` to have EXECUTE
-- on the function before the body runs — without it, every call returns
-- "permission denied for function ...".
--
-- This migration uses a dynamic `do $$` block to grant EXECUTE to
-- `authenticated` on every function in the `admin` schema except the
-- helpers (is_admin/current_admin_role/require_admin) which already got
-- grants in Sprint 1.1.
--
-- New admin RPCs added in future sprints will NOT get grants
-- automatically — a follow-up migration calling this same pattern (or a
-- one-line explicit grant) is required.
--
-- Per ADR-0027 Sprint 3.1 Deliverables (EXECUTE grant task).

do $$
declare
  v_fn record;
begin
  for v_fn in
    select p.oid, p.proname, pg_get_function_identity_arguments(p.oid) as args
      from pg_proc p
     where p.pronamespace = 'admin'::regnamespace
       and p.prokind = 'f'
       and p.proname not in (
         'is_admin',
         'current_admin_role',
         'require_admin',
         'create_next_audit_partition'
       )
  loop
    execute format(
      'grant execute on function admin.%I(%s) to authenticated',
      v_fn.proname, v_fn.args
    );
  end loop;
end;
$$;

-- Verification:
--   select count(*) from information_schema.role_routine_grants
--     where routine_schema = 'admin'
--       and grantee = 'authenticated'
--       and privilege_type = 'EXECUTE'
--       and routine_name not in ('is_admin','current_admin_role','require_admin','create_next_audit_partition');
--   → 30
