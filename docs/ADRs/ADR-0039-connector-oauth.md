# ADR-0039: Connector OAuth — Mailchimp + HubSpot

(c) 2026 Sudhindra Anegondhi a.d.sudhindra@gmail.com

**Status:** Completed
**Date proposed:** 2026-04-17
**Date completed:** 2026-04-17
**Depends on:** ADR-0018 (pre-built connectors — API-key auth path). Requires external OAuth app registrations at Mailchimp and HubSpot (operator task).
**Unblocks:** Closes V2-C1. Removes the "paste your API key" UX friction.

---

## Context

ADR-0018 Phase 1 authenticates to Mailchimp + HubSpot by pasted API keys. V2-C1 ships the OAuth flow: the customer clicks "Connect Mailchimp", completes the provider's OAuth handshake, and ConsentShield stores the resulting access token + refresh token. API-key auth stays as a fallback.

OAuth requires an app registered at each provider. The app registration produces a client_id + client_secret that live in ConsentShield's deployment env vars — one app per provider per ConsentShield instance. Both providers also require a reachable privacy-policy URL; HubSpot may require app review for production use.

### OAuth flow shape

Standard authorization-code with PKCE where supported:

1. Customer clicks "Connect Mailchimp" → `GET /api/integrations/oauth/mailchimp/connect?org_id=X`.
2. Route generates a random `state` token, stores it in `oauth_states` with the org_id + user_id + TTL, then redirects to Mailchimp's authorize URL.
3. Customer authorises at Mailchimp → redirected to `GET /api/integrations/oauth/mailchimp/callback?code=Y&state=Z`.
4. Route validates the state (exists, not expired, not consumed), exchanges code for tokens, introspects metadata (for Mailchimp: `server_prefix`, `account_id`; for HubSpot: `portalId`), encrypts the token bundle via `encryptForOrg`, upserts `integration_connectors`.
5. Redirect back to `/dashboard/integrations?connected=<provider>`.

### Token refresh

HubSpot uses `expires_in` on access tokens (6 hours). Daily cron `oauth-token-refresh-daily` walks `integration_connectors` where `config` indicates auth_type='oauth2' and `expires_at < now() + 7 days`; decrypts, calls the provider's refresh endpoint, re-encrypts with the new bundle.

Mailchimp OAuth access tokens don't expire — they remain valid until revoked. Refresh only applies to HubSpot.

### Schema change

`integration_connectors.config` stays `bytea` (encrypted). The JSON shape inside is extended:

```json
{
  "auth_type": "oauth2",
  "access_token": "...",
  "refresh_token": "...",   // HubSpot only
  "expires_at": "ISO ts",
  "server_prefix": "us21",  // Mailchimp
  "portal_id": 12345         // HubSpot
}
```

Existing API-key configs keep the ADR-0018 shape (`{ api_key, server_prefix, audience_id }` or `{ access_token, portal_id }`). The dispatch logic already switches on `connector_type`; we add an auth_type branch inside each provider handler.

### CSRF protection: `oauth_states` table

```sql
create table oauth_states (
  state      text primary key,
  org_id     uuid not null references organisations(id) on delete cascade,
  user_id    uuid not null references auth.users(id),
  provider   text not null,
  created_at timestamptz not null default now(),
  consumed_at timestamptz,
  expires_at timestamptz not null default now() + interval '10 minutes'
);
```

No RLS — the route uses service role. TTL 10 min.

### Env vars the operator must set after registering OAuth apps

- `MAILCHIMP_OAUTH_CLIENT_ID` + `MAILCHIMP_OAUTH_CLIENT_SECRET`
- `HUBSPOT_OAUTH_CLIENT_ID` + `HUBSPOT_OAUTH_CLIENT_SECRET`
- `APP_URL` (probably already set) — used to construct the `redirect_uri` passed to the provider.

Without these, the Connect routes return a clear "OAuth not configured" message. API-key path keeps working.

---

## Decision

Three sprints:

1. **Sprint 1.1** — migration (`oauth_states` table + cleanup cron).
2. **Sprint 1.2** — `app/src/lib/connectors/oauth/{mailchimp,hubspot}.ts` provider modules + `app/src/app/api/integrations/oauth/[provider]/{connect,callback}/route.ts` handlers.
3. **Sprint 1.3** — refresh Edge Function + cron + Integrations UI OAuth buttons.

---

## Consequences

- **New table:** `oauth_states`. Tiny. Auto-expiring via cleanup cron.
- **Integrations UI gains two OAuth buttons** for Mailchimp + HubSpot. Existing API-key path preserved for customers who already configured it.
- **Daily cron `oauth-token-refresh-daily`** touches the HubSpot refresh endpoint for every active HubSpot connector whose access token nears expiry. Silent on healthy tokens.
- **Four new env vars** required on the deployed Vercel app. Without them, OAuth buttons show "not configured" messaging.
- **User must complete provider-side app registration** to get client_id/secret. HubSpot app review can take days; Mailchimp is near-instant.
- **V2-C1 closed.**

### Architecture Changes

None structural.

---

## Implementation Plan

### Sprint 1.1 — oauth_states migration

**Deliverables:**

- [x] `supabase/migrations/20260425000004_oauth_states.sql` — table + cleanup cron.

**Status:** `[x] complete` — 2026-04-17

### Sprint 1.2 — provider modules + connect/callback routes

**Deliverables:**

- [x] `app/src/lib/connectors/oauth/types.ts` + `mailchimp.ts` + `hubspot.ts`.
- [x] `app/src/app/api/integrations/oauth/[provider]/connect/route.ts`.
- [x] `app/src/app/api/integrations/oauth/[provider]/callback/route.ts`.

**Status:** `[x] complete` — 2026-04-17

### Sprint 1.3 — refresh Edge Function + UI

**Deliverables:**

- [x] `supabase/functions/oauth-token-refresh/index.ts` + cron entry.
- [x] Integrations table — "Connect Mailchimp" / "Connect HubSpot" OAuth buttons.

**Status:** `[x] complete` — 2026-04-17

---

## Test Results

Integration tests are deploy-dependent (OAuth handshake needs real client_id/secret + real provider). Unit-test coverage:

- [ ] `oauth_states` row creation + consumption idempotency (state can only be consumed once).
- [ ] Token-bundle shape parsing round-trip (encrypt → decrypt → use).

**Operator verification after registering OAuth apps:**

1. Set the four env vars on Vercel.
2. Visit `/dashboard/integrations`. Click "Connect Mailchimp". Complete Mailchimp's OAuth.
3. Confirm a new `integration_connectors` row with `connector_type='mailchimp'`, `config.auth_type='oauth2'`.
4. Trigger a test erasure and confirm dispatch succeeds.
5. Repeat for HubSpot.

---

## Changelog References

- `CHANGELOG-schema.md` — oauth_states table.
- `CHANGELOG-api.md` — connect/callback routes.
- `CHANGELOG-edge-functions.md` — oauth-token-refresh.
- `CHANGELOG-dashboard.md` — Integrations UI buttons.
- `CHANGELOG-docs.md` — ADR authored; V2-C1 closed.
