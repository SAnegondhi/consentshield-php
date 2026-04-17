-- ADR-0033 Sprint 2.3 — extend public.admin_config_snapshot() with
-- the active blocked-IP list.
--
-- Folded from the ADR's original "separate Edge Function + cron" plan
-- into the existing admin_config_snapshot pattern (ADR-0027 Sprint 3.2 /
-- ADR-0029 Sprint 4.1). Rationale: blocked_ips has the same shape +
-- cadence as suspended_org_ids — a small list the Worker reads on the
-- hot path. Bundling into the same KV key means zero new cron jobs,
-- zero new Edge Functions, zero new KV keys. Worker picks the change
-- up on the next 2-minute sync.
--
-- New key shape:
--
--   admin:config:v1 now carries 6 top-level keys —
--     kill_switches, active_tracker_signatures,
--     published_sectoral_templates, suspended_org_ids,
--     blocked_ips (new), refreshed_at.
--
--   blocked_ips is an array of CIDR strings (e.g. "1.2.3.4/32",
--   "198.51.100.0/24") drawn from public.blocked_ips where
--   unblocked_at is null and (expires_at is null or expires_at > now()).

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
    'blocked_ips',
      coalesce(
        (select jsonb_agg(ip_cidr::text)
           from public.blocked_ips
          where unblocked_at is null
            and (expires_at is null or expires_at > now())),
        '[]'::jsonb
      ),
    'refreshed_at', now()
  );
$$;

-- Verification:
--   select jsonb_object_keys(public.admin_config_snapshot())
--    order by 1;
--    → active_tracker_signatures, blocked_ips, kill_switches,
--      published_sectoral_templates, refreshed_at, suspended_org_ids.
--
--   select public.admin_config_snapshot()->'blocked_ips';
--    → '[]' on a clean system; after security_block_ip, the new CIDR appears.
