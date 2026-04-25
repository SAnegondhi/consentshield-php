# Zero-Storage feature matrix (gap inventory)

(c) 2026 Sudhindra Anegondhi a.d.sudhindra@gmail.com

> ADR-1003 Sprint 3.2 deliverable. Catalogues every customer-visible feature in ConsentShield, classified as it behaves in the three storage modes:
>
> - **Standard** — Worker → Supabase buffer → delivery loop → customer storage. Default.
> - **Insulated** — Worker → Supabase buffer (encrypted at rest with per-org key) → delivery loop → customer storage. Same buffer footprint as Standard with stronger at-rest protection.
> - **Zero-Storage** — Worker → bridge → customer R2/S3 directly + `consent_artefact_index` (TTL-managed lookup table only). Five buffer tables hold zero rows.
>
> A row is **green ✅** if the feature works identically across modes, **amber ⚠** if it works but with degraded UX or capabilities under Zero-Storage, **red ❌** if it is genuinely unavailable in Zero-Storage and a customer must work around it.
>
> Last reviewed: 2026-04-25 (Sprint 5.1 close).

## Capture (write path)

| Feature | Standard | Insulated | Zero-Storage | Notes |
|---|:---:|:---:|:---:|---|
| Worker `/v1/events` (Mode A) | ✅ | ✅ | ✅ | Sprint 1.2 — Worker branches on `storage_mode` KV cache; zero-storage path skips buffer + posts to bridge. |
| `/api/v1/consent/record` (Mode B) | ✅ | ✅ | ✅ | Sprint 1.4 — `rpc_consent_record` storage-mode fence + `rpc_consent_record_prepare_zero_storage` validation-only RPC. |
| `/api/v1/consent/verify` (read) | ✅ | ✅ | ✅ | Reads `consent_artefact_index`. Mode A fingerprint match (NULL identifier_hash) + Mode B identifier_hash match both work. |
| `/api/v1/consent/artefacts/[id]/revoke` | ✅ | ✅ | ✅ | Revocation semantics unchanged; the revocation event flows through the same write path. |
| Banner script v2 (browser) | ✅ | ✅ | ✅ | The banner script doesn't know about storage_mode; the Worker decides the data plane behind it. |

## Replay + idempotency

| Feature | Standard | Insulated | Zero-Storage | Notes |
|---|:---:|:---:|:---:|---|
| Idempotent retry of a consent event | ✅ | ✅ | ✅ | Mode A: deterministic Worker-side dedup key. Mode B: `client_request_id` → fingerprint → `ON CONFLICT DO NOTHING` on the index. |
| Re-export FROM the buffer | ✅ | ✅ | ❌ | Buffer holds nothing in Zero-Storage. Customer must replay from THEIR bucket. |
| Replay a single event ID after delivery confirmation | ✅ (rebuild from `delivery_buffer`) | ✅ | ❌ | Same root cause — no buffer rows. |

## Read + audit + audit-export

| Feature | Standard | Insulated | Zero-Storage | Notes |
|---|:---:|:---:|:---:|---|
| Per-org compliance score | ✅ | ✅ | ✅ | Computed from `consent_artefact_index` + `purpose_definitions`; both populated under Zero-Storage. |
| Cross-customer compliance benchmarks | ✅ | ✅ | ⚠ excluded | Sandbox + zero-storage rows can be filtered via `public.depa_compliance_metrics_prod` view (Sprint 5.1 R2). Zero-storage prod orgs ARE included. |
| Dashboard "consent events list" view | ✅ | ✅ | ❌ | The view reads from `consent_events`. In Zero-Storage there are no rows; customer reads from THEIR bucket instead. The dashboard surface needs an explicit "ConsentShield does not retain raw events; fetch from your bucket" placeholder for zero-storage orgs (follow-up UI ticket). |
| Audit-export ZIP | ⚠ | ⚠ | ⚠ | The ZIP carries the artefact index, purpose definitions, score, banner config, etc. RAW EVENT BYTES live in customer bucket (Standard + Insulated also push there post-delivery; Zero-Storage just skips the intermediate copy). Manifest now carries `sandbox: <bool>` (Sprint 5.1 R2). |
| `audit_log` table (admin-side reads) | ✅ | ✅ | ❌ | Same as consent events list — Zero-Storage means no audit_log rows. Customer's bucket is the audit record. |
| DPB / regulator audit reconstruction | ✅ via DB query | ✅ via DB query | ⚠ via bucket-listing | Customer responsibility under Zero-Storage. Bucket layout `<org_id>/<year>/<month>/<artefact_id>.json` recommended (per `docs/customer-docs/healthcare-onboarding.md`). |

## Rights flows

| Feature | Standard | Insulated | Zero-Storage | Notes |
|---|:---:|:---:|:---:|---|
| Right to Access | ✅ | ✅ | ⚠ | The artefact-index portion is exported as before. Raw events / personal data MUST come from the customer's bucket — ConsentShield doesn't have them. |
| Right to Erasure / Deletion | ✅ | ✅ | ✅ | Deletion-orchestrator API + connector fan-out are unchanged. Customer is responsible for purging their own bucket on receipt of the callback. |
| Right to Withdraw consent | ✅ | ✅ | ✅ | Revocation event flows through the same write path; index row state moves to `revoked`. |
| Right to Correct | ✅ | ✅ | ✅ | The artefact metadata is mutable via the standard correction RPC; the affected raw event in the customer bucket is the customer's responsibility. |

