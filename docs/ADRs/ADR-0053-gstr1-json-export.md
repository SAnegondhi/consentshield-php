# ADR-0053 — GSTR-1 JSON export for monthly filing

(c) 2026 Sudhindra Anegondhi a.d.sudhindra@gmail.com

**Status:** Completed — 2026-04-20
**Date:** 2026-04-20
**Phases:** 1
**Sprints:** 1
**Depends on:** ADR-0050 (issuer entities + `public.invoices` with GST breakdown, GST statement CSV already shipped).

## Context

ADR-0050 Sprint 3.1 shipped a **GST statement CSV** at `/billing/gst-statement` — a flat tabular export of per-invoice GST for an issuer × FY range. That's useful for reconciliation and audit but is NOT the format the GSTN portal accepts for filing.

GSTR-1 is India's monthly/quarterly outward-supplies return. The GSTN portal accepts uploads via its **Offline Utility**, which consumes a specific **JSON shape** (the earlier XML format is obsolete — the ADR-0050 non-goal reservation used "GSTR-1 XML" as shorthand; the real format is JSON).

This ADR delivers a one-button "Download GSTR-1 JSON" export for a given issuer × month. The JSON is structured per GSTN's v3.2 schema and can be uploaded directly to the Offline Utility.

## Decision

Add a single `SECURITY DEFINER` admin RPC `admin.billing_gstr1_json(p_issuer_id, p_period_mmyyyy)` that:

1. Scopes to the caller's tier (operator: active issuer only; owner: any issuer — same rule as the CSV statement).
2. Loads the issuer GSTIN + all invoices for the period.
3. Classifies invoices into **GSTR-1 sections**:
   - **b2b** — customer has a GSTIN (registered business).
   - **b2cl** — customer has no GSTIN + inter-state supply + invoice total > ₹2,50,000.
   - **b2cs** — everything else (aggregated by `rate × place-of-supply × supply-type`).
4. Aggregates an **hsn** summary (HSN-wise totals, required by GSTR-1).
5. Builds a **doc_issue** section listing the invoice serial range.
6. Returns a single JSONB value matching GSTN's v3.2 offline-utility schema.

The `/billing/gst-statement` page gains a second download button alongside the CSV: "Download GSTR-1 JSON for `<period>`". Periods render as `MMYYYY` (e.g. `042026`).

### Out of scope

- **Credit/debit notes (cdnr / cdnur).** Voiding an invoice in our system is a status flip, not a credit note. These sections emit as empty arrays for now.
- **Exempt / nil-rated supplies (nil).** No exempt line items in the current invoice pipeline.
- **ITC / purchases returns (GSTR-2, GSTR-3B).** Different forms, different scope.
- **GSP API filing.** Direct-upload via a GST Suvidha Provider's API requires regulated empanelment + an onboarding process. Customers download the JSON and upload through the Offline Utility themselves.
- **HSN descriptions + UQC lookup.** Shipped using the `description` field on each line item verbatim and `'OTH'` as UQC. Richer HSN catalogue lookup is V2.

### Non-goal: automated filing

This ADR ends at "produce a GSTR-1 JSON for the operator to upload." Automated GSTN upload requires GSP empanelment, which is out of scope for dev-mode. Operators upload via the GSTN portal themselves.

## Implementation — Phase 1 Sprint 1.1

**Deliverables:**

- [ ] Migration `20260720000001_billing_gstr1_json.sql`:
  - `admin.billing_gstr1_json(p_issuer_id uuid, p_period_mmyyyy text)` — SECURITY DEFINER, platform_operator+. Scope: operator → active-issuer-only (enforced via existing pattern); owner → any issuer.
  - Validates period format (`MMYYYY`, month 01–12).
  - Resolves issuer gstin. Loads all invoices with `issued_at` in the month (derived from `period_mmyyyy` — any status except `void`).
  - Classifies each invoice into b2b / b2cl / b2cs based on customer GSTIN + state + total.
  - Aggregates hsn section by HSN code (summed across line items).
  - Produces `doc_issue` entry for the invoice serial range.
  - Audit-logs every call with `action='billing_gstr1_json'`, `reason` including period + caller role.
