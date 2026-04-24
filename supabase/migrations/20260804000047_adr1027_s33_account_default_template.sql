-- ADR-1027 Sprint 3.3 — account-default sectoral template.
--
-- New column on public.accounts, a platform_operator-gated RPC to set
-- it, a second RPC the customer app's onboarding wizard can call to
-- resolve "what template should I default to for this org's account",
-- and an updated admin.account_detail envelope that includes the
-- resolved template summary.
--
-- Customer-side wizard pre-selection lands in the same sprint: the
-- Next.js step-4-purposes component calls
-- public.resolve_account_default_template() and highlights the
-- matching template (if still published) with a badge.

-- ═══════════════════════════════════════════════════════════
-- 1/5 · public.accounts.default_sectoral_template_id
-- ═══════════════════════════════════════════════════════════
-- Nullable; an account starts with no default. Templates stay global
-- in admin.*; the FK lets the customer app join without a cross-schema
-- security leak because the template rows are non-sensitive (sector
-- name, display copy, purpose definitions — already public-readable
-- via list_sectoral_templates_for_sector).
alter table public.accounts
  add column if not exists default_sectoral_template_id uuid;

do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conname = 'accounts_default_sectoral_template_fkey'
  ) then
    alter table public.accounts
      add constraint accounts_default_sectoral_template_fkey
      foreign key (default_sectoral_template_id)
      references admin.sectoral_templates(id)
      on delete set null;
  end if;
end $$;

-- ═══════════════════════════════════════════════════════════
-- 2/5 · admin.set_account_default_template
-- ═══════════════════════════════════════════════════════════
-- platform_operator-tier only. Accepts NULL p_template_id to clear the
-- default. Validates that the template is status='published' when
-- setting; clearing is always allowed.
create or replace function admin.set_account_default_template(
  p_account_id uuid,
  p_template_id uuid,
  p_reason text default 'set account default template'
)
returns void
language plpgsql
security definer
set search_path = public, admin, pg_catalog
as $$
declare
  v_admin uuid := auth.uid();
  v_old_id uuid;
  v_template_status text;
begin
  perform admin.require_admin('platform_operator');

  select default_sectoral_template_id into v_old_id
    from public.accounts
   where id = p_account_id;
  if not found then
    raise exception 'account not found';
  end if;

  if p_template_id is not null then
    select status into v_template_status
      from admin.sectoral_templates
     where id = p_template_id;
    if v_template_status is null then
      raise exception 'template not found';
    end if;
    if v_template_status <> 'published' then
      raise exception 'template % is %; must be published to set as account default', p_template_id, v_template_status;
    end if;
  end if;

  update public.accounts
     set default_sectoral_template_id = p_template_id,
         updated_at = now()
   where id = p_account_id;

  insert into admin.admin_audit_log
    (admin_user_id, action, target_table, target_id, account_id,
     old_value, new_value, reason)
  values
    (v_admin, 'set_account_default_template', 'public.accounts',
     p_account_id, p_account_id,
     jsonb_build_object('default_sectoral_template_id', v_old_id),
     jsonb_build_object('default_sectoral_template_id', p_template_id),
     p_reason);
end;
$$;

grant execute on function admin.set_account_default_template(uuid, uuid, text) to cs_admin;

-- ═══════════════════════════════════════════════════════════
-- 3/5 · public.resolve_account_default_template — customer-side helper
-- ═══════════════════════════════════════════════════════════
-- Returns the account-default template details for the caller's current
-- org, OR NULL if none is set or the set template is no longer
-- published. Called by the onboarding wizard to highlight the default.
-- Scoped via current_account_id() so a user cannot peek at another
-- account's default.
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

-- ═══════════════════════════════════════════════════════════
-- 4/5 · admin.account_detail envelope — include default_template
-- ═══════════════════════════════════════════════════════════
-- Amendment to the ADR-0048 Sprint 1.1 envelope. Mirrors the existing
-- block for `organisations`, `active_adjustments`, `audit_recent`.
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

  -- ADR-1027 Sprint 3.3 — default template summary. Surfaces the
  -- resolved row when the account has one set. Status column flags
  -- stale (deprecated) defaults so the UI can warn the operator; we
  -- don't NULL-out deprecated rows here because the operator still
  -- wants to see the staleness and fix it.
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

-- ═══════════════════════════════════════════════════════════
-- 5/5 · Verification
-- ═══════════════════════════════════════════════════════════
-- select admin.set_account_default_template('<acct>', '<tpl>', 'test');
-- select admin.account_detail('<acct>');  → envelope with default_template key
-- select * from public.resolve_account_default_template();
