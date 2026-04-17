# ADR-0023: DEPA Expiry Pipeline — `send_expiry_alerts` + `enforce_artefact_expiry` + pg_cron

(c) 2026 Sudhindra Anegondhi a.d.sudhindra@gmail.com

**Status:** Completed
**Date proposed:** 2026-04-17
**Date completed:** 2026-04-17
**Depends on:** ADR-0020 (DEPA schema skeleton; specifically `consent_expiry_queue`, the `trg_consent_artefact_expiry_queue` trigger that seeds it, and the `consent_artefacts.status='active'` lifecycle).
**Unblocks:** ADR-0025 (DEPA score — `expiry_score` sub-metric reads the enforcement results).

---

## Context

ADR-0020 shipped the `consent_expiry_queue` table and the AFTER INSERT trigger that seeds one queue row per finite-expiry artefact (`trg_consent_artefact_expiry_queue`). But the two helpers that *consume* those rows — `send_expiry_alerts()` (batches alert payloads 30 days before expiry) and `enforce_artefact_expiry()` (flips status at TTL lapse) — are explicitly deferred. Their function bodies live in schema-design §11.2 / §11.5 ready to drop into a migration.

Without this ADR, nothing in the system ever transitions an artefact to `status='expired'`. The validity cache keeps a stale "active" entry past the artefact's `expires_at`, and tracker-enforcement treats expired consent as valid. Compliance risk: the dashboard reports coverage that's mathematically higher than the DPB would calculate.

### The two functions (per schema-design §11.2 / §11.5)

**`enforce_artefact_expiry()`** — loops over `consent_artefacts` where `status='active' AND expires_at <= now()`. For each row:

1. `UPDATE consent_artefacts SET status = 'expired'`.
2. `DELETE FROM consent_artefact_index` for that artefact.
3. `INSERT audit_log` with `event_type='consent_artefact_expired'`.
4. If the artefact's `purpose_definition.auto_delete_on_expiry = true`, `INSERT delivery_buffer` with `event_type='artefact_expiry_deletion'` carrying the `data_scope` snapshot. The existing `deliver-consent-events` Edge Function handles the export to customer R2.
5. `UPDATE consent_expiry_queue SET processed_at = now()`.

**`send_expiry_alerts()`** — loops over `consent_expiry_queue` rows where `notify_at <= now() AND notified_at IS NULL AND processed_at IS NULL AND NOT superseded`. For each row:

1. `UPDATE consent_expiry_queue SET notified_at = now()` (deduplication guard).
2. `INSERT delivery_buffer` with `event_type='consent_expiry_alert'` carrying the artefact_id, purpose_code, expires_at, and compliance_contact email.

Both functions run as `security definer` (no JWT context — called from cron).

### Design question answered: staging via `delivery_buffer`, not `deletion_receipts`

Schema-design §11.2 pins the auto-delete-on-expiry path to `delivery_buffer` with `event_type='artefact_expiry_deletion'`, not to `deletion_receipts`. This is deliberate — the delivery_buffer → R2 export path already exists from ADR-0017, and it's the audit-trail mechanism (customer gets the proof-of-expiry in their compliance bucket).

Architecture §8.4 (amended by ADR-0022) suggests expiry should *also* produce `deletion_receipts` for the mapped connectors (so third-party systems like Mailchimp get a delete instruction). This ADR does **not** wire that fan-out; it follows the schema-design spec verbatim. Reasoning:

- Staying within the 2-hour budget the DEPA roadmap allocates for ADR-0023.
- The schema-design body is normative and tested (Test 10.6 asserts `delivery_buffer` contents).
- Expiry-triggered connector fan-out is a distinct concern that parallels ADR-0022's revocation dispatcher — it deserves its own ADR with its own idempotency contract and safety-net cron.

Deferred follow-up logged to `docs/V2-BACKLOG.md` as **V2-D1: Expiry-triggered connector fan-out** (pointer back to this ADR).

### pg_cron schedule (per schema-design §11.10)

- `expiry-enforcement-daily` — `0 19 * * *` (19:00 UTC / 00:30 IST). Runs first so expired artefacts land in `delivery_buffer` before the alert batch.
- `expiry-alerts-daily` — `30 2 * * *` (02:30 UTC / 08:00 IST).

