# Zero-Storage 100K-event benchmark

(c) 2026 Sudhindra Anegondhi a.d.sudhindra@gmail.com

> **Status: template — populated after the first live run.**
>
> This file is the canonical place to record results from the
> `tests/load/` harness (ADR-1003 Sprint 3.2). Every section below has
> a placeholder `TBD` line. Replace with real numbers + the JSON
> summary path after running `tests/load/run.sh mode-{a,b}`.

## Run summary

| Field | Value |
|---|---|
| Run date (UTC) | TBD |
| Operator | TBD |
| Target org_id | TBD |
| Org type | sandbox / non-sandbox zero_storage |
| BYOS bucket | TBD (provider + region) |
| Worker version (commit) | TBD |
| Customer-app version (commit) | TBD |
| Supabase project | xlqiakmkdjycfiioslgs (consent-sheild) |
| k6 version | TBD |

## Mode A — Worker `/v1/events`

Scenario: `tests/load/k6/zero-storage-mode-a.js`

| Metric | Result | Threshold | Pass? |
|---|---|---|---|
| Total iterations | 100,000 | — | — |
| Sustained throughput | TBD events/sec | ≥ 50 | TBD |
| http_req_failed rate | TBD | < 0.5% | TBD |
| http_req_duration p50 | TBD ms | — | — |
| http_req_duration p95 | TBD ms | < 750 | TBD |
| http_req_duration p99 | TBD ms | < 2000 | TBD |
| hmac_rejected (counter) | TBD | == 0 | TBD |
| Worker_errors window total | TBD | == 0 | TBD |
| consent_artefact_index delta | TBD | iter × purposes | TBD |
| R2 object count delta | TBD | ≥ iter | TBD |
| **Buffer-row max during run** | **TBD** | **≤ 5** | **TBD** |

JSON summary: `tests/load/output/k6-mode-a-<ts>.json`
Probe samples: `tests/load/output/probe-mode-a-<ts>.jsonl`

## Mode B — `/api/v1/consent/record`

Scenario: `tests/load/k6/zero-storage-mode-b.js`

| Metric | Result | Threshold | Pass? |
|---|---|---|---|
| Total iterations | 100,000 | — | — |
| Sustained throughput | TBD records/sec | ≥ 30 | TBD |
| http_req_failed rate | TBD | < 0.5% | TBD |
| http_req_duration p50 | TBD ms | — | — |
| http_req_duration p95 | TBD ms | < 1500 | TBD |
| http_req_duration p99 | TBD ms | < 3000 | TBD |
| record_4xx (counter) | TBD | == 0 | TBD |
| record_5xx (counter) | TBD | == 0 | TBD |
| consent_artefact_index delta | TBD | iter × purposes | TBD |
| identifier_hash NULL count | TBD | == 0 | TBD |
| R2 object count delta | TBD | ≥ iter | TBD |
| **Buffer-row max during run** | **TBD** | **≤ 5** | **TBD** |

JSON summary: `tests/load/output/k6-mode-b-<ts>.json`
Probe samples: `tests/load/output/probe-mode-b-<ts>.jsonl`

## Resource impact (during run)

| Resource | Observation | Notes |
|---|---|---|
| Hyperdrive query rate | TBD | from CF dashboard |
| Hyperdrive p99 query | TBD ms | |
| Worker CPU time | TBD ms p95 | from CF dashboard |
| Worker invocation count | TBD | should ≈ iterations |
| Supabase compute units | TBD | from project usage |
| Supabase pooler connection peak | TBD | ≤ Supavisor limit |
| R2 PUT operations | TBD | ≈ iter × purposes |
| KV read rate (storage_mode resolve) | TBD | hot-cache should dominate |

## Cost (rough)

| Item | Unit cost | Quantity | Cost (USD) |
|---|---|---|---|
| Worker invocations | $0.30/M | TBD | TBD |
| Hyperdrive queries | included in Workers Paid plan | — | — |
| Supabase egress | $0.09/GB | TBD | TBD |
| R2 PUT | $4.50/M | TBD | TBD |
| **Total** | | | **TBD** |

## Observations + follow-ups

- TBD (e.g. "p99 spikes correlated with Hyperdrive cold-start; first 30s above SLA")
- TBD ("worker_errors during run: 0 / 47 of which 47 mapped to origin-only retries")
- TBD ("identifier_hash collision audit: zero collisions across 10K-bucket spread")

## Re-run cadence

- Every Phase 3 close-out beyond Sprint 3.2 (any future change to the buffer pipeline OR the bridge OR rpc_consent_record).
- Quarterly otherwise.

## Verdict

**Overall:** TBD (PASS / FAIL).

If PASS, ADR-1003 Sprint 3.2 closes ADR-1003 entirely. If FAIL, the failing metric drives a follow-up ADR (or Sprint 3.3).