- [ ] `admin/src/app/(operator)/billing/gst-statement/actions.ts` — new `generateGstr1Json(issuerId, periodMmyyyy)` server action.
- [ ] `admin/src/app/(operator)/billing/gst-statement/form.tsx` — add period selector (defaults to previous month) + "Download GSTR-1 JSON" button alongside the existing CSV download.
- [ ] Tests: `tests/billing/gstr1-json.test.ts`:
  - Empty period returns a valid GSTR-1 shape with all empty arrays.
  - B2B classification: customer with GSTIN lands in b2b.
  - B2CL classification: customer without GSTIN, inter-state, > ₹2.5L lands in b2cl.
  - B2CS classification: everything else aggregates by rate × pos.
  - HSN summary aggregates line items across invoices by HSN code.
  - Voided invoices excluded.
  - Operator caller scope: refuses non-active issuer.
  - Support tier denied.

**Testing plan:**

Six-invoice fixture: two B2B (one intra-state, one inter-state), one B2CL (no-GSTIN inter-state ₹3L), two B2CS (no-GSTIN under ₹2.5L), one void. Assert correct bucket counts + HSN summary totals + doc_issue range.

**Status:** `[x] complete — 2026-04-20`

Shipped with three migrations (one feature + two nested-aggregate fixups):
- `20260722000001_billing_gstr1_json.sql` — initial RPC.
- `20260722000002_fix_gstr1_nested_agg.sql` — two-step CTE for B2B + B2CL.
- `20260722000003_fix_gstr1_b2cs_agg.sql` — two-step CTE for B2CS.

`tests/billing/gstr1-json.test.ts` — 11/11 PASS: shape, B2B / B2CL / B2CS classification, HSN aggregation, void exclusion, doc_issue range, operator-scope refusal on retired issuer, owner-scope allowance on retired issuer, invalid period, support tier denied.

UI — `admin/src/app/(operator)/billing/gst-statement/form.tsx` grew a "GSTR-1 JSON (monthly filing)" block with period input (defaults to previous month) + download button. Disabled when the issuer dropdown is "All issuers" (owner only — JSON is always per-issuer).

## Acceptance criteria

- An operator picks an issuer (or the active issuer is auto-selected) + a month, clicks "Download GSTR-1 JSON", and gets a file named like `gstr1-{gstin}-{MMYYYY}.json` that uploads cleanly into the GSTN Offline Utility for validation.
- Invoices with customer GSTIN land under `b2b`; invoices to unregistered customers land under `b2cl` or `b2cs` per the GSTN threshold rules.
- HSN section totals across all line items for the period; counts match the sum of per-invoice line counts.
- Voided invoices are excluded (business rule: they were never part of outward supply).
- The CSV export and JSON export cover the same period and produce consistent totals — a reconciliation smoke-check for operators.

## Consequences

**Enables:**
- Operators can file GSTR-1 without manually re-keying invoice data into the GSTN Offline Utility.
- Opens a path to future GSP-mediated auto-filing (out of scope for this ADR).

**Introduces:**
- A second canonical export format for GST (CSV = human review; JSON = machine upload). Both derive from the same `public.invoices` data — single source of truth preserved.
- A monthly cadence reminder becomes valuable (future ADR) — operator runs this between the 1st and 11th of each month.

**Hard constraints honoured:**
- Rule 3 — all fields are tax / transaction metadata (amounts, GSTINs, invoice numbers). No personal data enters the JSON beyond GSTIN (itself a business identifier).
- Rule 5 — new RPC runs as `SECURITY DEFINER` under the existing admin RPC pattern.
- Rule 19 — issuer identity for each invoice is locked at issue time (already enforced); the GSTR-1 export reads `issuer.gstin` at the moment the issuer WAS active for that invoice. Retired issuers remain filable if owner caller.
