-- ADR-1017 Sprint 1.3 — resolve the ops-readiness flag for this sprint
-- now that the deliverables (tests + runbook + audit-log column fix)
-- have shipped.
--
-- The flag was seeded in 20260804000014 with status='pending'. A direct
-- UPDATE on admin.ops_readiness_flags is fine — there is no audit row
-- semantics around self-resolution via migration, and the RPC path
-- requires auth.uid() which is null under supabase db push.

update admin.ops_readiness_flags
   set status            = 'resolved',
       resolution_notes  = 'Shipped 2026-04-22. Deliverables: '
                            'tests/admin/ops-readiness-flags.test.ts (12), '
                            'tests/admin/status-page-rpcs.test.ts (11), '
                            'docs/runbooks/ops-readiness-flags.md, '
                            'migration 20260804000019 audit-log column fix.',
       resolved_at       = now()
 where source_adr = 'ADR-1017 Sprint 1.3'
   and status = 'pending';
