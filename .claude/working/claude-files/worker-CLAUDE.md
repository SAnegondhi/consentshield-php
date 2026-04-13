# ConsentShield Cloudflare Worker

This is the edge layer at cdn.consentshield.in. It serves banner scripts and ingests consent events.

## Hard constraints

- ZERO npm dependencies. Vanilla TypeScript only. Use Web Crypto API for HMAC/hashing.
- Database credential: SUPABASE_WORKER_KEY (cs_worker role). Can INSERT consent_events and tracker_observations. Can SELECT consent_banners and web_properties. Cannot read anything else.
- Every POST must validate HMAC signature + origin before writing.
- Failed writes return 202, not 500. Never break the customer's website.

## Build

- `cd worker && wrangler dev` for local testing
- `cd worker && wrangler deploy` for production
- Test all endpoints with curl before deploying (see tests/worker/)

## Files

- `src/index.ts` — route handler
- `src/banner.ts` — banner config fetch, script compilation, delivery
- `src/events.ts` — consent event validation and ingestion
- `src/observations.ts` — tracker observation validation and ingestion
- `src/hmac.ts` — HMAC-SHA256 computation and verification using Web Crypto API
- `wrangler.toml` — Worker configuration, KV binding, environment variables
