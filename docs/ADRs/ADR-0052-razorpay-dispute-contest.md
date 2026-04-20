# ADR-0052 — Razorpay dispute contest submission

(c) 2026 Sudhindra Anegondhi a.d.sudhindra@gmail.com

**Status:** In Progress (Sprint 1.1 shipped 2026-04-20; Sprint 1.2 deferred — live Razorpay sandbox)
**Date:** 2026-04-20
**Phases:** 1
**Sprints:** 2

**Depends on:** ADR-0050 (dispute workspace + evidence bundle assembler), ADR-0051 (evidence ledger)

## Context

ADR-0050 Sprint 3.2 gave operators a dispute workspace with one-click evidence bundle assembly to R2. ADR-0051 added the unified evidence ledger feeding that bundle. What's missing: the actual **contest submission** — packaging the operator's authored rebuttal text + bundle pointer, then dispatching to Razorpay so the dispute moves into `under_review` on their side.

Razorpay's dispute contest API (`POST /v1/disputes/{id}/contest`) expects a structured evidence payload with a summary string + optional document references (uploaded separately via the Documents API). A full automation requires Razorpay-sandbox-verified credentials for the documents endpoint — setup work that hasn't landed yet on this dev instance.

This ADR ships in two sprints so Sprint 1.1 can land value (operator captures the contest summary + pointer, workflow state flips correctly) without blocking on live Razorpay integration.

## Decision

Add four columns to `public.disputes` for contest-submission metadata + two admin RPCs that model the full lifecycle:

1. **`prepare_contest`** — operator authors the contest summary (min 20 chars), optionally overrides the packet R2 key. Validates dispute is not already resolved and that an evidence bundle exists. Stamps `contest_packet_prepared_at`, persists `contest_summary`, audit-logs.

2. **`mark_contest_submitted`** — operator indicates the contest packet has been sent to Razorpay (manual today, automated in Sprint 1.2). Flips `status` → `under_review`, stamps `submitted_at`, records the response payload (`{manual: true}` or Razorpay API response body).

The existing `billing_dispute_mark_state` RPC remains for post-submission lifecycle (won/lost/closed flips driven by Razorpay webhooks).

### Non-goals for Sprint 1.1

- Actual Razorpay contest API call. Deferred to Sprint 1.2.
- Razorpay Documents API uploads for per-exhibit attachments. Deferred to Sprint 1.2.
- Text-summary PII lint. Operator discipline; documented in UI placeholder.

## Implementation

### Sprint 1.1 — Contest preparation + manual submit (shipped)

**Deliverables:**

- [x] `supabase/migrations/20260715000001_dispute_contest_fields.sql`:
  - 4 new columns on `public.disputes`: `contest_summary`, `contest_packet_r2_key`, `contest_packet_prepared_at`, `contest_razorpay_response`.
  - `admin.billing_dispute_prepare_contest(p_dispute_id, p_summary, p_packet_r2_key)` — SECURITY DEFINER, platform_operator+; validates summary length, dispute status, evidence bundle presence; audit-logs.
  - `admin.billing_dispute_mark_contest_submitted(p_dispute_id, p_response)` — SECURITY DEFINER, platform_operator+; validates packet prepared; flips to `under_review`; records response payload; audit-logs.
- [x] Admin dispute detail UI — new Razorpay contest section under the dispute actions panel:
  - "Prepare contest packet" button with summary textarea (disabled until evidence bundle is assembled)
  - Shows the prepared packet summary + timestamp when saved
  - "Mark submitted to Razorpay" button for manual submit flow
  - Re-edit summary path before submission
- [x] `admin/src/app/(operator)/billing/disputes/actions.ts` — `prepareContestPacket` + `markContestSubmitted` server actions.
- [x] `tests/billing/dispute-contest.test.ts` — 9/9 PASS: no-bundle refusal, resolved-dispute refusal, summary length guard, support-tier denial (prepare + mark); packet-not-prepared refusal; manual submit state flip; auto-submit response recording.

**Status:** `[x] complete — 2026-04-20`

### Sprint 1.2 — Live Razorpay API integration (deferred)

**Deliverables:**

- [ ] Extend `admin/src/lib/razorpay/client.ts` with `contestDispute(disputeId, evidence)` + `uploadDocument(path, purpose)`.
- [ ] New server action `submitContestViaRazorpay(disputeId)` that calls Razorpay contest API and passes the response to `mark_contest_submitted`.
- [ ] UI toggle — "Submit to Razorpay" button replaces the manual "Mark submitted" button when sandbox credentials are verified.
- [ ] Tests mock the Razorpay HTTP layer.

**Status:** `[ ] planned — blocked on Razorpay sandbox setup`

## Consequences

- **Enables:** Operators can now capture contest preparation as a first-class workflow step — the summary text is persisted, audit-logged, and reflected in the dispute detail page. Manual-submit tracking makes the workflow state machine accurate even before auto-submit is wired.
- **Evidence discipline:** Sprint 1.1 requires an assembled evidence bundle before a contest packet can be prepared — guarantees the bundle + summary are co-located when Sprint 1.2 lands auto-submit.
- **Rule 3:** contest summary is operator-authored free text; UI placeholder reminds the operator not to include customer PII. No technical enforcement today.
