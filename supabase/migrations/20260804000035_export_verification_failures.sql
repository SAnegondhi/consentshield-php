-- ADR-1025 Phase 1 Sprint 1.3 — verification-probe failure capture table.
--
-- `app/src/lib/storage/verify.ts::runVerificationProbe` returns a typed
-- ProbeResult on success or failure. Call sites (auto-provisioning,
-- BYOK validation, nightly verify cron) INSERT one row into this table
-- per failed attempt so operators can see the failure history per-
-- `export_configurations` row + per-step.
--
-- Append-only, admin-only-read. No customer surface.

create table public.export_verification_failures (
  id                  uuid primary key default gen_random_uuid(),
  org_id              uuid not null references public.organisations(id) on delete cascade,
  export_config_id    uuid not null references public.export_configurations(id) on delete cascade,
  probe_id            text not null,
  failed_step         text not null check (failed_step in ('put', 'get', 'content_hash', 'delete')),
  error_text          text not null,
  duration_ms         integer,
  attempted_at        timestamptz not null default now()
);

create index idx_export_verify_fail_config
  on public.export_verification_failures (export_config_id, attempted_at desc);

create index idx_export_verify_fail_org
  on public.export_verification_failures (org_id, attempted_at desc);

comment on table public.export_verification_failures is
  'ADR-1025 Sprint 1.3 — append-only log of verification-probe failures against '
  'export_configurations rows. One row per failed attempt (not per retry bucket). '
  'Admin-only surface; no RLS policies allow authenticated/anon reads.';

-- RLS enabled + zero policies — no role other than service-role + explicit
-- GRANTs below can read or write.
alter table public.export_verification_failures enable row level security;

-- cs_orchestrator is the writer — Edge Functions running provisioning /
-- verify cron INSERT here when a probe fails. No UPDATE / DELETE / SELECT
-- granted: rows are terminal once written; admins read via a future admin
-- RPC (added when an admin panel needs the data).
grant insert on public.export_verification_failures to cs_orchestrator;
