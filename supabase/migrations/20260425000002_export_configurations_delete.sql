-- ADR-0040 Sprint 1.2 — add DELETE policy on export_configurations.
--
-- ADR-0013's RLS setup gave export_configurations SELECT/INSERT/UPDATE
-- policies gated on org_id=current_org_id() but no DELETE. ADR-0040's
-- deleteR2Config server action needs one so customers can remove a
-- stored credential set. Admin/owner gating is enforced in the server
-- action (not the policy) for consistency with the other dashboard
-- admin-gated actions.

create policy "org_delete" on export_configurations
  for delete using (org_id = current_org_id());
