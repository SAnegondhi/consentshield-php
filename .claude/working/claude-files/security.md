# Security Rules

These rules apply to ALL files in the project. They cannot be overridden.

## Secrets

- Never put any key, secret, token, or password in a file that will be committed to git
- Never put any secret in a NEXT_PUBLIC_ environment variable
- Never log any secret, credential, or encryption key — not even partially
- Never include secrets in error messages, Sentry events, or API responses
- If you see a secret in code during a refactor, flag it immediately

## Database

- Every table has RLS enabled. No exceptions.
- Buffer tables (consent_events, tracker_observations, audit_log, processing_log, delivery_buffer, rights_request_events, deletion_receipts, withdrawal_verifications, security_scans, consent_probe_runs) have NO update/delete RLS policies for authenticated users
- The authenticated role has no INSERT privilege on consent_events, tracker_observations, audit_log, processing_log, delivery_buffer
- Never use SUPABASE_SERVICE_ROLE_KEY in application code. Use the scoped role keys: SUPABASE_WORKER_KEY, SUPABASE_DELIVERY_ROLE_KEY, SUPABASE_ORCHESTRATOR_ROLE_KEY

## Input validation

- Never trust org_id from client payloads — extract from JWT or URL parameter
- Validate all user inputs server-side, even if validated client-side
- Rate-limit all public endpoints
- Verify webhook signatures before any database write (Razorpay, deletion callbacks)

## Personal data

- Truncate IP addresses (remove last octet) before storage
- Hash user agents (SHA-256) before storage
- Hash data principal identifiers before storage in deletion_receipts
- Never store FHIR/health data in any table, log, or file
