-- ADR-0027 Sprint 3.1 follow-up — fix admin.add_org_note return path.
--
-- Original function in 20260417000012 declared `returns uuid` but ran
-- off the end of the function body without a RETURN, tripping
-- SQLSTATE 2F005 ("control reached end of function without RETURN"). No
-- caller in Sprint 3.1 consumed the return value, so the contract is
-- preserved by keeping `returns uuid` and adding the missing
-- `return v_id;` at the end.

create or replace function admin.add_org_note(
  p_org_id uuid, p_body text, p_pinned boolean default false
) returns uuid
language plpgsql security definer set search_path = admin, public
as $$
declare
  v_admin uuid := auth.uid();
  v_id uuid;
begin
  perform admin.require_admin('support');
  if length(coalesce(p_body, '')) < 1 then raise exception 'body required'; end if;

  insert into admin.org_notes (org_id, admin_user_id, body, pinned)
  values (p_org_id, v_admin, p_body, p_pinned)
  returning id into v_id;

  insert into admin.admin_audit_log
    (admin_user_id, action, target_table, target_id, org_id, new_value, reason)
  values
    (v_admin, 'add_org_note', 'admin.org_notes', v_id, p_org_id,
     jsonb_build_object('pinned', p_pinned, 'body_length', length(p_body)),
     'operator note added');

  return v_id;
end;
$$;