## Storage mechanics

| Feature | Standard | Insulated | Zero-Storage | Notes |
|---|:---:|:---:|:---:|---|
| BYOK customer R2 / S3 bucket | optional | required | required | Sprint 2.1/2.2 — scope-down probe + customer docs. |
| BYOS scope-down enforcement | ✅ | ✅ | ✅ | The same probe runs everywhere; zero-storage customers cannot relax it. |
| `consent_artefact_index` TTL refresh | ✅ | ✅ | ✅ | Sprint 3.1 — `refresh_zero_storage_index_hot_rows()` extends TTL on hot rows; cold rows expire. |
| Re-hydration of expired index rows | ⚠ from buffer | ⚠ from buffer | ⚠ via customer replay | Customer-driven via `/v1/consent/record` re-call. |
| Encryption at rest on the buffer | yes (Supabase) | yes + per-org key (extra) | n/a (no buffer) | Insulated's per-org key derivation unused under Zero-Storage. |

## Operational

| Feature | Standard | Insulated | Zero-Storage | Notes |
|---|:---:|:---:|:---:|---|
| `check-stuck-buffers` watchdog | actively guards | actively guards | n/a | No buffer rows to watch. |
| Worker error logging (`worker_errors`) | ✅ | ✅ | ✅ | The error path runs irrespective of storage_mode. |
| Sentry escalations | ✅ | ✅ | ✅ | Same — no FHIR / no PII reaches Sentry per `beforeSend`. |
| Probe runs (consent + storage) | ✅ | ✅ | ✅ | Probe targets the same surfaces. |
| Compliance probes against banner script | ✅ | ✅ | ✅ | The banner script is mode-agnostic. |

## Sandbox

| Feature | Standard | Insulated | Zero-Storage | Notes |
|---|:---:|:---:|:---:|---|
| Sandbox org provisioning | ✅ | ✅ | ✅ | Sprint 5.1 — `rpc_provision_sandbox_org`. Defaults to standard mode; admin can flip to zero_storage post-provisioning. |
| `cs_test_*` API key | ✅ | ✅ | ✅ | Sprint 5.1 — `rpc_api_key_create` forces `cs_test_*` prefix and `rate_tier='sandbox'` on sandbox orgs. |
| Test-principal generator | ✅ | ✅ | ✅ | Sprint 5.1 — `POST /api/v1/sandbox/test-principals`. |
| Sandbox + Zero-Storage combined | ✅ | ✅ | ✅ | Healthcare onboarding tutorial walks this flow specifically. |

## Plan / billing

| Feature | Standard | Insulated | Zero-Storage | Notes |
|---|:---:|:---:|:---:|---|
| Plan-tier rate limits | ✅ | ✅ | ✅ | `api_keys.rate_tier` is the source of truth across all modes. |
| Plan-tier max_orgs | ✅ | ✅ | ✅ | Counts both prod + sandbox orgs in the same account toward `max_organisations`. (Sandbox orgs ARE counted today; consider exclusion in v2 if procurement asks.) |
| Razorpay subscription billing | ✅ | ✅ | ✅ | Billing is account-level; mode-agnostic. |
| Material-change re-consent campaigns | ✅ | ✅ | ⚠ | The campaign reads from `notices` + `consent_artefacts` index; works the same. The fan-out emails are sent against artefact index pointers, not raw event PII. |

## Healthcare-specific

| Feature | Standard | Insulated | Zero-Storage | Notes |
|---|:---:|:---:|:---:|---|
| Healthcare Starter template apply | ❌ (P0004) | ❌ (P0004) | ✅ | Sprint 4.1 — template's `default_storage_mode='zero_storage'` gate refuses non-zero-storage orgs at apply time. |
| ABDM consent-artefact mirroring | ✅ | ✅ | ✅ | The ABDM artefact ID is metadata; ConsentShield mirrors it without storing health content. |
| FHIR / clinical-content storage | ❌ (Rule 3) | ❌ (Rule 3) | ❌ (Rule 3) | Hard architectural constraint — never persisted in any mode, anywhere. |

## Item legend

- ✅ — works, no behaviour difference visible to the customer.
- ⚠ — works with caveats; the customer needs to know what's different (call it out in onboarding docs).
- ❌ — genuinely unavailable. Customer must work around (typically by reading from their own bucket).

## How to use this matrix

- **Sales / procurement** — share with prospects evaluating Zero-Storage so they understand the operational delta upfront.
- **Customer onboarding** — every ❌ row maps to a section the customer-onboarding doc must address explicitly.
- **Engineering** — when adding a new feature, walk every section and flag mode-specific behaviour. Update this file in the same sprint that ships the feature.

## Open follow-ups (graduated to V2-BACKLOG or future ADRs)

- Dashboard "consent events list" view needs an explicit zero-storage placeholder card. (V2 candidate.)
- Optional admin-side aggregator that reads `depa_compliance_metrics_prod` for percentile rankings. (Sprint 5.1 R2 prep'd the view; aggregator UI is V2.)
- Sandbox-orgs-don't-count-toward-max_organisations rule (subjective; defer until customer asks). (V2.)
- Customer-side bucket replay tooling (a CLI that walks a bucket prefix and replays events through `/api/v1/consent/record`). (V2; tracked separately.)
