-- ADR-1018 Sprint 1.4 — correct two seeded health_urls from `/api/_health`
-- to `/api/health`. Next.js treats `_`-prefixed folders as private and
-- excludes them from routing, so the migration-15 URL 404s. The fix hasn't
-- caused a wedge yet because auto-flipping requires 3 consecutive
-- non-operational checks and `health_url` change is trivially re-probeable.

update public.status_subsystems
   set health_url = 'https://app.consentshield.in/api/health',
       updated_at = now()
 where slug in ('verification_api', 'dashboard')
   and health_url = 'https://app.consentshield.in/api/_health';