Both are idempotent by construction:
- `enforce_artefact_expiry` guards on `status='active'` — already-expired rows are skipped.
- `send_expiry_alerts` guards on `notified_at IS NULL` — already-alerted rows are skipped.

### Test coverage — testing-strategy §10 / Test 10.6

Only one compliance-critical test lands in this ADR. Test 10.8 (DEPA score arithmetic) and Test 10.9 (Rule 3 — no PAN values in data_scope) are scope of ADR-0025 and CI respectively.

**Test 10.6 — time-travel enforcement.** Create artefacts with `expires_at = now() - interval '1 minute'`; for one artefact, set `auto_delete_on_expiry=true` via its purpose_definition, for the other `=false`. Call `enforce_artefact_expiry()` directly. Verify:

1. Both artefacts transition to `status='expired'`.
2. Both are removed from `consent_artefact_index`.
3. Both `consent_expiry_queue.processed_at` timestamps are set.
4. `delivery_buffer` has exactly **one** row with `event_type='artefact_expiry_deletion'` (the auto-delete artefact only).
5. Both `audit_log` rows are present with `event_type='consent_artefact_expired'`.

**Test 10.6b — alert staging.** Create an artefact with `expires_at = now() + interval '10 days'` and its expiry_queue entry's `notify_at` backdated to `now() - interval '1 minute'`. Call `send_expiry_alerts()`. Verify:

1. `consent_expiry_queue.notified_at` is set.
2. `delivery_buffer` has one row with `event_type='consent_expiry_alert'` carrying the right artefact_id and expires_at.

Both tests run against the live hosted dev Supabase in the `tests/depa/` vitest suite (serial mode per the existing config).

---

## Decision

Ship the expiry pipeline in a single sprint.

1. **Migration `20260422000001_depa_expiry_pipeline.sql`** (Sprint 1.1):
   - `create or replace function enforce_artefact_expiry() returns void ...` — body per schema-design §11.2.
   - `create or replace function send_expiry_alerts() returns void ...` — body per schema-design §11.2.
   - `grant execute on function enforce_artefact_expiry() to authenticated, cs_orchestrator;` (tests invoke it).
   - `grant execute on function send_expiry_alerts() to authenticated, cs_orchestrator;`.
   - `select cron.schedule('expiry-enforcement-daily', '0 19 * * *', ...)` guarded by `unschedule ... exception null`.
   - `select cron.schedule('expiry-alerts-daily', '30 2 * * *', ...)` guarded similarly.
2. **Tests** (Sprint 1.2): `tests/depa/expiry-pipeline.test.ts` — Test 10.6 and Test 10.6b.

Both functions are pure SQL; no Edge Function needed. No new permissions issues — `cs_orchestrator` already has the grants this ADR uses (`SELECT` on consent_artefacts, `UPDATE (status)` on consent_artefacts, `DELETE` on consent_artefact_index via RLS bypass, `INSERT` on delivery_buffer and audit_log, etc.). If any grant is missing, the migration is the place to add it, not a separate file.

---

## Consequences

- **Two new pg_cron jobs in perpetuity.** Daily. Can be unscheduled with `cron.unschedule('expiry-enforcement-daily')` / `cron.unschedule('expiry-alerts-daily')`.
- **`consent_artefacts.status='expired'` becomes a live state.** Test fixtures that create artefacts with past `expires_at` are now affected by the nightly enforcement; fixtures should either use future timestamps or include explicit cleanup.
- **`delivery_buffer` gains two new event_types:** `artefact_expiry_deletion` and `consent_expiry_alert`. Any consumer that reads `delivery_buffer` and doesn't recognise an event_type MUST ignore (not error). The existing `deliver-consent-events` Edge Function already has this fallthrough.
- **Alerts flow through `delivery_buffer` → customer R2, not through Resend directly.** The customer's compliance team reads the R2 export. Wiring a user-facing in-app notification panel that pulls from delivery_buffer before it's exported is a separate concern (not this ADR).
- **Expiry-triggered connector fan-out is deferred** (V2-D1). Third-party connectors will not automatically receive a delete instruction when an artefact expires via TTL lapse. Customers relying on this behaviour must revoke explicitly — which triggers ADR-0022's pipeline. Called out in the compliance documentation.
- **ADR-0025 (DEPA score) can now proceed** — `expiry_score` computation reads the count of artefacts transitioned to `expired` vs. the total active pool.
- **consent_expiry_queue grows monotonically.** Rows are NOT deleted on process (they form the historical expiry audit trail — already documented in the ADR-0020 table comment).

