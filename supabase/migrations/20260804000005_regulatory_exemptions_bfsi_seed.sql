-- ADR-1004 Sprint 1.2 — BFSI platform default seed for regulatory_exemptions.
--
-- Five Indian BFSI statutes that mandate retention beyond customer consent
-- withdrawal. All rows ship with org_id IS NULL (platform default), sector
-- 'bfsi' (matches organisations.industry), is_active=true, precedence 100
-- (per-org overrides at 50 still win).
--
-- legal_review_notes / reviewed_at / reviewer_name / reviewer_firm stay NULL
-- until ADR-1004 Sprint 1.6 runs the external counsel review. Source
-- citations reference the canonical gazette/circular notification. Values
-- below are engineer-drafted and MUST NOT be relied on for customer-facing
-- advice before Sprint 1.6 completes — the runtime dashboard will render a
-- "pending legal review" badge on any exemption without `reviewed_at`.

-- Idempotent insert: ON CONFLICT (statute_code, coalesce(org_id, sentinel))
-- DO NOTHING lets this migration be re-run safely if we adjust downstream.

insert into public.regulatory_exemptions (
  org_id, sector, statute, statute_code,
  data_categories, retention_period, source_citation,
  precedence, applies_to_purposes, is_active
) values
  -- RBI KYC Master Directions 2016 (as amended)
  -- 10 years post account closure on customer identification records.
  (
    null,
    'bfsi',
    'RBI Master Direction — Know Your Customer (KYC) 2016 (as amended)',
    'RBI_KYC_MD_2016',
    array[
      'pan', 'aadhaar', 'passport_number', 'voter_id',
      'name', 'date_of_birth', 'address',
      'photograph', 'signature_specimen',
      'account_number', 'customer_id'
    ],
    interval '10 years',
    'https://rbi.org.in/Scripts/NotificationUser.aspx?Id=10292',
    100,
    array['kyc_verification', 'account_opening', 'customer_identification'],
    true
  ),

  -- Prevention of Money Laundering Act (PMLA) 2002
  -- Section 12(1)(a): maintain records of all transactions (including
  -- failed ones) for 5 years post transaction date.
  (
    null,
    'bfsi',
    'Prevention of Money Laundering Act (PMLA) 2002, Section 12(1)(a)',
    'PMLA_2002_S12',
    array[
      'transaction_id', 'transaction_amount', 'transaction_date',
      'counterparty_account', 'counterparty_name',
      'transaction_channel', 'transaction_narration',
      'beneficial_owner_details'
    ],
    interval '5 years',
    'https://legislative.gov.in/sites/default/files/A2003-15.pdf',
    100,
    array['transaction_record', 'aml_monitoring', 'ctr_str_reporting'],
    true
  ),

  -- Banking Regulation Act 1949
  -- Section 45ZC + RBI guidelines: 8 years for customer correspondence
  -- relevant to unclaimed deposits / deceased-accounts.
  (
    null,
    'bfsi',
    'Banking Regulation Act 1949, Section 45ZC (customer correspondence)',
    'BR_ACT_1949_S45ZC',
    array[
      'name', 'email_address', 'phone_number', 'address',
      'correspondence_body', 'complaint_ref', 'resolution_notes'
    ],
    interval '8 years',
    'https://legislative.gov.in/sites/default/files/A1949-10.pdf',
    100,
    array['customer_correspondence', 'complaint_tracking', 'unclaimed_deposits'],
    true
  ),

  -- Credit Information Companies Regulation Act (CICRA) 2005
  -- Credit bureau data retention — 7 years from last reported status.
  (
    null,
    'bfsi',
    'Credit Information Companies (Regulation) Act 2005',
    'CICRA_2005',
    array[
      'pan', 'name', 'date_of_birth',
      'credit_facility_details', 'outstanding_amount',
      'repayment_history', 'default_status',
      'bureau_reference_number'
    ],
    interval '7 years',
    'https://legislative.gov.in/sites/default/files/A2005-30.pdf',
    100,
    array['bureau_reporting', 'credit_score_query', 'loan_underwriting'],
    true
  ),

  -- Insurance Act 1938, Section 64VB
  -- Policy-related documents: policy-term + 10 years post maturity/claim.
  -- `retention_period` encodes the +10 years tail; the "policy term"
  -- component is enforced by the customer's own business logic via the
  -- expires_at on the relevant artefact (ADR-0023).
  (
    null,
    'bfsi',
    'Insurance Act 1938, Section 64VB + IRDAI (Maintenance of Insurance Records) Regulations 2015',
    'INS_ACT_1938_S64VB',
    array[
      'policy_number', 'policy_holder_name', 'policy_term',
      'premium_payment_history', 'claims_history',
      'nominee_details', 'beneficiary_details',
      'underwriting_documents', 'medical_records_for_insurance'
    ],
    interval '10 years',
    'https://irdai.gov.in/document-detail?documentId=1007064',
    100,
    array['insurance_underwriting', 'policy_administration', 'claims_processing'],
    true
  )
on conflict (statute_code, coalesce(org_id, '00000000-0000-0000-0000-000000000000'::uuid))
do nothing;
