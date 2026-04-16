-- ADR-0017 Sprint 1.1 — Audit Export Package.
--
-- Adds `audit_export_manifests` (pointer-only; never stores the ZIP bytes)
-- and `rpc_audit_export_manifest` — a security-definer aggregator that
-- returns a single JSONB blob containing every section the export package
-- needs. The Next.js route serialises + ZIPs + returns as HTTP download.

-- ═══════════════════════════════════════════════════════════
-- audit_export_manifests — one row per export request. Pointer
-- only: never holds the ZIP itself.
-- ═══════════════════════════════════════════════════════════
create table if not exists audit_export_manifests (
  id              uuid primary key default gen_random_uuid(),
  org_id          uuid not null references organisations(id) on delete cascade,
  requested_by    uuid not null references auth.users(id),
  format_version  integer not null default 1,
  section_counts  jsonb not null default '{}',
  content_bytes   integer,
  delivery_target text,                            -- 'direct_download' | 'r2' (Phase 2)
  r2_bucket       text,
  r2_object_key   text,
  created_at      timestamptz default now()
);

create index if not exists idx_audit_export_manifests_org
  on audit_export_manifests (org_id, created_at desc);

alter table audit_export_manifests enable row level security;

-- Org members can read their org's manifest history.
create policy "org_read_audit_export_manifests"
  on audit_export_manifests for select
  using (org_id = current_org_id());

-- No other direct policies — inserts run under cs_orchestrator via the RPC.

grant select on audit_export_manifests to authenticated;
grant insert, select on audit_export_manifests to cs_orchestrator;

-- ═══════════════════════════════════════════════════════════
-- rpc_audit_export_manifest — aggregation-only RPC. Returns a JSON
-- object containing every section the API route will serialise.
-- Security definer so the scoped role can SELECT across buffer
-- tables regardless of the caller's role permissions.
-- ═══════════════════════════════════════════════════════════
create or replace function public.rpc_audit_export_manifest(
  p_org_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_uid uuid := public.current_uid();
  v_org jsonb;
  v_data_inventory jsonb;
  v_banners jsonb;
  v_properties jsonb;
  v_events jsonb;
  v_rights jsonb;
  v_deletions jsonb;
  v_scans jsonb;
  v_probes jsonb;
  v_section_counts jsonb;
begin
  if v_uid is null then
    raise exception 'unauthenticated' using errcode = '28000';
  end if;

  if not exists (
    select 1 from organisation_members
    where user_id = v_uid and org_id = p_org_id
  ) then
    raise exception 'not a member of org' using errcode = '42501';
  end if;

  -- Organisation profile. Only the fields a compliance officer needs.
  select to_jsonb(row) into v_org from (
    select id, name, industry, plan,
           encode(digest(coalesce(compliance_contact_email, ''), 'sha256'), 'hex') as compliance_contact_email_sha256,
           created_at, updated_at
    from organisations where id = p_org_id
  ) row;

  select coalesce(jsonb_agg(to_jsonb(di)), '[]'::jsonb) into v_data_inventory
  from data_inventory di where org_id = p_org_id;

  select coalesce(jsonb_agg(to_jsonb(cb)), '[]'::jsonb) into v_banners
  from consent_banners cb where org_id = p_org_id;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', wp.id, 'name', wp.name, 'url', wp.url,
    'allowed_origins', wp.allowed_origins,
    'snippet_last_seen_at', wp.snippet_last_seen_at,
    'created_at', wp.created_at
  )), '[]'::jsonb) into v_properties
  from web_properties wp where org_id = p_org_id;

  -- Consent events — monthly rollup only (raw rows are buffer data
  -- that will clear; summary is suitable for audit).
  select coalesce(jsonb_agg(row), '[]'::jsonb) into v_events from (
    select date_trunc('month', created_at)::date as month,
           event_type,
           count(*) as count
    from consent_events
    where org_id = p_org_id
      and created_at > now() - interval '90 days'
    group by 1, 2
    order by 1 desc, 2
  ) row;

  select coalesce(jsonb_agg(row), '[]'::jsonb) into v_rights from (
    select status,
           request_type,
           count(*) as count,
           min(created_at) as earliest,
           max(created_at) as latest
    from rights_requests
    where org_id = p_org_id
    group by 1, 2
    order by 1, 2
  ) row;

  select coalesce(jsonb_agg(jsonb_build_object(
    'identifier_hash', identifier_hash,
    'status', status,
    'trigger_type', trigger_type,
    'retry_count', retry_count,
    'target_system', target_system,
    'requested_at', requested_at,
    'confirmed_at', confirmed_at
  )), '[]'::jsonb) into v_deletions
  from deletion_receipts where org_id = p_org_id;

  -- Security scans rollup: latest per property per signal.
  select coalesce(jsonb_agg(row), '[]'::jsonb) into v_scans from (
    select distinct on (property_id, signal_key)
           property_id, signal_key, severity, scanned_at
    from security_scans
    where org_id = p_org_id
    order by property_id, signal_key, scanned_at desc
  ) row;

  select coalesce(jsonb_agg(jsonb_build_object(
    'probe_id', probe_id,
    'consent_state', consent_state,
    'trackers_detected_count', jsonb_array_length(trackers_detected),
    'violations_count', jsonb_array_length(violations),
    'status', status,
    'run_at', run_at
  )), '[]'::jsonb) into v_probes
  from consent_probe_runs
  where org_id = p_org_id and run_at > now() - interval '30 days';

  v_section_counts := jsonb_build_object(
    'data_inventory', jsonb_array_length(v_data_inventory),
    'banners', jsonb_array_length(v_banners),
    'properties', jsonb_array_length(v_properties),
    'consent_events_rollup_rows', jsonb_array_length(v_events),
    'rights_request_buckets', jsonb_array_length(v_rights),
    'deletion_receipts', jsonb_array_length(v_deletions),
    'security_scan_signals', jsonb_array_length(v_scans),
    'probe_runs', jsonb_array_length(v_probes)
  );

  return jsonb_build_object(
    'format_version', 1,
    'org_id', p_org_id,
    'generated_at', now(),
    'org', v_org,
    'data_inventory', v_data_inventory,
    'banners', v_banners,
    'properties', v_properties,
    'consent_events_summary', v_events,
    'rights_requests', v_rights,
    'deletion_receipts', v_deletions,
    'security_scans_rollup', v_scans,
    'probe_runs', v_probes,
    'section_counts', v_section_counts
  );
end;
$$;

alter function public.rpc_audit_export_manifest(uuid) owner to cs_orchestrator;
revoke all on function public.rpc_audit_export_manifest(uuid) from public;
grant execute on function public.rpc_audit_export_manifest(uuid) to authenticated;
