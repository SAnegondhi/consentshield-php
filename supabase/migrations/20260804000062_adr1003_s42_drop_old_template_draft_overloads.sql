-- ADR-1003 Sprint 4.2 — drop the old template-draft RPC overloads.
-- (c) 2026 Sudhindra Anegondhi a.d.sudhindra@gmail.com
--
-- Migration 61 added two new optional parameters to
-- admin.create_sectoral_template_draft and
-- admin.update_sectoral_template_draft. Because the new parameters
-- have defaults, `CREATE OR REPLACE FUNCTION` created a NEW overload
-- alongside the original 6-arg / 5-arg signature instead of replacing
-- it. PostgREST then refuses with PGRST203 "Could not choose the best
-- candidate function" on every callsite that omits the new params.
--
-- This migration drops the old overloads so only the new (default-arg-
-- compatible) signatures remain. Verified safe:
--   * The only in-repo callers (admin/src/app/(operator)/templates/
--     actions.ts createDraft + updateDraft) are updated in the same
--     commit to pass the new params explicitly.
--   * No external callers — the RPCs are admin-only and the surface
--     hasn't been exposed in any client SDK.

drop function if exists admin.create_sectoral_template_draft(
  text, text, text, text, jsonb, text
);

drop function if exists admin.update_sectoral_template_draft(
  uuid, text, text, jsonb, text
);

-- Verification (run manually after db push):
--   select proname, pg_get_function_arguments(oid)
--     from pg_proc
--    where pronamespace = 'admin'::regnamespace
--      and proname in ('create_sectoral_template_draft', 'update_sectoral_template_draft')
--    order by proname, oid;
--   -- expected: exactly one row per function, each with the new
--   -- 8-arg / 7-arg signature including p_default_storage_mode +
--   -- p_connector_defaults.
