-- ADR-0027 Sprint 3.2 — public.admin_config_snapshot() RPC.
--
-- The sync-admin-config-to-kv Edge Function uses the cs_orchestrator
-- key for its DB reads (Rule 5 — never the service role key in running
-- application code). cs_orchestrator has no is_admin claim and no
-- table-level grants on admin.* tables, so a direct SELECT against
-- admin.kill_switches etc. returns permission denied.
--
-- This function is SECURITY DEFINER — it runs as the function owner
-- (postgres) and returns the consolidated snapshot in one round-trip.
-- Only cs_orchestrator and authenticated JWTs get EXECUTE; the admin
-- app UI can also call it to preview what's about to sync.
--
-- Per ADR-0027 Sprint 3.2 Architecture Changes.

create or replace function public.admin_config_snapshot()
returns jsonb
language sql
security definer
set search_path = admin, public
as $$
  select jsonb_build_object(
    'kill_switches',
      coalesce(
        (select jsonb_object_agg(switch_key, enabled)
           from admin.kill_switches),
        '{}'::jsonb
      ),
    'active_tracker_signatures',
      coalesce(
        (select jsonb_agg(jsonb_build_object(
            'signature_code', signature_code,
            'display_name', display_name,
            'vendor', vendor,
            'signature_type', signature_type,
            'pattern', pattern,
            'category', category,
            'severity', severity
          ))
           from admin.tracker_signature_catalogue
          where status = 'active'),
        '[]'::jsonb
      ),
    'published_sectoral_templates',
      coalesce(
        (select jsonb_agg(jsonb_build_object(
            'template_code', template_code,
            'display_name', display_name,
            'sector', sector,
            'version', version,
            'purpose_definitions', purpose_definitions
          ))
           from admin.sectoral_templates
          where status = 'published'),
        '[]'::jsonb
      ),
    'refreshed_at', now()
  );
$$;

grant execute on function public.admin_config_snapshot() to authenticated, cs_orchestrator;

-- Verification:
--   select jsonb_pretty(public.admin_config_snapshot()); → full snapshot
--   select jsonb_object_keys(public.admin_config_snapshot());
--     → kill_switches, active_tracker_signatures, published_sectoral_templates, refreshed_at
