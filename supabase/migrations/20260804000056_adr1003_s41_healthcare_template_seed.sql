-- ADR-1003 Sprint 4.1 — Healthcare sectoral template seed (G-042).
-- (c) 2026 Sudhindra Anegondhi a.d.sudhindra@gmail.com
--
-- Three concerns in one migration:
--
-- (1) Two new columns on admin.sectoral_templates:
--       default_storage_mode  text   — nullable. When set, gates
--                                       public.apply_sectoral_template:
--                                       the org's storage_mode must already
--                                       match. Refuses to apply otherwise
--                                       with errcode P0004 — Security Rule 3
--                                       discipline (FHIR is never persisted).
--       connector_defaults    jsonb  — nullable. Vendor placeholders the
--                                       admin templates panel renders as
--                                       "you'll need to wire these
--                                       connectors". Pure metadata; not
--                                       referenced by purpose_connector_mappings.
--
-- (2) public.apply_sectoral_template re-published with the storage_mode
--     gate. Existing BFSI Starter row has default_storage_mode = NULL → no
--     change in behaviour. Healthcare Starter sets it to 'zero_storage'.
--
-- (3) INSERT one published 'healthcare_starter' row with 7 DPDP/DISHA-aligned
--     purposes, DISHA 7y retention defaults, zero_storage default, and
--     EMR + appointment-reminder vendor placeholders.
--
-- ADR-1003 §Phase 4 / Sprint 4.1 acceptance criteria:
--   * 7 purposes seeded → jsonb_array_length(purpose_definitions) = 7
--   * Retention populated → default_expiry_days set per purpose
--   * default_storage_mode = 'zero_storage'
--   * Apply to a zero_storage org → succeeds, materialises 7 purposes
--   * Apply to a standard org → P0004 with "ask your admin to switch
--     storage mode to zero_storage first" message
--
-- Sources for healthcare purpose framework (all accessed 2026-04-25):
--   * DPDP Act, 2023 (MeitY official PDF)
--       https://www.meity.gov.in/static/uploads/2024/06/2bf1f0e9f04e6fb4f8fef35e82c42aa5.pdf
--   * Draft Digital Information Security in Healthcare Act (DISHA), 2018 — MoHFW
--       https://www.nhp.gov.in/NHPfiles/R_4179_1521627488625_0.pdf
--   * Clinical Establishments (Registration and Regulation) Act, 2010
--       https://clinicalestablishments.gov.in/
--   * Ayushman Bharat Digital Mission (ABDM) Health Data Management Policy v2 (NHA, 2023)
--       https://abdm.gov.in/publications/health_data_management_policy
--   * Telemedicine Practice Guidelines, 2020 (MoHFW + MCI/NMC)
--       https://www.mohfw.gov.in/pdf/Telemedicine.pdf
--
-- Rule 3 discipline (definitive-architecture §7): purpose data_scope values
-- are category labels only (e.g. 'health_record_pointer', 'lab_report_token').
-- No HL7/FHIR payload, no clinical content, no diagnosis codes appear as
-- values in this migration or in any persisted purpose row.

-- 1. Schema additions ------------------------------------------------------

alter table admin.sectoral_templates
  add column if not exists default_storage_mode text
    check (default_storage_mode in ('standard','insulated','zero_storage'));

alter table admin.sectoral_templates
  add column if not exists connector_defaults jsonb;

comment on column admin.sectoral_templates.default_storage_mode is
  'Optional default org-level storage_mode for this template. When set, '
  'public.apply_sectoral_template refuses to apply unless the target org is '
  'already in this mode. NULL means the template is mode-agnostic.';

comment on column admin.sectoral_templates.connector_defaults is
  'Vendor-category placeholders the admin templates panel renders as '
  '"you''ll need to wire these connectors". Informational; not referenced '
  'by purpose_connector_mappings.';

-- 2. Re-publish public.apply_sectoral_template with the storage_mode gate.
--    Body is identical to the ADR-0037 W9 version
--    (20260424000004_apply_template_materialise.sql) except for the
--    storage_mode pre-flight check at the top.

create or replace function public.apply_sectoral_template(
  p_template_code text
) returns jsonb
language plpgsql
security definer
set search_path = public, admin
as $$
declare
  v_org_id          uuid := public.current_org_id();
  v_user_id         uuid := auth.uid();
  v_template        admin.sectoral_templates%rowtype;
  v_org_mode        text;
  v_purpose         jsonb;
  v_materialised    int  := 0;
