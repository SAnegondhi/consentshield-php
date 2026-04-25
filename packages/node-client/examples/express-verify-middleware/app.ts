// ADR-1006 Phase 1 Sprint 1.4 — Express middleware demo. Run:
//
//   CS_API_KEY=cs_live_... CS_PROPERTY_ID=... bun examples/express-verify-middleware/app.ts
//
// Then POST a request:
//
//   curl -X POST http://localhost:4040/api/marketing/send \
//        -H 'Content-Type: application/json' \
//        -d '{"email":"user@example.com","subject":"Hello"}'
//
// Expected outcomes:
//   - 200 when ConsentShield reports `granted` for the marketing purpose.
//   - 451 when reported `revoked` / `expired` / `never_consented`.
//   - 503 when ConsentShield is unreachable (fail-CLOSED default).

import express from 'express'
import { ConsentShieldClient } from '@consentshield/node'
import { consentRequired } from './middleware'

const apiKey = process.env.CS_API_KEY
const propertyId = process.env.CS_PROPERTY_ID
if (!apiKey || !propertyId) {
  console.error('CS_API_KEY and CS_PROPERTY_ID env vars are required')
  process.exit(1)
}

const client = new ConsentShieldClient({ apiKey })

const app = express()
app.use(express.json())

app.post(
  '/api/marketing/send',
  consentRequired(client, {
    propertyId,
    purposeCode: 'marketing',
    identifierType: 'email',
    getIdentifier: (req) => req.body.email,
  }),
  (req, res) => {
    // Marketing-send happens here. ConsentShield has confirmed `granted`
    // for the recipient's marketing purpose; the trace id is on
    // X-CS-Trace-Id (response header) for end-to-end correlation.
    res.json({ sent: true, recipient: req.body.email })
  },
)

const port = Number(process.env.PORT ?? 4040)
app.listen(port, () => {
  console.log(`@consentshield/node example listening on :${port}`)
})
