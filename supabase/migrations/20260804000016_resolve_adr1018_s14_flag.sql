-- ADR-1018 Sprint 1.4 close-out — mark the ops-readiness flag resolved now that
-- the probe cron + Edge Functions are shipped. Leaves S1.5 (DNS cutover) flag
-- intact; that sprint is still deferred and operator-gated.

update admin.ops_readiness_flags
   set status           = 'resolved',
       resolution_notes = 'Shipped 2026-04-22. Probe cron status-probes-5min + '
                          || 'heartbeat-check cron wired; run-status-probes + '
                          || 'health Edge Functions deployed; smoke test: '
                          || '{"probed":5,"skipped":1,"flipped":0}. '
                          || 'See ADR-1018 + CHANGELOG-edge-functions 2026-04-22.',
       resolved_at      = now(),
       updated_at       = now()
 where source_adr = 'ADR-1018 Sprint 1.4'
   and status in ('pending', 'in_progress');