begin
  if v_user_id is null then
    raise exception 'authentication required';
  end if;
  if v_org_id is null then
    raise exception 'no org on current session';
  end if;

  select * into v_template
    from admin.sectoral_templates
   where template_code = p_template_code
     and status = 'published'
   order by version desc
   limit 1;

  if v_template.id is null then
    raise exception 'no published template with code %', p_template_code;
  end if;

  -- ADR-1003 Sprint 4.1: storage_mode pre-flight. If the template declares
  -- a default_storage_mode, the org's current storage_mode MUST already
  -- match. Customer-side apply cannot flip storage_mode — only the admin
  -- console (admin.set_organisation_storage_mode) can. Security Rule 3:
  -- FHIR / clinical content is never persisted; the healthcare template
  -- ships zero_storage and refuses to silently relax this.
  if v_template.default_storage_mode is not null then
    select coalesce(storage_mode, 'standard') into v_org_mode
      from public.organisations
     where id = v_org_id;

    if v_org_mode is distinct from v_template.default_storage_mode then
      raise exception
        'template % requires storage_mode=% but this org is %; ask your admin '
        'to switch storage mode first via admin.set_organisation_storage_mode',
        v_template.template_code,
        v_template.default_storage_mode,
        v_org_mode
        using errcode = 'P0004';
    end if;
  end if;

  update public.organisations
     set settings = coalesce(settings, '{}'::jsonb)
       || jsonb_build_object(
            'sectoral_template',
            jsonb_build_object(
              'code', v_template.template_code,
              'version', v_template.version,
              'applied_at', now(),
              'applied_by', v_user_id
            )
          )
   where id = v_org_id;

  for v_purpose in
    select * from jsonb_array_elements(coalesce(v_template.purpose_definitions, '[]'::jsonb))
  loop
    if v_purpose->>'purpose_code' is null or (v_purpose->>'purpose_code') = '' then
      continue;
    end if;

    insert into public.purpose_definitions (
      org_id, purpose_code, display_name, description,
      data_scope, default_expiry_days, auto_delete_on_expiry,
      framework, is_active
    ) values (
      v_org_id,
      v_purpose->>'purpose_code',
      coalesce(v_purpose->>'display_name', v_purpose->>'purpose_code'),
      coalesce(v_purpose->>'description', ''),
      coalesce(
        (select array_agg(x) from jsonb_array_elements_text(
          coalesce(v_purpose->'data_scope', '[]'::jsonb)
        ) x),
        '{}'::text[]
      ),
      coalesce((v_purpose->>'default_expiry_days')::int, 365),
      coalesce((v_purpose->>'auto_delete_on_expiry')::boolean, false),
      coalesce(v_purpose->>'framework', 'dpdp'),
      true
    )
    on conflict (org_id, purpose_code, framework) do update set
      display_name          = excluded.display_name,
      description           = excluded.description,
      data_scope            = excluded.data_scope,
      default_expiry_days   = excluded.default_expiry_days,
      auto_delete_on_expiry = excluded.auto_delete_on_expiry,
      is_active             = true,
      updated_at            = now();

    v_materialised := v_materialised + 1;
  end loop;

  return jsonb_build_object(
    'code',               v_template.template_code,
    'version',            v_template.version,
    'display_name',       v_template.display_name,
    'purpose_count',      jsonb_array_length(coalesce(v_template.purpose_definitions, '[]'::jsonb)),
    'materialised_count', v_materialised,
    'storage_mode',       v_template.default_storage_mode
  );
end;
$$;

grant execute on function public.apply_sectoral_template(text) to authenticated;

-- 3. Seed Healthcare Starter (one published row).
-- created_by / published_by attribution: same chosen_admin pattern as the
-- BFSI seed — bootstrap admin first, oldest active platform_operator
-- second. If neither exists, the insert is skipped (benign); the migration
-- can be re-run after an admin is created.

