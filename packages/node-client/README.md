# `@consentshield/node`

Official Node.js client for the [ConsentShield](https://consentshield.in)
DPDP compliance API. Fail-closed by default. 2-second per-request
timeout. Trace-id correlated.

## Installation

```sh
npm install @consentshield/node
# or
pnpm add @consentshield/node
# or
yarn add @consentshield/node
```

Requires Node.js 18 or newer (uses the global `fetch` +
`AbortController`). Ships dual ESM + CJS — `import` and `require`
both work.

## Quickstart

```ts
import { ConsentShieldClient } from '@consentshield/node'

const client = new ConsentShieldClient({
  apiKey: process.env.CS_API_KEY!, // must start with cs_live_
})

await client.ping() // → true on 200, throws on any failure
```

## Methods

### Consent

| Method | Route | Notes |
|---|---|---|
| `client.verify(input)` | `GET /v1/consent/verify` | Single-identifier check. Fail-closed by default. |
| `client.verifyBatch(input)` | `POST /v1/consent/verify/batch` | ≤ 10 000 identifiers per call (client-side cap matches the server). |
| `client.recordConsent(input)` | `POST /v1/consent/record` | Idempotency-keyed via `clientRequestId`. |
| `client.revokeArtefact(id, input)` | `POST /v1/consent/artefacts/{id}/revoke` | URL-encoded path. 409 on terminal-state. |

### Listing + cursor iteration

| Method | Route | Iterator helper |
|---|---|---|
| `client.listArtefacts(input?)` | `GET /v1/consent/artefacts` | `client.iterateArtefacts(...)` |
| `client.getArtefact(id)` | `GET /v1/consent/artefacts/{id}` | — |
| `client.listEvents(input?)` | `GET /v1/consent/events` | `client.iterateEvents(...)` |
| `client.listDeletionReceipts(input?)` | `GET /v1/deletion/receipts` | `client.iterateDeletionReceipts(...)` |
| `client.listRightsRequests(input?)` | `GET /v1/rights/requests` | `client.iterateRightsRequests(...)` |
| `client.listAuditLog(input?)` | `GET /v1/audit` | `client.iterateAuditLog(...)` |

### Deletion + rights

| Method | Route | Notes |
|---|---|---|
| `client.triggerDeletion(input)` | `POST /v1/deletion/trigger` | `purposeCodes` REQUIRED when `reason='consent_revoked'`. |
| `client.createRightsRequest(input)` | `POST /v1/rights/requests` | `identityVerifiedBy` required (DPB-facing audit trail). |

## Compliance posture

The defaults below are deliberately strict. They encode the
[v2 whitepaper §5.4](https://consentshield.in/docs/api-design/timeouts)
position that an unverifiable consent decision MUST default-CLOSED,
never default-open.

| Default | Value | Rationale |
|---|---|---|
| `timeoutMs` | 2 000 | Consent-decision budget. Above this and the SDK throws rather than block your hot path. |
| `maxRetries` | 3 | Exponential backoff on 5xx + transport errors only — never on 4xx, never on timeouts. |
| `failOpen` | `false` | A failed `verify` call throws `ConsentVerifyError`; calling code MUST treat the data principal as "consent NOT verified". Set `true` (or `CONSENT_VERIFY_FAIL_OPEN=true`) to opt into fail-open with audit-trail recording (see `onFailOpen`). |
| `onFailOpen` | structured `console.warn` | Production wiring — pass a custom callback that POSTs to your audit sink (Sentry / structured logger / a `/v1/audit` endpoint of your own). |

### Fail-open behaviour table for `verify` / `verifyBatch`

| Outcome | Default (`failOpen: false`) | Opt-in (`failOpen: true`) |
|---|---|---|
| 200 | returns `VerifyEnvelope` | returns `VerifyEnvelope` |
| timeout / network / 5xx | throws `ConsentVerifyError` | returns `OpenFailureEnvelope`; `onFailOpen` fires |
| 4xx (caller bug / scope / 422) | throws `ConsentShieldApiError` | throws `ConsentShieldApiError` (NEVER opens) |

The 4xx-always-throws rule is non-negotiable — a `failOpen` flag must
NEVER mask a real validation, scope, or auth error.

## Error model

All errors descend from `ConsentShieldError`:

| Class | When |
|---|---|
| `ConsentShieldApiError` | Server returned a 4xx/5xx with an RFC 7807 problem document. `status` + `problem` fields exposed. |
| `ConsentShieldNetworkError` | Transport failure (DNS, TCP, TLS). Retried before surfacing. |
| `ConsentShieldTimeoutError` | Request exceeded `timeoutMs`. Never retried. |
| `ConsentVerifyError` | A `verify` call could not be evaluated AND `failOpen` is false (the default). Carries the underlying cause. |

Every error carries `traceId` lifted from the response's
`X-CS-Trace-Id` header (per [ADR-1014 Sprint 3.2](https://consentshield.in/docs/test-verification))
so server-side log correlation is one grep away when you report an
issue.

## Configuration reference

```ts
new ConsentShieldClient({
  apiKey:    'cs_live_...',                   // required
  baseUrl?:  'https://app.consentshield.in',  // default
  timeoutMs?: 2_000,                          // default; positive finite number
  maxRetries?: 3,                             // default; non-negative integer
  failOpen?:  false,                          // default; honour CONSENT_VERIFY_FAIL_OPEN env when undefined
  onFailOpen?: (env, ctx) => { /* audit */ }, // default: structured console.warn
  fetchImpl?: typeof fetch,                   // override for tests
  sleepImpl?: (ms: number) => Promise<void>,  // override for tests
})
```

## Examples

| Path | What |
|---|---|
| [`examples/express-verify-middleware/`](./examples/express-verify-middleware) | Express middleware that verifies consent before every request and refuses with HTTP 451 on `revoked` / `never_consented`. |
| [`examples/nextjs-mobile-record/`](./examples/nextjs-mobile-record) | Next.js App Router API route that records consent from a mobile-app POST and propagates `X-CS-Trace-Id` for end-to-end correlation. |

## License

Apache License 2.0. Copyright 2026 Sudhindra Anegondhi
<a.d.sudhindra@gmail.com>. See `LICENSE` for the full text and
`NOTICE` for the trademark carve-out.
