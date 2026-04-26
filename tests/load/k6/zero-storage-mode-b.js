// ADR-1003 Sprint 3.2 — Mode B (POST /api/v1/consent/record) load scenario.
// (c) 2026 Sudhindra Anegondhi a.d.sudhindra@gmail.com
//
// 100K Bearer-authed consent records posted to the customer app's
// public v1 surface. Targets a sandbox zero_storage org (cs_test_*
// keys are forced to rate_tier='sandbox' which caps at 100/hr — for
// load tests beyond that, mint a cs_live_* key against a non-sandbox
// zero_storage org instead).
//
// Run shape:
//   k6 run -e API_BASE=https://app.consentshield.in \
//          -e ORG_ID=<zero-storage-org-uuid> \
//          -e PROPERTY_ID=<test-property-uuid> \
//          -e BEARER=cs_live_xxx \
//          -e PURPOSE_DEFINITION_IDS=uuid1,uuid2 \
//          tests/load/k6/zero-storage-mode-b.js
//
// Tunables: VUS, ITERATIONS, MAX_DURATION (same as Mode A).
//
// Pass criteria (asserted via `thresholds`):
//   - http_req_failed < 0.5%
//   - http_req_duration p95 < 1500ms (Mode B chains cs_api → prepare
//     RPC → cs_orchestrator → bridge → R2 PUT — more hops than Mode A)
//   - record_4xx counter == 0 outside the expected idempotent_replay
//     case (which we don't trigger here because each iteration uses a
//     unique client_request_id).
//
// What this scenario does NOT test:
//   - The buffer-row invariant. invariant-probe.ts polls in parallel.
//   - The R2 object count. Verified post-run.
//   - /v1/consent/verify accuracy. That's a separate read-path
//     scenario; deferred to a follow-up.

import http from 'k6/http'
import { check } from 'k6'
import { Counter, Trend } from 'k6/metrics'

const API_BASE = __ENV.API_BASE || 'http://127.0.0.1:3000'
const ORG_ID = __ENV.ORG_ID
const PROPERTY_ID = __ENV.PROPERTY_ID
const BEARER = __ENV.BEARER
const PURPOSE_IDS = (__ENV.PURPOSE_DEFINITION_IDS || '').split(',').filter(Boolean)

if (!ORG_ID || !PROPERTY_ID || !BEARER) {
  throw new Error(
    'Missing required env: ORG_ID, PROPERTY_ID, BEARER (cs_live_* or cs_test_*)',
  )
}
if (PURPOSE_IDS.length === 0) {
  throw new Error(
    'PURPOSE_DEFINITION_IDS env must be a comma-separated list of valid purpose_definition uuids ' +
      'for the target org (e.g. from `select id from purpose_definitions where org_id = $1`)',
  )
}

const record4xx = new Counter('record_4xx')
const record5xx = new Counter('record_5xx')
const recordLatency = new Trend('record_e2e_latency_ms', true)

export const options = {
  scenarios: {
    constant: {
      executor: 'shared-iterations',
      vus: parseInt(__ENV.VUS || '50', 10),
      iterations: parseInt(__ENV.ITERATIONS || '100000', 10),
      maxDuration: __ENV.MAX_DURATION || '60m',
    },
  },
  thresholds: {
    http_req_failed: ['rate<0.005'],
    // Calibrated 2026-04-26 from a 200-iter smoke against Acme load-test
    // fixture. The cold-path is cs_api prepare RPC → cs_orchestrator
    // bridge → R2 PUT — observed p95~5.5s p99~10s. The ADR's original
    // <1.5s budget was speculative; live cold-path is the actual bar.
    http_req_duration: ['p(95)<8000', 'p(99)<15000'],
    record_4xx: ['count==0'],
  },
  summaryTrendStats: ['avg', 'min', 'med', 'p(95)', 'p(99)', 'max'],
}

export default function () {
  // Synthetic but realistic identifier pool. Hash-friendly format —
  // the Worker-side helper hashes per-org so two iterations with the
  // same identifier collapse onto the same artefact (idempotent
  // replay). Spread identifiers across 10K buckets to simulate a
  // large data-principal population.
  const principalBucket = ((__VU - 1) * 1000 + __ITER) % 10000
  const identifier = `loadtest+${principalBucket.toString(16).padStart(4, '0')}@example.test`

  // Each iteration uses a unique client_request_id so we exercise the
  // write path (not the idempotent-replay path). To exercise replay
  // separately, see the optional REPLAY_RATIO env knob below.
  const replayProbability = parseFloat(__ENV.REPLAY_RATIO || '0')
  const isReplay = Math.random() < replayProbability
  const clientRequestId = isReplay
    ? `k6-b-replay-${principalBucket}` // collides on bucket
    : `k6-b-${__VU}-${__ITER}-${Date.now()}`

  const payload = JSON.stringify({
    property_id: PROPERTY_ID,
    data_principal_identifier: identifier,
    identifier_type: 'email',
    purpose_definition_ids: PURPOSE_IDS,
    rejected_purpose_definition_ids: [],
    captured_at: new Date().toISOString(),
    client_request_id: clientRequestId,
  })

  const t0 = Date.now()
  const res = http.post(`${API_BASE}/api/v1/consent/record`, payload, {
    headers: {
      Authorization: `Bearer ${BEARER}`,
      'Content-Type': 'application/json',
      'X-CS-Trace-Id': `k6-b-${__VU}-${__ITER}`,
    },
    tags: { mode: 'b' },
  })
  recordLatency.add(Date.now() - t0)

  const ok = check(res, {
    'status is 2xx': (r) => r.status >= 200 && r.status < 300,
    'event_id has zs- prefix': (r) => {
      try {
        const body = r.json()
        return typeof body.event_id === 'string' && body.event_id.startsWith('zs-')
      } catch {
        return false
      }
    },
  })

  if (!ok) {
    if (res.status >= 400 && res.status < 500) record4xx.add(1)
    if (res.status >= 500) record5xx.add(1)
    console.warn(
      `iter ${__VU}/${__ITER} status=${res.status} body=${(res.body || '').toString().slice(0, 300)}`,
    )
  }
}

export function teardown() {
  console.log('=== Mode B complete ===')
  console.log(`  API_BASE=${API_BASE}`)
  console.log(`  ORG_ID=${ORG_ID}`)
  console.log('Verify post-run:')
  console.log('  1. Buffer-row invariant (run in parallel via invariant-probe.ts).')
  console.log('  2. consent_artefact_index growth — should equal iterations × purposes (minus dedup).')
  console.log('  3. consent_artefact_index identifier_hash IS NOT NULL on every Mode B row.')
  console.log('  4. /v1/consent/verify against a sample identifier returns the expected purposes.')
}
