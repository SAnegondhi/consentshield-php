# Zero-storage load harness — ADR-1003 Sprint 3.2

(c) 2026 Sudhindra Anegondhi — internal docs.

100K-event load test for ADR-1003 Phase 1 + Phase 2 + Phase 3:

- **Mode A** — Worker `/v1/events` direct path (HMAC-signed).
- **Mode B** — customer-app `/api/v1/consent/record` Bearer path.

Both targets a zero-storage org and asserts the **buffer-row invariant** (zero rows in five buffer tables) holds throughout.

## Layout

```
tests/load/
├── README.md                    ← this file
├── run.sh                       ← orchestrator (probe + k6)
├── invariant-probe.ts           ← bun script polling buffer rows every 5s
├── k6/
│   ├── zero-storage-mode-a.js   ← k6 scenario: Worker /v1/events
│   └── zero-storage-mode-b.js   ← k6 scenario: /api/v1/consent/record
└── output/                      ← run artefacts (JSONL + JSON + log)
```

## Pre-requisites

- **k6** — install via `brew install k6` or run via Docker: `docker run -i --rm -v "$PWD:/work" -w /work grafana/k6 run …`.
- **bun** — already on the dev box.
- **A test org** with:
  - `storage_mode = 'zero_storage'` (operator action via `admin.set_organisation_storage_mode` or direct UPDATE if you're the operator).
  - A verified BYOS bucket OR a CS-managed R2 bucket with `is_verified=true`.
  - One published web property + banner (Mode A target).
  - One published API key (`cs_live_*` for sustained load; `cs_test_*` is rate-capped at 100/hr).
  - At least one published purpose definition.
- **Network** — outbound HTTPS to `https://cdn.consentshield.in` (Worker) and `https://app.consentshield.in` (customer app). For local dev, point WORKER_URL / API_BASE at your dev miniflare + Next.js.
- **DSN** — `SUPABASE_CS_ORCHESTRATOR_DATABASE_URL` (or `SUPABASE_CS_API_DATABASE_URL` as fallback) in `.env.local` so the invariant probe can read buffer-table counts.

## Running Mode A (Worker, 100K events)

```bash
# Required env (export or paste into .env.local — runner sources both):
export ORG_ID=<zero-storage-org-uuid>
export PROPERTY_ID=<test-property-uuid>
export BANNER_ID=<test-banner-uuid>
export EVENT_SIGNING_SECRET=<from public.web_properties.event_signing_secret>
export ORIGIN=https://test.consentshield.in
export WORKER_URL=https://cdn.consentshield.in

# Optional knobs:
export VUS=50
export ITERATIONS=100000
export MAX_DURATION=30m

tests/load/run.sh mode-a
```

Output goes to `tests/load/output/probe-mode-a-<ts>.{jsonl,summary}` and `k6-mode-a-<ts>.{json,log}`.

## Running Mode B (customer app, 100K records)

```bash
export ORG_ID=<zero-storage-org-uuid>
export PROPERTY_ID=<test-property-uuid>
export BEARER=cs_live_xxxxxxxxxxxxxxxx   # cs_test_* is capped at 100/hr — use a live key
export PURPOSE_DEFINITION_IDS=uuid1,uuid2 # comma-separated, valid for ORG_ID
export API_BASE=https://app.consentshield.in

tests/load/run.sh mode-b
```

To exercise the idempotent-replay code path during the same run, set `REPLAY_RATIO=0.1` (10% of iterations will collide on `client_request_id`).

## Pass criteria

| Metric | Threshold | Source |
|---|---|---|
| `http_req_failed` rate | < 0.5% | k6 |
| `http_req_duration` p95 | Mode A < 750ms · Mode B < 1500ms | k6 |
| `hmac_rejected` (Mode A only) | == 0 | k6 |
| `record_4xx` (Mode B only) | == 0 | k6 |
| **Buffer-row max during run** | **≤ 5** | invariant-probe |
| `consent_artefact_index` row delta | ≥ iterations × purposes (minus dedup) | post-run SQL |
| R2 bucket object count delta | ≥ iterations | post-run S3 list |

## Post-run verification

```sql
-- Buffer invariant (already polled live; this is the final check):
select 'consent_events'        as t, count(*) from public.consent_events        where org_id = '<ORG_ID>'
union all select 'tracker_observations', count(*) from public.tracker_observations where org_id = '<ORG_ID>'
union all select 'audit_log',            count(*) from public.audit_log            where org_id = '<ORG_ID>'
union all select 'processing_log',       count(*) from public.processing_log       where org_id = '<ORG_ID>'
union all select 'delivery_buffer',      count(*) from public.delivery_buffer      where org_id = '<ORG_ID>'
;
-- expected: every row reports 0.

-- Index growth:
select count(*) from public.consent_artefact_index where org_id = '<ORG_ID>';
-- expected: iterations × purposes (with idempotent replay collapsing duplicates).

-- Mode B identifier_hash sanity:
select count(*)
  from public.consent_artefact_index
 where org_id = '<ORG_ID>'
   and identifier_hash is null;
-- expected: 0 for Mode B runs (every row carries the salted hash);
-- non-zero for Mode A runs (Worker path leaves identifier_hash NULL).

-- worker_errors window (Mode A):
select status_code, count(*)
  from public.worker_errors
 where created_at > now() - interval '1 hour'
   and org_id = '<ORG_ID>'
 group by 1;
-- expected: zero rows.
```

R2 bucket object count: use whichever S3 client you have wired (`aws s3 ls --recursive`, `wrangler r2 object list`, or the customer's own tooling).

## Limits + known issues

- **k6 is single-machine.** Sustained 50 VUs × 100K iterations is fine on a laptop; for >500 VUs run k6 in a beefier box or Cloud k6.
- **Hyperdrive cold start.** First few iterations after a long idle may p99 high; the threshold accounts for it (p99 < 2-3s).
- **Replay-ratio caveat.** When `REPLAY_RATIO > 0`, the buffer-row invariant still holds, but `consent_artefact_index` row-count won't match iterations 1:1 — you'll see iterations × purposes × (1 - REPLAY_RATIO).
- **Sandbox rate cap.** `cs_test_*` keys are forced to `rate_tier='sandbox'` (100/hr per ADR-1003 Sprint 5.1). Use a `cs_live_*` key on a non-sandbox zero_storage org for sustained load tests.
- **No Worker-side rate limit on /v1/events.** The Worker accepts up to whatever Cloudflare's per-Worker concurrency allows. If you hit 429s from Cloudflare, drop VUS.

## What this harness DOES NOT cover

- `/v1/consent/verify` read-path performance under load. (Separate scenario, follow-up.)
- Mode A + Mode B concurrent against the same org. (Two simultaneous `run.sh` calls would do it; verify the combined buffer-row invariant by running ONE invariant probe, not two.)
- Cross-org concurrent load (multi-tenant interference).
- Cold-start storms (artificially flushing Hyperdrive / pool).

These belong in their own follow-up sprints if procurement asks for them.
