-- ADR-1013 Sprint 2.2 — grant cs_orchestrator SELECT on
-- public.tracker_signatures.
--
-- The probe orchestrator (/api/internal/run-probes) reads the
-- active tracker-signature catalogue to run signature matching on
-- sandbox-captured URLs. Migrating the route to the cs_orchestrator
-- direct-Postgres pool (Sprint 2.2 of ADR-1013) exposed the missing
-- grant — the legacy JWT path was implicitly BYPASSRLS so it didn't
-- need a table-level SELECT, but the pooler LOGIN path does.
--
-- tracker_signatures is reference data (detection_rules + category
-- metadata); SELECT grant to a scoped role is appropriate.

grant select on public.tracker_signatures to cs_orchestrator;
