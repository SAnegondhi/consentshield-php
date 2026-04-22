-- ADR-1010 Phase 3 Sprint 3.1 — grant cs_worker SELECT on
-- public.tracker_signatures for the direct-Postgres read path.
--
-- Gap surfaced while writing the integration test: the REST path used
-- an HS256 JWT claiming `role: cs_worker` and PostgREST applied the
-- existing `auth_read_tracker_sigs` RLS policy (gated on
-- `auth.role() = 'authenticated'`) — the JWT also carried that role
-- claim. The direct-Postgres path, by contrast, is literally `cs_worker`
-- with no JWT, so the `authenticated`-scoped policy doesn't match and
-- table access falls back to the per-role GRANT list — which was empty
-- for cs_worker.
--
-- tracker_signatures is platform-owned read-only reference data. The
-- SELECT grant to cs_worker carries no cross-tenant risk; everything
-- in the table is global seed data.

grant select on public.tracker_signatures to cs_worker;

comment on table public.tracker_signatures is
  'Platform-owned tracker signature catalogue. Readable by: '
  'authenticated (via RLS policy auth_read_tracker_sigs), '
  'cs_orchestrator (direct grant, 20260803000010), and cs_worker '
  '(direct grant, this migration — used from the Worker''s '
  'signatures.ts via Hyperdrive per ADR-1010 Phase 3 Sprint 3.1).';
