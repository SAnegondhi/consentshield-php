---
globs: ["src/app/api/**/*.ts", "src/app/api/**/*.tsx"]
---

# API Route Rules

## Authentication pattern

All routes under /api/orgs/[orgId]/ follow the same pattern:
1. Get the Supabase session from the request
2. Extract org_id from the JWT claims
3. Verify org_id matches the [orgId] URL parameter — if not, return 403
4. Let RLS handle the rest — do not manually filter by org_id in queries

## Public routes (/api/public/*)

- Rate-limit at 5 requests/IP/hour via Vercel edge middleware
- Verify Cloudflare Turnstile token before creating any database row
- For rights requests: require email OTP verification before sending notification to compliance contact
- Never trust client-provided org_id — take it from the URL parameter and validate against the organisations table

## Webhook routes (/api/webhooks/*)

- Razorpay: verify X-Razorpay-Signature header (HMAC-SHA256) BEFORE any database write
- Deletion callbacks: verify the sig query parameter (HMAC-SHA256) BEFORE accepting any confirmation
- If signature verification fails, return 401. Do not process the request. Do not log the body (might contain PII).

## Compliance API (/api/v1/*)

- Authenticate via API key (Authorization: Bearer cs_live_xxx)
- Hash the provided key with SHA-256, look up in api_keys table by key_hash
- Check key is active and not expired
- Check key scopes against the requested operation
- Rate-limit: check against the org's plan limits

## Response format

- Never return the service role key, any encryption key, or any credential
- Never return raw database errors to the client — catch, log server-side, return generic 500
- Never return stack traces in production
- Include org_id in audit_log entries for every mutating operation

## Database credential

- Use cs_orchestrator for all API routes that need server-side database access
- Never use SUPABASE_SERVICE_ROLE_KEY in API route handlers
