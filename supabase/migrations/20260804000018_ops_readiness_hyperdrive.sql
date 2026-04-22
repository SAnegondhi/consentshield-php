-- ADR-1010 Phase 1 Sprint 1.1 — operator-gated Hyperdrive provisioning.
--
-- The scratch probe route /v1/_cs_api_probe is shipped; three probe
-- scaffolds are in place. Hyperdrive provisioning is a Cloudflare
-- dashboard step that claude-code cannot execute. Surface it on
-- /admin/(operator)/readiness so it stays visible until the step
-- completes + the mechanism decision lands in the ADR amendment.

insert into admin.ops_readiness_flags (
  title, description, source_adr, blocker_type, severity, status, owner
)
values (
  'ADR-1010 Phase 1 — Provision Cloudflare Hyperdrive for cs_worker',
  'The Worker scratch route /v1/_cs_api_probe is live with three mechanism '
    || 'probes (REST baseline, Hyperdrive scaffold, raw-TCP scaffold). To '
    || 'measure mechanism A end-to-end, the operator must create a Hyperdrive '
    || 'instance in the Cloudflare dashboard + add a [[hyperdrive]] binding '
    || 'to worker/wrangler.toml. See worker/src/prototypes/README.md for the '
    || 'exact origin DSN + binding shape. After redeploy, curl '
    || '/v1/_cs_api_probe?via=hyperdrive should return ok:true with '
    || 'note=binding_present. Then amend ADR-1010 with the latency '
    || 'comparison + mechanism decision and open Phase 3 Sprint 3.1.',
  'ADR-1010 Phase 1',
  'infra',
  'medium',
  'pending',
  'operator'
)
on conflict do nothing;