with chosen_admin as (
  (select id, 1 as pri
     from admin.admin_users
    where bootstrap_admin = true
      and status = 'active')
  union all
  (select id, 2 as pri
     from admin.admin_users
    where status = 'active'
      and admin_role = 'platform_operator'
    order by created_at asc)
  order by pri asc
  limit 1
)
insert into admin.sectoral_templates (
  template_code, display_name, description, sector, version,
  status, purpose_definitions, default_storage_mode, connector_defaults,
  created_by, published_at, published_by
)
select
  'healthcare_starter',
  'Healthcare Starter',
  'DPDP-aligned consent baseline for clinics, hospitals, diagnostic centres, '
    'pharmacies and telemedicine providers operating under DISHA, the Clinical '
    'Establishments Act, ABDM (Ayushman Bharat Digital Mission) and the 2020 '
    'Telemedicine Practice Guidelines. Ships with storage_mode=zero_storage '
    'as the default — Security Rule 3: FHIR / clinical content is never '
    'persisted in ConsentShield; only consent artefacts and category labels '
    'are recorded.',
  'healthcare',
  1,
  'published',
  $$[
    {
      "purpose_code": "teleconsultation",
      "display_name": "Teleconsultation with a registered medical practitioner",
      "description": "We connect you with a registered doctor over video, voice or chat under the 2020 Telemedicine Practice Guidelines. We record the consultation event (doctor identifier, date, mode, duration) and the prescription written by the doctor; we do not retain the audio / video itself unless you separately consent. Withdrawal stops new teleconsultations; existing prescriptions remain in your medical record under DISHA 7-year retention.",
      "data_scope": ["full_name", "date_of_birth", "mobile_number", "abha_number_reference", "consultation_event_metadata", "prescription_pointer"],
      "default_expiry_days": 2555,
      "auto_delete_on_expiry": false,
      "framework": "dpdp+disha",
      "legal_basis": "consent",
      "is_default_enabled": true,
      "sector_regulation_refs": ["Telemedicine Practice Guidelines 2020 §3", "DISHA Draft 2018 §28", "DPDP Act 2023 §6"]
    },
    {
      "purpose_code": "prescription_dispensing",
      "display_name": "Sharing prescriptions with pharmacy partners for dispensing",
      "description": "If you ask, we share your prescription with a pharmacy of your choice so that the medication can be dispensed and, where applicable, delivered to you. We share only the prescription details — the prescribing doctor, the medicines, dosage and duration — and your delivery contact. Declining means you keep the prescription and arrange dispensing yourself.",
      "data_scope": ["full_name", "mobile_number", "delivery_address", "prescription_pointer", "pharmacy_identifier"],
      "default_expiry_days": 730,
      "auto_delete_on_expiry": true,
      "framework": "dpdp+disha",
      "legal_basis": "consent",
      "is_default_enabled": false,
      "sector_regulation_refs": ["Drugs and Cosmetics Act 1940 Schedule H/H1", "DPDP Act 2023 §6"]
    },
    {
      "purpose_code": "lab_report_access",
      "display_name": "Sharing diagnostic and lab reports with referring providers",
      "description": "Diagnostic and pathology reports created for you can be shared with the doctor or hospital that referred you, so they can act on the result without asking you to repeat the test. We share the report pointer and a summary classification (normal / abnormal / critical); the full report stays in your records.",
      "data_scope": ["full_name", "abha_number_reference", "lab_report_token", "result_classification_category", "referring_provider_identifier"],
      "default_expiry_days": 2555,
      "auto_delete_on_expiry": false,
      "framework": "dpdp+disha",
      "legal_basis": "consent",
      "is_default_enabled": true,
      "sector_regulation_refs": ["DISHA Draft 2018 §29", "Clinical Establishments (Central Government) Rules 2012 §9", "DPDP Act 2023 §6"]
    },
    {
      "purpose_code": "insurance_claim_share_abdm",
      "display_name": "Sharing health records with insurers via ABDM for claim settlement",
      "description": "When you raise an insurance claim or pre-authorisation request, we share the specific health records the insurer needs through your ABHA (Ayushman Bharat Health Account) and an ABDM consent artefact you approve in your ABHA app. The records you select, the duration and the insurer are exactly what the artefact says — we cannot share anything else under the same consent.",
      "data_scope": ["abha_number_reference", "abdm_consent_artefact_id", "claim_reference_number", "record_category", "insurer_identifier"],
      "default_expiry_days": 365,
      "auto_delete_on_expiry": true,
      "framework": "dpdp+abdm",
      "legal_basis": "consent",
      "is_default_enabled": false,
      "sector_regulation_refs": ["ABDM Health Data Management Policy v2 §6", "IRDAI Health Insurance Regulations 2016", "DPDP Act 2023 §6"]
    },
    {
      "purpose_code": "appointment_reminders",
      "display_name": "Appointment reminders, follow-up and care messages",
      "description": "We send you appointment reminders, vaccination follow-ups and care-pathway messages over SMS, WhatsApp, email or voice call. Each message names the clinic and the appointment / care context; we do not include diagnostic detail in the message. You can change the channel preference any time and withdraw consent without affecting the underlying clinical record.",
      "data_scope": ["full_name", "mobile_number", "email", "appointment_event_metadata", "contact_channel_preference"],
      "default_expiry_days": 365,
      "auto_delete_on_expiry": true,
      "framework": "dpdp",
      "legal_basis": "consent",
      "is_default_enabled": true,
      "sector_regulation_refs": ["TRAI TCCCPR 2018", "DPDP Act 2023 §6"]
    },
    {
      "purpose_code": "marketing",
      "display_name": "Marketing of unrelated products and offers",
      "description": "We would like to send you promotional offers about new clinic services, packages, partner programmes and lifestyle products. This is optional, separate from appointment reminders, and declining has no effect on the care you receive. You can withdraw any time from your preferences screen.",
      "data_scope": ["full_name", "mobile_number", "email", "product_interest_category", "contact_channel_preference"],
      "default_expiry_days": 365,
      "auto_delete_on_expiry": true,
      "framework": "dpdp",
      "legal_basis": "consent",
      "is_default_enabled": false,
      "sector_regulation_refs": ["DPDP Act 2023 §6", "TRAI TCCCPR 2018"]
    },
    {
      "purpose_code": "research_broad_consent",
      "display_name": "De-identified data use for clinical research and quality improvement",
      "description": "With your separate consent, de-identified copies of your records may be used for clinical research, quality-of-care studies and public-health surveillance approved by an institutional ethics committee. De-identification removes name, contact, ABHA and exact dates; the residual record cannot be linked back to you without the original key, which we keep secured. Withdrawal stops future research use; analyses already published cannot be retracted.",
      "data_scope": ["deidentified_record_pointer", "study_protocol_reference", "ethics_committee_approval_id", "consent_withdrawal_token"],
      "default_expiry_days": 1825,
      "auto_delete_on_expiry": false,
      "framework": "dpdp+icmr",
      "legal_basis": "consent",
      "is_default_enabled": false,
      "sector_regulation_refs": ["ICMR National Ethical Guidelines for Biomedical and Health Research 2017", "DISHA Draft 2018 §32", "DPDP Act 2023 §6"]
    }
  ]$$::jsonb,
  'zero_storage',
  $${
    "appointment_reminder_vendor": {
      "category": "messaging",
      "examples": ["MSG91", "Gupshup", "Twilio India", "Karix"],
      "rationale": "Used for SMS/WhatsApp/voice reminder fan-out under the appointment_reminders purpose."
    },
    "emr_vendor": {
      "category": "electronic_medical_record",
      "examples": ["Practo Ray", "Halemind", "Clinikally", "MocDoc", "Lybrate (clinic CRM)"],
      "rationale": "Source of truth for clinical records — connector required so deletion / consent-withdrawal events can be propagated to the EMR for the records the customer keeps under DISHA 7-year retention."
    }
  }$$::jsonb,
  ca.id,
  now(),
  ca.id
from chosen_admin ca
on conflict (template_code, version) do nothing;

-- Verification (run manually after db push):
--   select template_code, status, jsonb_array_length(purpose_definitions),
--          default_storage_mode
--     from admin.sectoral_templates
--    where template_code = 'healthcare_starter';
--   expected: ('healthcare_starter', 'published', 7, 'zero_storage')
--
--   -- Apply to a zero_storage org:
--   --   select public.apply_sectoral_template('healthcare_starter');
--   -- expected: jsonb with materialised_count = 7, storage_mode = 'zero_storage'
--
--   -- Apply to a standard org → expect:
--   --   ERROR: template healthcare_starter requires storage_mode=zero_storage
--   --          but this org is standard; ...
--   --   SQLSTATE: P0004
