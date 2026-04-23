-- ADR-1018 Sprint 1.5 — DNS cutover for status.consentshield.in.
--
-- Operator added the CNAME (status → cname.vercel-dns.com) on 2026-04-23.
-- I added the alias to the `app` Vercel project, wired a host-based
-- redirect in app/src/app/page.tsx so requests landing on the alias root
-- redirect to /status (instead of falling through to /login), and
-- verified end-to-end:
--   * HEAD https://status.consentshield.in → 307 location: /status
--   * GET  https://status.consentshield.in → 200 (followed redirect)
--   * Production deploy: dpl_DZCmm8n7AiGqBMkfB6BHxBq8VrsV
--
-- Resolves the ADR-1018 Sprint 1.5 readiness flag.

update admin.ops_readiness_flags
   set status           = 'resolved',
       resolution_notes = 'CNAME cutover complete 2026-04-23. '
                          'status.consentshield.in returns 307 → /status '
                          'and the public status page renders. Vercel '
                          'alias on app project; host-based redirect in '
                          'app/src/app/page.tsx; production deploy '
                          'dpl_DZCmm8n7AiGqBMkfB6BHxBq8VrsV.',
       resolved_at      = now()
 where source_adr = 'ADR-1018 Sprint 1.5'
   and status in ('pending', 'in_progress');
