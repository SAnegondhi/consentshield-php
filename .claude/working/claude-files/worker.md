---
globs: ["worker/**/*.ts", "worker/**/*.js"]
---

# Cloudflare Worker Rules

## Zero dependencies

This Worker has NO npm dependencies. Do not add any. Do not import from node_modules.
If you need a utility (HMAC, base64, hashing), implement it using Web Crypto API or write it yourself in worker/src/.
This is a policy decision, not a technical limitation. Every dependency runs on every page load of every customer's website.

## Database access

Use the cs_worker database credential (SUPABASE_WORKER_KEY), NOT the service role key.
cs_worker can only INSERT into consent_events and tracker_observations, and SELECT from consent_banners and web_properties.
It cannot read organisations, rights_requests, integration_connectors, or any other table.

## Consent event ingestion (POST /v1/events)

Every request must pass four validation steps IN ORDER before writing:
1. Origin validation — check Origin/Referer header against allowed_origins from KV config. Mismatch → 403.
2. HMAC verification — verify signature using the property's event_signing_secret. Check timestamp is within ±5 minutes. Invalid → 403.
3. Payload validation — required fields present, event_type is a known value.
4. Data hygiene — truncate IP (remove last octet), hash user_agent (SHA-256).

Never skip any step. Never skip validation in development mode.

## Response behaviour

Always return 202 for successful event ingestion. Never return 500 for a database write failure.
A failed ConsentShield write must NEVER break the customer's website. Return 202, log the error server-side, retry asynchronously.

## KV cache

Banner configs cached for 300s. Banner scripts cached for 3600s. Signing secrets cached with TTL matching banner version.
When a banner is published, the Next.js app invalidates the KV cache for that property.
