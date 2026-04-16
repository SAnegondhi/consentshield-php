# Changelog — Edge Functions

Supabase Edge Function changes.

## ADR-0011 Sprint 1.1 — 2026-04-16

**ADR:** ADR-0011 — Deletion Retry and Timeout
**Sprint:** Phase 1, Sprint 1.1

### Added
- `supabase/functions/check-stuck-deletions/index.ts`: hourly
  retry/timeout engine for `deletion_receipts.status =
  'awaiting_callback'`. Decrypts connector config via per-org
  HMAC-SHA256 key derivation (Deno Web Crypto) + the `decrypt_secret`
  RPC. Re-POSTs to the customer webhook with the same signature
  contract the Next.js dispatcher uses. Backoff `[1h, 6h, 24h]`;
  after three failures, flips `status = 'failed'` and emits
  `deletion_retry_exhausted` to `audit_log`. Skips receipts whose
  `requested_at` is older than 30 days (beyond the DPDP SLA).
- `MASTER_ENCRYPTION_KEY` pushed to the Supabase Functions secrets
  via `supabase secrets set` — required for connector-config
  decryption inside Deno.

### Deployment
- `supabase functions deploy check-stuck-deletions --no-verify-jwt`.
  The `--no-verify-jwt` flag is currently required because the
  vault-stored `cs_orchestrator_key` is in the new `sb_secret_*`
  format, which the Edge Function gateway rejects with
  `UNAUTHORIZED_INVALID_JWT_FORMAT`. The same class of failure
  affects the four pre-existing HTTP cron jobs; captured as a
  known issue (see ADR-0011 Architecture Changes).

### Tested
- [x] Manually triggered via `select net.http_post(...)` using the
  vault orchestrator key. Response: `200 OK`,
  `{"ok":true,"scanned":0,"retried":0,"failed":0,"skipped":0}`.

## S-7 remediation — 2026-04-14

### Changed
- `supabase/functions/send-sla-reminders/index.ts` — removed the silent
  `SUPABASE_SERVICE_ROLE_KEY` fallback. The function now throws at boot if
  `SUPABASE_ORCHESTRATOR_ROLE_KEY` is unset. Rule #5 prohibits running any
  Edge Function under the master key.

### Required operator action
- `supabase secrets set CS_ORCHESTRATOR_ROLE_KEY=<value>` before
  redeploying the function. (Supabase reserves the `SUPABASE_` prefix for
  its own managed secrets; the env var name was reverted to
  `CS_ORCHESTRATOR_ROLE_KEY` after the `supabase secrets set` command
  rejected the `SUPABASE_` variant.)

## 2026-04-15 — deployed

- `send-sla-reminders` deployed via `supabase functions deploy
  send-sla-reminders` with `CS_ORCHESTRATOR_ROLE_KEY` set. Boot-time
  check verified by `supabase functions logs send-sla-reminders`.
