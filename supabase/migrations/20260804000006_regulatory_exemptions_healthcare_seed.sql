-- ADR-1004 Sprint 1.3 — Healthcare platform default seed.
--
-- Three Indian healthcare statutes that mandate retention beyond consent
-- withdrawal. `sector = 'healthcare'` matches organisations.industry.
--
-- ABDM is a framework rather than primary legislation; its consent
-- artefact retention rules align with the health-record retention period
-- of the underlying statute (DISHA or state-level Clinical Establishments
-- Act). The precedence=120 on ABDM ensures DISHA wins if both apply.
--
-- legal_review_notes / reviewed_at stay NULL until Sprint 1.6.

insert into public.regulatory_exemptions (
  org_id, sector, statute, statute_code,
  data_categories, retention_period, source_citation,
  precedence, applies_to_purposes, is_active
) values
  -- Digital Information Security in Healthcare Act (DISHA) 2018 draft
  -- [MoHFW draft — operationalised via state rules; 7-year retention
  -- of clinical records is the most commonly cited baseline].
  -- NOTE: DISHA is still in draft status as of 2026-Q1; rows marked with
  -- a status note in legal_review_notes at Sprint 1.6.
  (
    null,
    'healthcare',
    'Digital Information Security in Healthcare Act (DISHA) — draft',
    'DISHA_DRAFT_2018',
    array[
      'abha_number', 'name', 'date_of_birth', 'gender',
      'clinical_notes', 'diagnosis_codes',
      'lab_result_values', 'radiology_reports',
      'prescription_history', 'medication_administration_record',
      'discharge_summary', 'operative_notes',
      'vital_signs_observations'
    ],
    interval '7 years',
    'https://abdm.gov.in/publications/disha_draft',
    100,
    array[
      'clinical_record_keeping',
      'lab_report_access',
      'prescription_management',
      'discharge_summary_delivery'
    ],
    true
  ),

  -- ABDM (Ayushman Bharat Digital Mission) Consent Manager Framework
  -- Consent artefacts for health data must be retained at least as long
  -- as the underlying health record. Fallback to 5 years if no
  -- DISHA / state-level rule applies.
  (
    null,
    'healthcare',
    'ABDM Consent Manager Framework / Data Empowerment and Protection Architecture (DEPA)',
    'ABDM_CM_2022',
    array[
      'abha_number', 'consent_artefact_id',
      'consent_grant_timestamp', 'consent_scope',
      'information_provider_id', 'information_user_id',
      'care_context_reference'
    ],
    interval '5 years',
    'https://sandbox.abdm.gov.in/docs/hie_cm_spec',
    120,
    array['abdm_hie_consent', 'data_fetch_consent'],
    true
  ),

  -- Clinical Establishments (Registration & Regulation) Act 2010
  -- State-level implementation varies; 3-year baseline for case-sheets
  -- + indefinite for medico-legal cases. Row marked as a placeholder
  -- that Sprint 1.6 legal review will refine per-state.
  (
    null,
    'healthcare',
    'Clinical Establishments (Registration and Regulation) Act 2010 (state-specific rules apply)',
    'CEA_2010_STATE',
    array[
      'patient_name', 'patient_id',
      'case_sheet', 'operation_notes',
      'medico_legal_status', 'death_certificate_details'
    ],
    interval '3 years',
    'https://clinicalestablishments.gov.in/',
    150,
    array['patient_case_sheet', 'medico_legal_recordkeeping'],
    true
  )
on conflict (statute_code, coalesce(org_id, '00000000-0000-0000-0000-000000000000'::uuid))
do nothing;
