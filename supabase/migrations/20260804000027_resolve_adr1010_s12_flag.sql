-- ADR-1010 Phase 1 Sprint 1.2 — resolve the Hyperdrive-provisioning
-- readiness flag now that the operator provisioned the Hyperdrive
-- config, the binding was wired in wrangler.toml, and probes returned
-- ok: true from the deployed Worker.
--
-- Hyperdrive config id: 00926f5243a849f08af2cf01d32adbee
-- Worker version id:    3ccd116c-5d4e-4ab5-9b7a-1df5be7b838a
-- Probe baseline:       rest p50=274ms | hyperdrive binding_present p50=44ms
--                       (full wire-protocol latency lands at Sprint 3.1).

update admin.ops_readiness_flags
   set status           = 'resolved',
       resolution_notes = 'Hyperdrive config cs-worker-hyperdrive '
                          'provisioned (id 00926f5243a849f08af2cf01d32adbee); '
                          'wrangler.toml [[hyperdrive]] binding landed; '
                          'worker deployed (version 3ccd116c...); probes ok. '
                          'Phase 3 Sprint 3.1 unblocked.',
       resolved_at      = now()
 where source_adr = 'ADR-1010 Phase 1'
   and status in ('pending', 'in_progress');
