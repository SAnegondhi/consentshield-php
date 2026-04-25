# Express verify-middleware example

Express middleware that verifies marketing-purpose consent before
allowing a `/api/marketing/send` request to reach the handler.

## How it works

`consentRequired(client, options)` returns an Express request handler
that:

1. Reads the data-principal identifier off the request via the
   caller-supplied `getIdentifier(req)`.
2. Calls `client.verify(...)` against the configured property +
   purpose.
3. Branches on the result:

| Outcome | HTTP response | Notes |
|---|---|---|
| `status: 'granted'` | passes through to `next()` | response carries `X-CS-Trace-Id` header for end-to-end correlation |
| `status: 'revoked'` / `'expired'` / `'never_consented'` | **451 Unavailable For Legal Reasons** | with the verify envelope in the body |
| `failOpen=true` returned `OpenFailureEnvelope` | passes through with `X-CS-Override` header | the override is recorded by the SDK via `onFailOpen` |
| `ConsentVerifyError` thrown (fail-CLOSED default) | **503 Service Unavailable** | NEVER default-grants — the data principal stays protected |
| `ConsentShieldApiError` thrown (4xx) | **502 Bad Gateway** | with the original status surfaced in the body |

## Run

```sh
CS_API_KEY=cs_live_xxx CS_PROPERTY_ID=PROP_UUID bun examples/express-verify-middleware/app.ts

curl -X POST http://localhost:4040/api/marketing/send \
     -H 'Content-Type: application/json' \
     -d '{"email":"user@example.com","subject":"Hello"}'
```

## Why fail-CLOSED → 503 (not 200)

Defaulting to "send the email anyway" when ConsentShield is briefly
unreachable is the worst DPDP outcome — you might mail a user whose
consent was withdrawn 30 seconds ago. The SDK's fail-CLOSED default
forces the question: do you treat ConsentShield as a hard dependency
(503 → caller retries) or do you opt into fail-open (`failOpen: true`
+ wire `onFailOpen` to your audit sink)? Either is defensible; the
default is the safe one.
