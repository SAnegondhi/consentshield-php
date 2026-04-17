-- ADR-0029 Sprint 4.1 — extend public.admin_config_snapshot() with
-- per-org suspension list.
--
-- The Cloudflare Worker uses the synced admin-config snapshot (via
-- BANNER_KV key admin:config:v1) to decide whether to serve the real
-- banner. Sprint 3.2 covered the global kill_switches. Sprint 4.1 adds
-- per-org suspension: `suspended_org_ids` is the set of
-- public.organisations.id where status='suspended'.
--
-- The Worker iterates the list (O(n) — expected size <20 suspended orgs
-- in practice; this is dev, and worst-case scale is small).

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
    'suspended_org_ids',
      coalesce(
        (select jsonb_agg(id) from public.organisations where status = 'suspended'),
        '[]'::jsonb
      ),
    'refreshed_at', now()
  );
$$;

-- Verification:
--   select jsonb_object_keys(public.admin_config_snapshot()); → 5 keys now
