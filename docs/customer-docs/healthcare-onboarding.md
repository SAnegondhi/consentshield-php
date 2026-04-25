# Healthcare onboarding

(c) 2026 Sudhindra Anegondhi — ConsentShield customer documentation.

This guide walks a clinic, hospital, diagnostic centre, pharmacy or telemedicine provider through onboarding ConsentShield with the **Healthcare Starter** sectoral template.

## Who this is for

- You operate a healthcare establishment in India (clinic, hospital, diagnostic lab, pharmacy, teleconsultation platform).
- You must comply with DPDP Act 2023, the Clinical Establishments Act, ABDM (Ayushman Bharat Digital Mission) consent flows, and — once notified — DISHA.
- You have `org_admin` (or `account_owner`) on your ConsentShield org.

## Why healthcare onboarding is different

Two non-negotiables shape the healthcare flow:

1. **Security Rule 3 — clinical content is never persisted.** ConsentShield does not hold FHIR records, lab results, prescriptions or any health-record content. Only the consent artefacts (who consented to what, when, for how long) and category labels (e.g. `lab_report_token`, `prescription_pointer`) are stored. The content itself stays in your EMR / lab system / your customer-owned object storage.

2. **Storage mode must be `zero_storage` before the Healthcare template applies.** The Healthcare Starter template ships with `default_storage_mode='zero_storage'`. The customer-side `apply_sectoral_template` RPC refuses to apply it to an org running in `standard` or `insulated` mode — it raises SQLSTATE `P0004` with a message naming the required mode. Switching storage modes is an admin action; see step 1 below.

## What the template gives you

Seven DPDP / DISHA / ABDM-aligned purposes, each with a default retention window and a default expiry behaviour. Apply once, edit per-purpose afterwards from the Purpose Definitions panel.

| Purpose | Retention default | Auto-delete |
|---|---|---|
| `teleconsultation` | 7 years (DISHA) | No |
| `prescription_dispensing` | 2 years | Yes |
| `lab_report_access` | 7 years (DISHA) | No |
| `insurance_claim_share_abdm` | 1 year | Yes |
| `appointment_reminders` | 1 year | Yes |
| `marketing` | 1 year | Yes |
| `research_broad_consent` | 5 years (ICMR) | No |

Plus two connector placeholders the admin templates panel surfaces: `appointment_reminder_vendor` (MSG91 / Gupshup / Twilio class) and `emr_vendor` (Practo Ray / Halemind / Clinikally class). You wire your actual vendor under **Settings → Integrations** after the template applies.

---

## Flow A — Single-doctor clinic

For a solo practice or a single-doctor telemedicine setup. ~15 minutes.

### Step 1 — Ask your ConsentShield admin to flip storage mode

Email the admin contact at your account (or, for self-serve sandbox accounts, the platform operator) with the following:

> Please switch organisation `<your-org-name>` to `storage_mode = zero_storage` so I can apply the Healthcare Starter template.

The admin runs (in the operator console):

```text
admin.set_organisation_storage_mode(
  '<org-uuid>'::uuid,
  'zero_storage'::storage_mode,
  'healthcare onboarding — Sprint 4.1 default'
)
```

The change propagates to the Worker KV cache within ~60 seconds.

### Step 2 — Provision a customer-owned bucket (BYOS)

Zero-storage means your raw consent artefacts land in a bucket *you* own — Cloudflare R2 or AWS S3. Follow either:

- `docs/customer-docs/byos-cloudflare-r2.md` (cheaper egress; needs custom permissions).
- `docs/customer-docs/byos-aws-s3.md` (works out-of-the-box with the scope-down probe).

You'll end up with a verified write-only credential bound to your org.

### Step 3 — Apply the Healthcare Starter template

Dashboard: **Onboarding → Sectoral templates → Healthcare Starter → Apply**.

Or via SQL (server-side, for scripted onboarding):

```sql
select public.apply_sectoral_template('healthcare_starter');
```

Expected return:

