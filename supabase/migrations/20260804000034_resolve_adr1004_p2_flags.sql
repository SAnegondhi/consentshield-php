-- ADR-1004 Phase 2 Sprints 2.2 + 2.3 close-out — resolve the two
-- "blocked on wireframes" readiness flags now that the wireframes
-- are authored (`docs/design/screen designs and ux/consentshield-notices.html`)
-- and the UI + replaced_by pipeline + reconsent_campaigns shipped.

update admin.ops_readiness_flags
   set status           = 'resolved',
       resolution_notes = 'Wireframes authored 2026-04-23 in '
                          'consentshield-notices.html. /dashboard/notices '
                          'list + publish form + CSV export shipped. '
                          'Migration 20260804000033 lands replaced_by '
                          'pipeline + reconsent_campaigns + nightly cron. '
                          '/dashboard/notices/[id]/campaign view live. '
                          '7/7 integration tests PASS.',
       resolved_at      = now()
 where source_adr in ('ADR-1004 Phase 2 Sprint 2.2', 'ADR-1004 Phase 2 Sprint 2.3')
   and status in ('pending', 'in_progress');
