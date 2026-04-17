-- ADR-0029 Sprint 1.1 — admin SELECT-all RLS policies on public tables.
--
-- The admin app's JWT carries `is_admin=true` but, until now, had no
-- grant path onto customer tables. Every admin panel that needs to show
-- cross-org data (Organisations list, Pipeline Ops, Abuse & Security,
-- Billing Ops, Audit Log detail joins) needs a SELECT path into
-- `public.*`.
--
-- Strategy: add a per-table "admins_select_all" policy that reads the
-- is_admin claim from the JWT. Postgres ORs policies, so the existing
-- customer-scoped policies (id = current_org_id()) continue to filter
-- non-admin traffic to their own org exactly as before.
--
-- Excluded tables:
--   * buffer tables (consent_events, tracker_observations, audit_log,
--     processing_log, delivery_buffer, rights_request_events,
--     deletion_receipts, withdrawal_verifications, security_scans,
--     consent_probe_runs, consent_artefact_index, artefact_revocations,
--     consent_expiry_queue) — admins read via SECURITY DEFINER RPCs
--     when needed (ADR-0027 audit log RPC pattern) so we don't widen
--     the RLS surface. Rule 1: buffer tables are temporary.
--   * no-RLS legacy — none exist post-ADR-0026.
--
-- Included tables (15 — the operational state the Organisations panel
-- and subsequent admin panels need to read):
--   organisations, organisation_members, web_properties,
--   consent_banners, data_inventory, breach_notifications,
--   rights_requests, export_configurations, tracker_signatures,
--   tracker_overrides, integration_connectors, retention_rules,
--   notification_channels, purpose_definitions (DEPA),
--   purpose_connector_mappings (DEPA).
--
-- For tables added by future migrations, the pattern is a one-liner
-- `create policy admins_select_all on public.<table> for select to
-- authenticated using (admin.is_admin())`.

do $$
declare
  v_table text;
  v_policy text;
begin
  for v_table in
    select unnest(array[
      'organisations',
      'organisation_members',
      'web_properties',
      'consent_banners',
      'data_inventory',
      'breach_notifications',
      'rights_requests',
      'export_configurations',
      'tracker_signatures',
      'tracker_overrides',
      'integration_connectors',
      'retention_rules',
      'notification_channels',
      'purpose_definitions',
      'purpose_connector_mappings'
    ])
  loop
    if to_regclass('public.' || v_table) is null then
      continue;
    end if;
    v_policy := 'admins_select_all';
    -- Drop before create for idempotency.
    execute format(
      'drop policy if exists %I on public.%I',
      v_policy, v_table
    );
    execute format(
      'create policy %I on public.%I for select to authenticated using (admin.is_admin())',
      v_policy, v_table
    );
  end loop;
end;
$$;

-- Verification:
--   select count(*) from pg_policies
--     where schemaname='public' and policyname='admins_select_all';
--     → 15 (minus any that didn't exist in this DB)
