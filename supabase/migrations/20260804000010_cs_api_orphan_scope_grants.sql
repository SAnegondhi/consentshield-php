-- ADR-1016 — GRANT EXECUTE on the 3 new v1 RPCs to cs_api.
-- Matches the ADR-1009 Phase 2 pattern.

revoke execute on function public.rpc_audit_log_list(
  uuid, uuid, text, text, timestamptz, timestamptz, text, int
) from anon, authenticated;

grant execute on function public.rpc_audit_log_list(
  uuid, uuid, text, text, timestamptz, timestamptz, text, int
) to cs_api;

revoke execute on function public.rpc_security_scans_list(
  uuid, uuid, uuid, text, text, timestamptz, timestamptz, text, int
) from anon, authenticated;

grant execute on function public.rpc_security_scans_list(
  uuid, uuid, uuid, text, text, timestamptz, timestamptz, text, int
) to cs_api;

revoke execute on function public.rpc_depa_score_self(uuid, uuid)
  from anon, authenticated;

grant execute on function public.rpc_depa_score_self(uuid, uuid) to cs_api;
