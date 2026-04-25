-- ADR-1027 Sprint 3.3 fixup — admin.sectoral_templates has no is_active
-- column. Sprint 3.3 initial migration (20260804000047) referenced it;
-- re-publish the two affected functions without that filter. `status =
-- 'published'` is the authoritative gate.

create or replace function public.resolve_account_default_template()
returns table (
  template_id      uuid,
  template_code    text,
  display_name     text,
  version          int
)
language plpgsql
security definer
set search_path = public, admin, pg_catalog
as $$
declare
  v_account_id uuid;
begin
  v_account_id := public.current_account_id();
  if v_account_id is null then
    return;
  end if;

  return query
  select t.id, t.template_code, t.display_name, t.version
    from public.accounts a
    join admin.sectoral_templates t
      on t.id = a.default_sectoral_template_id
   where a.id = v_account_id
     and t.status = 'published';
end;
$$;

grant execute on function public.resolve_account_default_template() to authenticated;

create or replace function admin.account_detail(p_account_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, admin, pg_catalog
as $$
declare
  v_acct jsonb;
  v_orgs jsonb;
  v_adj  jsonb;
  v_audit jsonb;
  v_default_template jsonb;
begin
  perform admin.require_admin('support');

  select to_jsonb(a.*) || jsonb_build_object(
           'effective_plan', public.account_effective_plan(a.id)
         )
    into v_acct
    from public.accounts a
   where a.id = p_account_id;
  if v_acct is null then
    raise exception 'account not found';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
           'id', o.id, 'name', o.name, 'status', o.status,
           'created_at', o.created_at
         ) order by o.created_at desc), '[]'::jsonb)
    into v_orgs
    from public.organisations o
   where o.account_id = p_account_id;

  select coalesce(jsonb_agg(jsonb_build_object(
           'id', pa.id, 'kind', pa.kind, 'plan', pa.plan,
           'starts_at', pa.starts_at, 'expires_at', pa.expires_at,
           'reason', pa.reason, 'granted_by', pa.granted_by,
           'created_at', pa.created_at
         ) order by pa.created_at desc), '[]'::jsonb)
    into v_adj
    from public.plan_adjustments pa
   where pa.account_id = p_account_id
     and pa.revoked_at is null
     and (pa.expires_at is null or pa.expires_at > now());

  select coalesce(jsonb_agg(jsonb_build_object(
           'action', al.action, 'admin_user_id', al.admin_user_id,
           'reason', al.reason, 'created_at', al.occurred_at,
           'new_value', al.new_value
         ) order by al.occurred_at desc), '[]'::jsonb)
    into v_audit
    from admin.admin_audit_log al
   where (al.target_id = p_account_id and al.target_table = 'public.accounts')
      or (al.org_id in (select id from public.organisations where account_id = p_account_id))
   limit 50;

  select case
           when t.id is null then null
           else jsonb_build_object(
             'id',            t.id,
             'template_code', t.template_code,
             'display_name',  t.display_name,
             'version',       t.version,
             'status',        t.status
           )
         end
    into v_default_template
    from public.accounts a
    left join admin.sectoral_templates t
      on t.id = a.default_sectoral_template_id
   where a.id = p_account_id;

  return jsonb_build_object(
    'account',            v_acct,
    'organisations',      v_orgs,
    'active_adjustments', v_adj,
    'audit_recent',       v_audit,
    'default_template',   v_default_template
  );
end;
$$;

grant execute on function admin.account_detail(uuid) to cs_admin;
