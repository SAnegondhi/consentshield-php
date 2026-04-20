# ADR-0054 — Customer-facing billing portal (invoice history + billing profile)

(c) 2026 Sudhindra Anegondhi a.d.sudhindra@gmail.com

**Status:** Proposed
**Date:** 2026-04-20
**Phases:** 1
**Sprints:** 2

---

## Context

ADR-0050 shipped the full admin-side billing track: issuer entities, invoice issuance + PDF + GST + R2 storage + Resend delivery, invoice search + export + GST statement + dispute workspace. **Paying customers still cannot see their own invoices.**

The customer-facing billing surface today is only `/dashboard/billing` — a plan selector + Razorpay checkout modal. There is no invoice history, no downloadable PDF, no way to edit the billing profile (legal name / GSTIN / state / address / email) once set.

This is both an unacceptable UX gap (a paying customer should not have to email us for a copy of their own invoice) and a compliance gap (GST input tax credit requires the customer to hold their own invoice copies).

**Reserved position:** ADR-0054 was reserved in ADR-0050's "Out of scope / V2" list for exactly this scope. The backend is fully ready — `public.invoices` has `account_id`, `pdf_r2_key`, and `pdf_sha256` on every issued row, and `accounts` already carries `billing_legal_name / billing_gstin / billing_state_code / billing_address / billing_email` from ADR-0050 Sprint 2.

### What changed since ADR-0050

- `public.invoices` has RLS allowing `authenticated` SELECT via `account_id` → `account_memberships` chain (the table is RLS-enabled; this ADR adds the specific customer-read policy).
- Invoice PDFs live in the `R2_INVOICES_BUCKET` under `invoices/{issuer_id}/{fy_year}/{invoice_number}.pdf`.
- The admin-side download route `/api/admin/billing/invoices/[invoiceId]/download` is a known-good reference pattern — presigns R2 URLs, 15-minute TTL, audit-logs the download.

### Non-goals for this ADR

- **Razorpay-side payment method management** — customers manage card / UPI on the Razorpay checkout. We do not wrap that flow.
- **Refund request UI** — refunds are operator-driven (ADR-0034). A "Request refund" button belongs in a later ADR if at all.
- **Invoice dispute intake from customer side** — customers contact support; disputes enter via Razorpay's chargeback webhooks (ADR-0050 Sprint 3.2). No customer-facing dispute button in this ADR.
- **Annual billing / prepayment / credits** — plan changes remain monthly-billed via the existing `/dashboard/billing` checkout; no new payment surface.
- **GSTIN validation against the Indian government service** — format validation only in this ADR; live GSTIN lookup is V2.

---

## Decision

Add one section (`Billing`) to the customer Settings page, visible only to `account_owner` and `account_viewer` roles. Visible panel content:

1. **Current plan card** — summary of current plan + renewal date; "Change plan" button deep-links to the existing `/dashboard/billing` route. No business logic change to the plan selector.
2. **Billing profile form** — editable fields: legal name, GSTIN (optional), registered state, billing address, billing email. `account_owner` sees the Save button; `account_viewer` sees the form in read-only mode.
3. **Invoice history table** — all invoices for the caller's account, newest first. Columns: invoice number, issue date, total (incl. GST), status (paid / issued / void), PDF download link. Void invoices show "—" for PDF.

**Wireframe:** `docs/design/screen designs and ux/consentshield-screens.html` — `<div id="billing-section">` under the Settings panel. That wireframe is the spec; code MUST conform.

**Role visibility matrix:**

| Role | See Billing tab | Edit billing profile | Download PDFs |
|------|-----------------|----------------------|---------------|
| `account_owner`  | ✓ | ✓ | ✓ |
| `account_viewer` | ✓ | ✗ (read-only) | ✓ |
| `org_admin`      | ✗ | ✗ | ✗ |
| `admin`          | ✗ | ✗ | ✗ |
| `viewer`         | ✗ | ✗ | ✗ |

Rationale: billing is an **account-level** concern. Organisation-level roles have no stake in the account's invoices or billing profile; hiding the tab entirely from them is cleaner than showing a disabled surface.

---

## Implementation plan

### Phase 1 — Customer billing portal (2 sprints)

#### Sprint 1.1 — Read path (invoices + profile view + PDF download)

**Deliverables:**

- [ ] Migration: new RLS policy + 2 RPCs
  - Policy `cs_customer select invoices` on `public.invoices` for `authenticated`, USING `account_id in (select account_id from public.account_memberships where user_id = auth.uid() and role in ('account_owner','account_viewer'))`.
  - RPC `public.list_account_invoices()` — SECURITY DEFINER; returns invoice rows for caller's account joined with issuer legal name + account legal name; ordered by `issue_date desc`. Caller must be `account_owner` or `account_viewer`; otherwise raises.
  - RPC `public.get_account_billing_profile()` — SECURITY DEFINER; returns the caller's account's billing profile fields + `billing_profile_updated_at` + `billing_profile_updated_by_email`. Same caller guard.
- [ ] Route `/dashboard/settings/billing`:
  - Server component reads plan info (existing) + `list_account_invoices()` + `get_account_billing_profile()`.
  - Renders: plan card → billing profile (read-only mode) → invoice history table.
  - Empty state: "No invoices yet. Your first invoice will appear here after your first billing cycle."
- [ ] Route `/api/orgs/[orgId]/billing/invoices/[invoiceId]/pdf`:
  - Authenticated + scoped to caller's account (verify `invoice.account_id` matches caller's `account_id`).
  - Reads `invoice.pdf_r2_key` and returns a 302 redirect to a 15-minute presigned R2 URL.
  - Audit row inserted (`action = 'customer_invoice_pdf_download'`, target = `invoice_id`).
