# Changelog — Schema

Database migrations, RLS policies, roles.

## ADR-0008 Sprint 1.2, 1.4 — 2026-04-14

**ADR:** ADR-0008 — Browser Auth Hardening
**Sprint:** Phase 1, Sprints 1.2 and 1.4

### Added
- `20260414000003_origin_verified.sql` — adds `origin_verified text not null
  default 'legacy-hmac'` to `consent_events` and `tracker_observations`.
  Intake code sets `'origin-only'` for browser callers and `'hmac-verified'`
  for server-to-server callers.
- `20260414000004_rotate_signing_secrets.sql` — regenerates every
  `web_properties.event_signing_secret` (all prior values were shipped into
  browsers via the old banner script) and records a
  `event_signing_secret_rotated_at` timestamp.

### Tested
- [ ] Live `supabase db push` — pending user approval (destructive on
  production secrets).

## ADR-0009 Sprint 1.1 — 2026-04-14

**ADR:** ADR-0009 — Scoped-Role Enforcement in REST Paths
**Sprint:** Phase 1, Sprint 1.1

### Added
- `20260414000005_scoped_rpcs_public.sql` — three security-definer functions
  owned by `cs_orchestrator` and granted to `anon`:
  `rpc_rights_request_create`, `rpc_rights_request_verify_otp`,
  `rpc_deletion_receipt_confirm`. The deletion-receipt RPC also enforces the
  `awaiting_callback → confirmed` state machine (closes B-6).
- Grant extensions on `cs_orchestrator`: `insert on rights_requests` plus
  `update (email_verified, email_verified_at, otp_hash, otp_expires_at, otp_attempts)`.

### Tested
- [ ] Live `supabase db push` — pending.
