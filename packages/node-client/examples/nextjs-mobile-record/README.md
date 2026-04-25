# Next.js mobile-record example

Next.js App Router API route that accepts a consent-event POST from a
mobile app and records it on ConsentShield via `client.recordConsent`.

## What it shows

- **Module-load init** — `ConsentShieldClient` constructed once at
  module evaluation time, reused across requests. `CS_API_KEY`
  validated at module-load (throws on misconfiguration during
  `next build` or first cold start, never inside a request).
- **Trace-id round-trip** — inbound `X-CS-Trace-Id` header propagates
  through `client.recordConsent({ traceId })` so the
  `consent_events.trace_id` row + R2 delivery record + downstream
  audit log all carry the same correlation id (per ADR-1014 Sprint
  3.2).
- **Error surface** — `ConsentShieldApiError` (4xx/5xx with RFC 7807
  body) is forwarded with status + problem; SDK synchronous validation
  gates (empty `purposeDefinitionIds` etc.) surface as HTTP 422;
  network/timeout failures return HTTP 502.

## Run

```sh
CS_API_KEY=cs_live_xxx pnpm dev
# Server listens on :3000 by default.

curl -X POST http://localhost:3000/api/consent \
     -H 'Content-Type: application/json' \
     -H 'X-CS-Trace-Id: mob-app-trace-12345' \
     -d '{
           "propertyId": "PROP_UUID",
           "dataPrincipalIdentifier": "user@example.com",
           "identifierType": "email",
           "purposeDefinitionIds": ["pd-marketing"],
           "capturedAt": "2026-04-25T10:00:00Z",
           "clientRequestId": "mob-uuid-abc"
         }'
```

The 201 response carries the recorded envelope + the same
`X-CS-Trace-Id` header you sent.