```json
{
  "code": "healthcare_starter",
  "version": 1,
  "display_name": "Healthcare Starter",
  "purpose_count": 7,
  "materialised_count": 7,
  "storage_mode": "zero_storage"
}
```

If you skipped step 1, the call fails with:

```text
ERROR: template healthcare_starter requires storage_mode=zero_storage but
       this org is standard; ask your admin to switch storage mode first
       via admin.set_organisation_storage_mode
SQLSTATE: P0004
```

### Step 4 — Wire the appointment-reminder vendor

Settings → Integrations → Add connector → Messaging.

Pick MSG91, Gupshup, Twilio, Karix or "Custom HTTP". Paste your vendor API key (encrypted server-side under your org's per-org key). Map the `appointment_reminders` purpose to the connector under **Purpose definitions → appointment_reminders → Connectors**.

This is what lets a withdrawal of consent on the appointment-reminder purpose actually flow through to the messaging vendor and stop reminders.

### Step 5 — Wire the EMR vendor

Settings → Integrations → Add connector → Electronic medical record.

Pick Practo Ray, Halemind, Clinikally, MocDoc or "Custom Webhook". The EMR connector receives consent-withdrawal events for purposes that touch clinical records (`teleconsultation`, `prescription_dispensing`, `lab_report_access`).

Under DISHA 7-year retention, you cannot delete the underlying medical record on withdrawal — but you must record the withdrawal in the EMR so the record is no longer accessible for the original purpose. The connector handles this signalling.

### Step 6 — Customise per-purpose copy

Defaults are written for an English-reading patient. Edit each purpose's `display_name` and `description` from the **Purpose Definitions** panel before publishing the consent banner. The Healthcare Starter copy already follows the DPDP plain-language requirement; lightly tune it to match your clinic's voice.

### Step 7 — Publish the banner

Banner Builder → use the Healthcare preset → preview on your booking page → publish. The banner now collects consent against all 7 purposes.

---

## Flow B — Multi-doctor practice or hospital

For a hospital, a chain of clinics, or a multi-doctor practice. ~45 minutes plus per-department wiring.

The shape is the same as Flow A, with three additional steps for multi-tenancy.

### Step 0 — Decide your tenancy

If you are a **chain** (one legal entity, multiple branches), one ConsentShield org per legal entity is enough; treat branches as web properties under that one org.

If your branches are **separate legal entities** (common for hospital groups), provision one ConsentShield org per legal entity under the same account. The account-level billing rolls up; org-level isolation keeps each entity's consent record separate.

See ADR-0044 (RBAC + accounts → organisations → web_properties) for the model.

### Steps 1–3 — Same as Flow A

Apply per-org. Each org needs its own storage_mode flip, BYOS bucket, and template application.

### Step 4 — Department-level connector mapping

A multi-doctor practice usually has:

- One messaging vendor for clinic-wide reminders.
- One EMR vendor for the whole practice (or one per department — ICU vs. OPD vs. Diagnostics).
- One pharmacy connector if the clinic has its own dispensary.

Wire each connector once at the org level, then under **Purpose definitions** map each purpose to the connectors that touch its data scope. The default mapping the Healthcare Starter suggests:

| Purpose | Connectors |
|---|---|
| `teleconsultation` | EMR |
| `prescription_dispensing` | EMR + pharmacy (if internal) |
| `lab_report_access` | EMR + lab system |
| `insurance_claim_share_abdm` | EMR + ABDM HIE (no manual connector — handled by ABDM consent artefact) |
| `appointment_reminders` | Messaging vendor |
| `marketing` | Messaging vendor (separate suppression list) |
| `research_broad_consent` | EMR (de-identification toggle) |

### Step 5 — Doctor / staff-level access (RBAC)

Your account-owner invites doctors / front-desk / billing as members per the RBAC model in ADR-0044. The Healthcare template does not gate access on role; that's the operator's responsibility via the membership panel.

Recommended baseline:

| Role | Sees |
|---|---|
| `account_owner` | Everything across all orgs in the account. |
| `org_admin` | Their org: purpose definitions, banner, audit, billing for that org. |
| `admin` | Their org's operational consent + rights surfaces. No billing. |
| `viewer` | Read-only — useful for compliance officers, internal auditors. |

### Step 6 — ABDM HIE bridge (if you participate)

If your hospital is an ABDM Health Information Provider (HIP) or User (HIU), the `insurance_claim_share_abdm` purpose uses the ABDM consent-artefact ID as the actual gate — the ConsentShield artefact mirrors the ABDM artefact metadata so your audit log carries both IDs. Wire the ABDM gateway under **Settings → ABDM** (separate setup; covered in `docs/customer-docs/abdm-bridge.md` once that doc lands).

### Step 7 — Test before opening to patients

Use a sandbox org (see ADR-1003 Sprint 5.1 once shipped) or your staging environment to:

1. Submit a test consent through the banner — confirm it lands in your BYOS bucket.
2. Submit a withdrawal — confirm the messaging vendor + EMR connector both receive the revocation signal.
3. Submit a rights request (Right to Access) — confirm the export contains the artefact metadata only, not clinical content (Security Rule 3).

---

## What zero_storage means for healthcare specifically

Three operational realities to plan for:

1. **No buffer-side replay.** ConsentShield's default Standard / Insulated modes hold consent rows in `consent_events` for ~60 seconds before delivery; if your storage hiccups, the buffer holds. Zero-storage skips the buffer entirely — every event is delivered direct, or fails. Your BYOS endpoint must be highly available; expect to size for 99.95%+ at the bucket level.

2. **Re-export is from your bucket, not from us.** If a patient asks for a copy of their consent history, you generate it from your BYOS bucket. ConsentShield's `consent_artefact_index` carries pointers (artefact ID, identifier hash, expiry) — not content. The customer-app dashboard helps the operator construct the export, but the bytes come from your bucket.

3. **Audit reconstruction is your responsibility.** DPB / regulator audits ask for a chronological consent record per data principal. With zero-storage, that record is in your bucket, keyed by the index rows ConsentShield holds. Plan your bucket layout (e.g. `<org_id>/<year>/<month>/<artefact_id>.json`) so audit construction is a bucket-listing operation, not a database query.

---

## Common errors

### `template healthcare_starter requires storage_mode=zero_storage but this org is standard`

You skipped step 1. Email your admin or open the operator console and run `admin.set_organisation_storage_mode(<org_id>, 'zero_storage', 'healthcare onboarding')` first.

### Banner accepts but no row appears in my bucket

Your BYOS credential failed live verification, or the Worker isn't seeing the storage_mode flip yet. Wait 60 seconds; if still failing, re-run the BYOS scope-down probe from **Settings → Storage**. The probe report names the failing check.

### Withdrawal events aren't reaching my EMR

The `purpose_connector_mappings` row from the purpose to the EMR connector is missing. Map it under **Purpose definitions → <purpose> → Connectors**. The Healthcare Starter does *not* auto-create these mappings — only template-level placeholder metadata.

### Rights export contains clinical content

It shouldn't, and if it does that is a Security Rule 3 violation — open an incident report immediately. Index rows hold category labels and pointers, never content. If your bucket layout has been used incorrectly to store clinical content, the rights export will be limited to ConsentShield's view (the index) and your team will need to construct the clinical-content portion separately.

---

## Reference

- ADR-1003 Phase 4 — Healthcare sector unlock (this template).
- Migration `20260804000056_adr1003_s41_healthcare_template_seed.sql` — the seed.
- `admin.sectoral_templates.default_storage_mode` — the gate.
- DISHA Draft 2018 — `https://www.nhp.gov.in/NHPfiles/R_4179_1521627488625_0.pdf`
- Telemedicine Practice Guidelines 2020 — `https://www.mohfw.gov.in/pdf/Telemedicine.pdf`
- ABDM HDM Policy v2 — `https://abdm.gov.in/publications/health_data_management_policy`
