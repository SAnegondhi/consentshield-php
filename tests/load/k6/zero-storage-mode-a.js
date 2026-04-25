// ADR-1003 Sprint 3.2 — Mode A (Worker /v1/events) load scenario.
// (c) 2026 Sudhindra Anegondhi a.d.sudhindra@gmail.com
//
// 100K HMAC-signed consent events posted directly to the Cloudflare
// Worker. Targets a zero_storage org so the Sprint 1.3 invariant is
// the primary thing under test: zero buffer rows during sustained
// load, while consent_artefact_index grows + R2 receives every object.
//
// Run shape:
//   k6 run -e WORKER_URL=https://cdn.consentshield.in \
//          -e ORG_ID=<sandbox-zero-storage-org-uuid> \
//          -e PROPERTY_ID=<test-property-uuid> \
//          -e BANNER_ID=<test-banner-uuid> \
//          -e EVENT_SIGNING_SECRET=<from web_properties.event_signing_secret> \
//          -e ORIGIN=https://test.consentshield.in \
//          tests/load/k6/zero-storage-mode-a.js
//
// Tunables:
//   --vus N        concurrent virtual users (default 50)
//   --iterations M total events (default 100000)
//   Or use the stages config below for a ramp.
//
// Pass criteria (asserted via `thresholds`):
//   - http_req_failed < 0.5%
//   - http_req_duration p95 < 750ms (Worker writes are fast; Hyperdrive
//     adds ~20-40ms; allow generous margin for slow lanes)
//   - hmac_rejected counter == 0 (any 403 from /v1/events is a fail)
//
// What this scenario does NOT test:
//   - The buffer-row invariant. That's the job of the sibling
//     `invariant-probe.ts` running in parallel during this scenario.
//   - The R2 object count. Verified after the run by listing the
//     customer's R2 bucket and asserting `count >= iterations`.

import http from 'k6/http'
import crypto from 'k6/crypto'
import { check, fail } from 'k6'
import { Counter, Trend } from 'k6/metrics'

const WORKER_URL = __ENV.WORKER_URL || 'http://127.0.0.1:8787'
const ORG_ID = __ENV.ORG_ID
const PROPERTY_ID = __ENV.PROPERTY_ID
const BANNER_ID = __ENV.BANNER_ID
const EVENT_SIGNING_SECRET = __ENV.EVENT_SIGNING_SECRET
const ORIGIN = __ENV.ORIGIN || 'https://test.consentshield.in'

// Pre-flight env validation. k6 doesn't have a setup hook for "fail
// if env missing" — fail() in iteration is the equivalent.
if (!ORG_ID || !PROPERTY_ID || !BANNER_ID || !EVENT_SIGNING_SECRET) {
  throw new Error(
    'Missing required env: ORG_ID, PROPERTY_ID, BANNER_ID, EVENT_SIGNING_SECRET',
  )
}

const hmacRejected = new Counter('hmac_rejected')
const fingerprintLatency = new Trend('event_e2e_latency_ms', true)

export const options = {
  // Default: ramp 0 → 50 VUs, hold for 100K iterations, ramp down.
  // Override with --vus / --iterations on the CLI.
  scenarios: {
    constant: {
      executor: 'shared-iterations',
      vus: parseInt(__ENV.VUS || '50', 10),
      iterations: parseInt(__ENV.ITERATIONS || '100000', 10),
      maxDuration: __ENV.MAX_DURATION || '30m',
    },
  },
  thresholds: {
    http_req_failed: ['rate<0.005'],
    http_req_duration: ['p(95)<750', 'p(99)<2000'],
    hmac_rejected: ['count==0'],
  },
  // Don't drown the report in per-status breakdowns; we only care about
  // 200 vs all-other.
  summaryTrendStats: ['avg', 'min', 'med', 'p(95)', 'p(99)', 'max'],
}

// k6 crypto.hmac returns a hex string; matches the Worker's verifyHMAC
// which expects hex.
function sign(orgId, propertyId, timestamp, secret) {
  const message = `${orgId}${propertyId}${timestamp}`
  return crypto.hmac('sha256', secret, message, 'hex')
}

export default function () {
  const timestamp = String(Date.now())
  const signature = sign(ORG_ID, PROPERTY_ID, timestamp, EVENT_SIGNING_SECRET)

  // Mix of accept/reject events so we exercise both code paths.
  // 80% accept / 20% reject — production-realistic.
  const eventType = Math.random() < 0.8 ? 'accept' : 'reject'

  const payload = JSON.stringify({
    org_id: ORG_ID,
    property_id: PROPERTY_ID,
    banner_id: BANNER_ID,
    event_type: eventType,
    timestamp,
    signature,
    purposes_accepted: eventType === 'accept' ? ['analytics', 'marketing'] : [],
    purposes_rejected: eventType === 'reject' ? ['analytics', 'marketing'] : [],
    user_agent: 'k6-load/zero-storage-mode-a',
    metadata: {
      // Stable trace id per VU+iter so a partial failure can be
      // grepped out of the worker_errors table.
      trace_id: `k6-a-${__VU}-${__ITER}`,
    },
  })

  const t0 = Date.now()
  const res = http.post(`${WORKER_URL}/v1/events`, payload, {
    headers: {
      'Content-Type': 'application/json',
      Origin: ORIGIN,
      'X-CS-Trace-Id': `k6-a-${__VU}-${__ITER}`,
    },
    tags: { event_type: eventType },
  })
  fingerprintLatency.add(Date.now() - t0)

  const ok = check(res, {
    'status is 2xx': (r) => r.status >= 200 && r.status < 300,
  })

  if (!ok) {
    if (res.status === 403) hmacRejected.add(1)
    // Fail loudly enough to surface in the run summary but not so loud
    // that one bad VU explodes the harness — k6 reports failures via
    // checks + thresholds.
    console.warn(
      `iter ${__VU}/${__ITER} status=${res.status} body=${(res.body || '').toString().slice(0, 200)}`,
    )
  }
}

// Optional teardown. k6 prints summary automatically; this is the hook
// for any post-run assertions (e.g. fetching worker_errors count).
export function teardown() {
  console.log('=== Mode A complete ===')
  console.log(`  WORKER_URL=${WORKER_URL}`)
  console.log(`  ORG_ID=${ORG_ID}`)
  console.log('Verify post-run:')
  console.log('  1. Buffer-row invariant (run in parallel via invariant-probe.ts).')
  console.log('  2. consent_artefact_index growth: select count(*) from public.consent_artefact_index where org_id = $1.')
  console.log('  3. R2 bucket object count delta.')
  console.log('  4. worker_errors window for this run: select count(*) from public.worker_errors where created_at > <run_start>.')
}
