-- ADR-0037 Sprint 1.5 — W9 onboarding seed pack materialisation.
--
-- ADR-0030 Sprint 3.1 shipped public.apply_sectoral_template which writes
-- organisations.settings.sectoral_template = { code, version, applied_at }
-- but deliberately did NOT materialise the template's purpose_definitions
-- JSONB payload into public.purpose_definitions rows. Comment in that RPC:
-- "This RPC DOES NOT materialise... that's a future DEPA sprint."
--
-- That sprint is W9. This migration re-creates the RPC so that after
-- writing the pointer it iterates v_template.purpose_definitions and
-- UPSERTs public.purpose_definitions rows for the caller's org. Idempotent
-- via ON CONFLICT (org_id, purpose_code, framework) DO UPDATE — re-applying
-- the same template version overwrites local edits with the template's
-- canonical values (documented UX).
--
-- Returned payload gains materialised_count so the UI can show "Applied N
-- purposes from <template>".
--
-- JSONB fields are read defensively because Terminal A's minimal test
-- payload only carries purpose_code + display_name. Missing fields fall
-- back to sensible defaults aligned with public.purpose_definitions column
-- defaults.

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
  v_purpose         jsonb;
  v_materialised    int  := 0;
begin
  if v_user_id is null then
    raise exception 'authentication required';
  end if;
  if v_org_id is null then
    raise exception 'no org on current session';
  end if;

  -- Pick the latest published version of the template_code.
  select * into v_template
    from admin.sectoral_templates
   where template_code = p_template_code
     and status = 'published'
   order by version desc
   limit 1;

  if v_template.id is null then
    raise exception 'no published template with code %', p_template_code;
  end if;

  -- Pointer write (unchanged behaviour from ADR-0030).
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

  -- ADR-0037 W9: materialise the template's purpose_definitions into
  -- public.purpose_definitions. Idempotent via UPSERT.
  for v_purpose in
    select * from jsonb_array_elements(coalesce(v_template.purpose_definitions, '[]'::jsonb))
  loop
    -- Skip entries that don't carry a purpose_code — they can't be keyed.
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
    'code',             v_template.template_code,
    'version',          v_template.version,
    'display_name',     v_template.display_name,
    'purpose_count',    jsonb_array_length(coalesce(v_template.purpose_definitions, '[]'::jsonb)),
    'materialised_count', v_materialised
  );
end;
$$;

grant execute on function public.apply_sectoral_template(text) to authenticated;

-- Verification:
--   select (public.apply_sectoral_template('dpdp_minimum')).materialised_count;
--   → integer equal to count of purpose rows in the template payload.