- [ ] Nav wiring: new `Billing` sub-nav item appears in Settings for `account_owner` + `account_viewer` only; hidden for other roles.

**Testing plan:**

- [ ] `tests/rls/customer-invoice-visibility.test.ts` — RLS isolation:
  - account A's `account_owner` can SELECT only account A's invoices
  - account A's `account_owner` cannot SELECT account B's invoices
  - `org_admin` of an org under account A cannot SELECT invoices (not an account-level role)
- [ ] `tests/billing/list-account-invoices-rpc.test.ts`:
  - `account_owner` call returns caller's invoice rows
  - `account_viewer` call returns the same rows (read but not edit)
  - `org_admin` call raises
  - No invoices returns empty array (not error)
- [ ] `tests/billing/customer-pdf-download.test.ts`:
  - account_owner can download their own invoice PDF (receives 302 to signed URL)
  - account_owner cannot download another account's invoice (403)
  - org_admin cannot download (403)
  - download audit row created
- [ ] Manual: log in as test account_owner, navigate to Settings → Billing, verify 4 invoices render, click Download on a paid invoice, confirm PDF opens.

**Status:** `[ ] planned`

#### Sprint 1.2 — Write path (billing profile edit)

**Deliverables:**

- [ ] Migration: 1 RPC
  - RPC `public.update_account_billing_profile(p_legal_name text, p_gstin text, p_state_code text, p_address text, p_email text)` — SECURITY DEFINER; restricted to `account_owner` (not `account_viewer`). Validates:
    - `legal_name` required, 2–200 chars
    - `gstin` optional; if present, matches `^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$`
    - `state_code` must be a valid 2-digit Indian state code (07, 27, 29, 33, etc.)
    - `address` required, max 500 chars
    - `email` required, valid email format
  - Writes to `accounts.billing_*` fields, stamps `billing_profile_updated_at = now()` and `billing_profile_updated_by = auth.uid()`.
  - Inserts a row into `accounts_audit_log` (or equivalent customer-side audit table) with `old_value` and `new_value` JSON deltas.
- [ ] UI: form section in `/dashboard/settings/billing` becomes editable for `account_owner`; toggles to inline edit mode with Save / Cancel buttons.
- [ ] UI: optimistic validation (client-side GSTIN format check, state dropdown) + server error surface if RPC raises.

**Testing plan:**

- [ ] `tests/billing/update-billing-profile-rpc.test.ts`:
  - `account_owner` can update the profile (fields persist, audit row created)
  - `account_viewer` cannot update (raises)
  - `org_admin` cannot update (raises)
  - Invalid GSTIN raises with readable error
  - Invalid state code raises
  - Empty legal_name raises
  - Omitting optional GSTIN (null) succeeds
- [ ] Manual: log in as account_owner, edit GSTIN to a new valid value, Save, refresh page, confirm persisted. Try invalid GSTIN, confirm error surfaces.

**Status:** `[ ] planned`

---

## Consequences

**Enables:**
- Paying customers can retrieve their own invoice PDFs without contacting support — closes the largest open UX gap post-ADR-0050.
- GST compliance for customer input tax credit: every customer holds their own invoice copies with SHA-256 tamper-evidence intact.
- Clean separation of billing concerns: account-level roles see billing; org-level roles do not.

**Introduces:**
- New RLS policy on `public.invoices` for authenticated SELECT scoped by account membership. This is an additive policy; existing `cs_admin` SELECT policy and UPDATE triggers are untouched.
- First customer-side RPC that reads from the `billing.*` schema (via the `issuers` join inside `list_account_invoices`). The RPC is SECURITY DEFINER so the caller does not need USAGE on `billing` schema.
- New audit-row pattern: customer actions on the billing profile are logged in a customer-visible audit trail (not the admin audit log). This follows the same pattern as ADR-0047's membership audit log.

**Hard constraints this ADR does not violate:**
- Rule 2 (append-only) — `public.invoices` remains write-restricted; this ADR adds no UPDATE / DELETE grants.
- Rule 3 (no FHIR) — unchanged.
- Rule 5 (scoped roles) — SECURITY DEFINER RPCs run under `cs_orchestrator`'s privileges as already established; no new role grants.
- Rule 12 (identity isolation) — this ADR only adds surface in `app/`; admin identities still cannot reach this route because the customer proxy rejects them.
- Rule 13 (RLS) + Rule 14 (org_id / account_id) — the new RLS policy filters by `account_id` via the account_memberships chain.
- Rule 19 (invoice immutability) — this ADR reads invoices; does not introduce any customer-side invoice mutation.

---

## Acceptance criteria

- An `account_owner` can open Settings → Billing, see their plan, billing profile, and every invoice their account has been issued, and download the PDF for any non-void invoice in under 3 seconds at dev scale.
- An `account_viewer` can see the same data but cannot edit the billing profile.
- An `org_admin` / `admin` / `viewer` user does not see the Billing tab in the Settings sidebar, and a direct URL visit to `/dashboard/settings/billing` renders a "Not available for your role" state (not a 500, not a leak of any account data).
- Attempting to download another account's invoice (by guessing the invoiceId) returns 403; the failed attempt is NOT audit-logged as a successful download (optional: audit-log as a denied attempt).
- Editing the billing profile writes an audit-log row the next session can see.

---

## Sprint outcomes

Populated as sprints land.

---

## Changelog references

To be populated as sprints land.
