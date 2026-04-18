-- ADR-0044 Phase 2.6 follow-up — tighten the grant on
-- create_invitation_from_marketing.
--
-- The previous migration did `revoke execute from public`, which on
-- hosted Supabase is not enough: the `anon` and `authenticated`
-- roles receive EXECUTE on new public.* functions via platform
-- default privileges, and that grant is NOT removed by a
-- `from public` revoke.
--
-- Discovered via a manual probe (anon client called the RPC and got
-- a 200 OK). Fix: explicit revoke from anon + authenticated, keep
-- the grant to cs_orchestrator only. Service-role still works
-- because it authenticates as postgres superuser.

revoke execute on function public.create_invitation_from_marketing(text, text, int, text, int)
  from public, anon, authenticated;

grant execute on function public.create_invitation_from_marketing(text, text, int, text, int)
  to cs_orchestrator;

-- Verification (direct SQL; not via PostgREST):
--   select has_function_privilege('anon', 'public.create_invitation_from_marketing(text,text,int,text,int)', 'execute');
--     → f
--   select has_function_privilege('authenticated', 'public.create_invitation_from_marketing(text,text,int,text,int)', 'execute');
--     → f
--   select has_function_privilege('cs_orchestrator', 'public.create_invitation_from_marketing(text,text,int,text,int)', 'execute');
--     → t
