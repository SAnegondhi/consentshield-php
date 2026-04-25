# `@consentshield/node`

Official Node.js client for the [ConsentShield](https://consentshield.in)
DPDP compliance API.

> **Status:** alpha (`1.0.0-alpha.1`). Sprint 1.1 of ADR-1006 Phase 1
> ships the client foundation (constructor + auth + transport + error
> hierarchy + `ping`). Per-endpoint methods (`verify`, `verifyBatch`,
> `recordConsent`, `revokeArtefact`, `triggerDeletion`, artefact CRUD,
> rights, audit) land in Sprints 1.2 / 1.3. v1.0.0 publication +
> integration examples ship in Sprint 1.4.

## Installation

```sh
npm install @consentshield/node
# or
pnpm add @consentshield/node
# or
yarn add @consentshield/node
```

Requires Node.js 18 or newer (uses the global `fetch` + `AbortController`).

## Quickstart

```ts
import { ConsentShieldClient } from '@consentshield/node'

const client = new ConsentShieldClient({
  apiKey: process.env.CS_API_KEY!, // must start with cs_live_
})

await client.ping() // → true on 200, throws on any failure
```

## Compliance posture

The defaults below are deliberately strict. They encode the
[v2 whitepaper §5.4](https://consentshield.in/docs/api-design/timeouts)
position that an unverifiable consent decision MUST default-CLOSED, never
default-open.

| Default | Value | Rationale |
|---|---|---|
| `timeoutMs` | 2 000 | Consent-decision budget. Above this and the SDK throws rather than block your hot path. |
| `maxRetries` | 3 | Exponential backoff on 5xx + transport errors only — never on 4xx, never on timeouts. |
| `failOpen` | `false` | A failed `verify` call throws `ConsentVerifyError`; calling code MUST treat the data principal as "consent NOT verified". Set `true` (or `CONSENT_VERIFY_FAIL_OPEN=true`) to opt into fail-open behaviour; the override writes to the customer's audit trail. |

## Error model

All errors descend from `ConsentShieldError`:

| Class | When |
|---|---|
| `ConsentShieldApiError` | Server returned a 4xx/5xx with an RFC 7807 problem document. `status` + `problem` fields exposed. |
| `ConsentShieldNetworkError` | Transport failure (DNS, TCP, TLS). Retried before surfacing. |
| `ConsentShieldTimeoutError` | Request exceeded `timeoutMs`. Never retried. |
| `ConsentVerifyError` | A `verify` call could not be evaluated AND `failOpen` is false (the default). Carries the underlying cause. |

Every error carries `traceId` lifted from the response's `X-CS-Trace-Id`
header (per [ADR-1014 Sprint 3.2](https://consentshield.in/docs/test-verification))
so server-side log correlation is one grep away when you report an issue.

## Configuration reference

```ts
new ConsentShieldClient({
  apiKey:    'cs_live_...',                   // required
  baseUrl?:  'https://app.consentshield.in',  // default
  timeoutMs?: 2_000,                          // default; positive finite number
  maxRetries?: 3,                             // default; non-negative integer
  failOpen?:  false,                          // default; honour CONSENT_VERIFY_FAIL_OPEN env when undefined
  fetchImpl?: typeof fetch,                   // override for tests
  sleepImpl?: (ms: number) => Promise<void>,  // override for tests
})
```

## License

(c) 2026 Sudhindra Anegondhi <a.d.sudhindra@gmail.com>. See `LICENSE.md`.