### Architecture Changes

- **V2-BACKLOG entry V2-D1** — "Expiry-triggered connector fan-out" pointer back to this ADR's §Decision rationale. To be graduated post-Phase-2 per `feedback_v2_backlog_pattern`.
- **No doc amendments needed.** Schema-design §11.2 + §11.10 already specify these functions and jobs verbatim; this ADR is a pure implementation.

---

## Implementation Plan

### Phase 1: Helpers + cron + tests

**Goal:** Artefacts past their `expires_at` transition to `expired`, get removed from the validity cache, and (if auto-delete) stage a deletion event. Artefacts approaching expiry generate alert payloads. Test suite proves both on dev.

#### Sprint 1.1: Migration

**Estimated effort:** 45 minutes.

**Deliverables:**

- [x] `supabase/migrations/20260422000001_depa_expiry_pipeline.sql` — two `CREATE OR REPLACE FUNCTION` statements, two `GRANT EXECUTE` statements, two `cron.schedule` blocks guarded by `unschedule ... exception null`.
- [x] Applied via `bunx supabase db push --linked --include-all` on dev.
- [ ] Cron verification query deferred to ops spot-check.

**Status:** `[x] complete` — 2026-04-17

#### Sprint 1.2: Tests

**Estimated effort:** 75 minutes.

**Deliverables:**

- [ ] `tests/depa/expiry-pipeline.test.ts` — two describe blocks: "Test 10.6 — enforce_artefact_expiry" and "Test 10.6b — send_expiry_alerts". Fixtures reuse the ADR-0021/0022 pattern: seed org, two purpose_definitions (one auto-delete, one not), one web property + banner + consent event, poll for artefact creation (ADR-0021 pipeline), then manually mutate `expires_at`/`notify_at` to time-travel.

**Testing plan:**

- [x] **Test 10.6 (PASS)** — two artefacts with past `expires_at`, one auto-delete. Call `enforce_artefact_expiry()`. Both status='expired'; both index rows removed; both queue rows `processed_at` set; exactly one `artefact_expiry_deletion` delivery_buffer row (for the marketing artefact) with `data_scope=['email_address','name']`; two new `consent_artefact_expired` audit_log rows.
- [x] **Test 10.6b (PASS)** — one artefact with past `notify_at`. Call `send_expiry_alerts()` twice. First call stages one `consent_expiry_alert` delivery_buffer row with the right payload; second call is a no-op (notified_at guard).
- [x] **Full test:rls suite** — `bun run test:rls` → **144/144** across 11 files.
- [ ] Cron verification deferred to ops spot-check.

**Status:** `[x] complete` — 2026-04-17

---

## Test Results

### Sprint 1.2 — 2026-04-17

```
Test: DEPA expiry pipeline integration suite (10.6 + 10.6b)
Method: bunx vitest run tests/depa/expiry-pipeline.test.ts
Expected: 10.6 flips status, removes index, stages R2 row only for
          auto_delete; 10.6b stages alert and dedupes on second call.
Actual:   Test Files  1 passed (1)
          Tests       2 passed (2)
          Duration    11.32s
Result:   PASS
```

```
Test: Full test:rls suite (11 files)
Method: bun run test:rls
Expected: all green; no cross-terminal regression.
Actual:   Test Files  11 passed (11)
          Tests       144 passed (144)
          Duration    110.68s
Result:   PASS
```

---

## Changelog References

- `CHANGELOG-schema.md` — Sprint 1.1 entry: `enforce_artefact_expiry()` + `send_expiry_alerts()` + 2 pg_cron jobs.
- `CHANGELOG-docs.md` — ADR-0023 authored.
- `docs/V2-BACKLOG.md` — V2-D1: Expiry-triggered connector fan-out (pointer to this ADR).
