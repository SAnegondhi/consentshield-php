# Architecture Consistency Review — 2026-04-13

**Scope:** All design documents reviewed against the three source-of-truth docs (definitive architecture, complete schema design, testing strategy) for internal consistency, cross-doc contradictions, and violations of non-negotiable rules.

**Documents reviewed (chronological):**

1. `consentshield-platform-delivery.md` (Apr 11)
2. `consentshield-stateless-oracle-architecture.md` (Apr 11)
3. `consentshield-technical-architecture.md` (Apr 11)
4. `consentshield-critical-examination.md` (Apr 11)
5. `abdm-scope-data-architecture.md` (Apr 11)
6. `consentshield-next-steps.md` (Apr 11)
7. `ConsentShield-Master-Design-Document-v1_1.md` (Apr 11)
8. `consentshield-v2-complete-blueprint.md` (Apr 12)
9. `consentshield-definitive-architecture.md` (Apr 13)
10. `consentshield-complete-schema-design.md` (Apr 13)
11. `consentshield-testing-strategy.md` (Apr 13)

---

## Findings and Fixes

### Blocking (1)

| # | Issue | Doc(s) | Fix applied |
|---|-------|--------|-------------|
| 10 | pg_cron jobs used `service_role_key` in Authorization headers — contradicts non-negotiable rule that service role key is never used in running application code | Schema design, Section 8 | Changed all 4 pg_cron Edge Function calls to use `cs_orchestrator_key`. Added explanatory note above Section 8. |

### Should-Fix (8)

| # | Issue | Doc(s) | Fix applied |
|---|-------|--------|-------------|
| 1 | `confirm_delivery_and_delete()` skipped the mark step — deleted WHERE `delivered_at IS NULL` instead of the two-step mark+delete specified in the definitive architecture Section 7.1 | Schema design, Section 7 | Removed `confirm_delivery_and_delete()` entirely. Only `mark_delivered_and_delete()` remains. Also fixed stale reference in Guard Summary table (Section 10). |
| 2 | `detect_stuck_buffers()` only checked 6 of 10 buffer tables — missing `deletion_receipts`, `withdrawal_verifications`, `security_scans`, `consent_probe_runs` | Schema design, Section 7 | Added the 4 missing tables to the function. |
| 3 | Category A table list missing `breach_notifications`, `rights_requests`, `consent_probes`, `cross_border_transfers`; also conflated org-scoped and global reference tables | Definitive architecture, Section 3 | Split Category A into "Org-scoped tables" (19) and "Global reference tables (no org_id)" (3: tracker_signatures, sector_templates, dpo_partners). Added the 4 missing tables. |
| 4 | Inconsistent FK on buffer table `org_id` — `consent_events`, `audit_log`, `rights_request_events` had no FK while other buffer tables did, with no explanation | Schema design, Section 3.2 | Added comments to `audit_log` and `rights_request_events` documenting the intentional no-FK pattern (same rationale as consent_events — avoids join for RLS). |
| 6 | cs_orchestrator GRANTs in schema doc were broader than described in definitive architecture — additional SELECT/UPDATE permissions not listed | Definitive architecture, Section 5.4 | Updated cs_orchestrator description with full grant summary. Added note referencing schema doc Section 5.1 for complete GRANT list. |
| 7 | Testing strategy missing coverage for 6 guards: processing mode enforcement, per-org encryption, write-only exports, Turnstile+OTP, hardware 2FA, scoped role verification | Testing strategy | Added Priority 1b (database guard verification — runs Section 9 queries on every deploy), Priority 8 (Turnstile+OTP flow), Priority 9 (processing mode enforcement). Hardware 2FA and write-only exports noted as operational checks outside automated testing. |
| 9 | Append-only constraint tests only covered 4 of 10 buffer tables | Testing strategy, Priority 1 and Priority 2 | Extended both sections to explicitly list all 10 buffer tables. |
| 11 | Technical architecture Worker code samples used `SUPABASE_SERVICE_KEY` (7 occurrences) — should use scoped `SUPABASE_WORKER_KEY` per definitive architecture | Technical architecture, Sections 4.3, 4.4, 8 | Changed all 7 occurrences. Updated descriptive text about service role to describe the three scoped roles. Updated env var documentation. |

### Cosmetic (4)

| # | Issue | Doc(s) | Fix applied |
|---|-------|--------|-------------|
| 5 | cs_delivery "CAN SELECT: all buffer tables WHERE delivered_at IS NULL" implied database-level filtering, but PostgreSQL GRANT doesn't support WHERE | Definitive architecture, Section 5.4 | Clarified as "application-level convention" in the description. |
| 8 | Testing strategy used wrong column name `type` instead of `request_type` in example SQL | Testing strategy, Priority 5 | Fixed column name. Also added required NOT NULL columns to the INSERT example. |
| 12 | Category A conflated org-scoped and global reference tables | Definitive architecture, Section 3 | Resolved by the Category A split in fix #3. |
| 13 | Testing strategy companion references listed superseded docs | Testing strategy, header | Updated to reference "Definitive Architecture Reference, Complete Schema Design". |

---

## Verification

A second critical review was performed after all fixes. Results:

- All 13 fixes verified correct
- One additional stale reference found (`confirm_delivery_and_delete` in Guard Summary table) and fixed
- No new inconsistencies introduced
- Cross-doc consistency confirmed: Category A/B table lists match schema definitions, scoped role GRANTs match between docs, testing priorities cover all critical guards

## Outcome

Three source-of-truth docs copied to `docs/architecture/`:
- `consentshield-definitive-architecture.md`
- `consentshield-complete-schema-design.md`
- `consentshield-testing-strategy.md`

Originals remain in `docs/design/` (also updated with all fixes).
