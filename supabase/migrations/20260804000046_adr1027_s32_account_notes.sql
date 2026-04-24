-- ADR-1027 Sprint 3.2 — admin.account_notes + four RPCs.
--
-- Mirrors admin.org_notes semantics exactly at the account tier. Every
-- RPC writes an admin_audit_log row with:
--   * target_table = 'admin.account_notes'
--   * account_id   = the note's parent account (ADR-1027 Sprint 1.1 column)
--   * reason       = the p_reason argument the caller supplied
-- so operator audit is symmetric across the org-note and account-note
-- paths.
--
-- platform_operator carve-out: only platform_operator (and above) can
-- pin a note; support can add + update body; any admin can delete their
-- own note or delete any note at platform_operator tier. The latter
-- matches the org_notes pattern.

-- ═══════════════════════════════════════════════════════════
-- 1/6 · admin.account_notes table
-- ═══════════════════════════════════════════════════════════
create table if not exists admin.account_notes (
  id             uuid        primary key default gen_random_uuid(),
  account_id     uuid        not null references public.accounts(id) on delete cascade,
  admin_user_id  uuid        not null references admin.admin_users(id),
  body           text        not null check (length(body) >= 1),
  pinned         boolean     not null default false,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create index if not exists account_notes_account_idx
  on admin.account_notes (account_id, pinned desc, created_at desc);

alter table admin.account_notes enable row level security;

drop policy if exists account_notes_admin on admin.account_notes;
create policy account_notes_admin on admin.account_notes
  for all to authenticated
  using ((auth.jwt() -> 'app_metadata' ->> 'is_admin')::boolean = true)
  with check ((auth.jwt() -> 'app_metadata' ->> 'is_admin')::boolean = true);

grant select on admin.account_notes to authenticated;

-- ═══════════════════════════════════════════════════════════
-- 2/6 · admin.account_note_list
-- ═══════════════════════════════════════════════════════════
create or replace function admin.account_note_list(p_account_id uuid)
returns setof admin.account_notes
language plpgsql
security definer
set search_path = public, admin, pg_catalog
as $$
begin
  perform admin.require_admin('support');

  return query
    select *
      from admin.account_notes
     where account_id = p_account_id
     order by pinned desc, created_at desc;
end;
$$;

grant execute on function admin.account_note_list(uuid) to cs_admin;

-- ═══════════════════════════════════════════════════════════
-- 3/6 · admin.account_note_add
-- ═══════════════════════════════════════════════════════════
create or replace function admin.account_note_add(
  p_account_id uuid,
  p_body       text,
  p_pinned     boolean default false,
  p_reason     text    default 'operator account note added'
)
returns uuid
language plpgsql
security definer
set search_path = public, admin, pg_catalog
as $$
declare
  v_admin uuid := auth.uid();
  v_id    uuid;
begin
  perform admin.require_admin('support');

  if length(coalesce(p_body, '')) < 1 then
    raise exception 'body required';
  end if;

  -- Only platform_operator+ can pin.
  if p_pinned then
    perform admin.require_admin('platform_operator');
  end if;

  insert into admin.account_notes (account_id, admin_user_id, body, pinned)
  values (p_account_id, v_admin, p_body, p_pinned)
  returning id into v_id;

  insert into admin.admin_audit_log
    (admin_user_id, action, target_table, target_id, account_id,
     new_value, reason)
  values
    (v_admin, 'add_account_note', 'admin.account_notes', v_id, p_account_id,
     jsonb_build_object('pinned', p_pinned, 'body_length', length(p_body)),
     p_reason);

  return v_id;
end;
$$;

grant execute on function admin.account_note_add(uuid, text, boolean, text) to cs_admin;

-- ═══════════════════════════════════════════════════════════
-- 4/6 · admin.account_note_update
-- ═══════════════════════════════════════════════════════════
create or replace function admin.account_note_update(
  p_note_id uuid,
  p_body    text,
  p_pinned  boolean,
  p_reason  text default 'operator account note updated'
)
returns void
language plpgsql
security definer
set search_path = public, admin, pg_catalog
as $$
declare
  v_admin uuid := auth.uid();
  v_old   jsonb;
  v_account_id uuid;
  v_was_pinned boolean;
begin
  perform admin.require_admin('support');

  select to_jsonb(n.*), n.account_id, n.pinned
    into v_old, v_account_id, v_was_pinned
    from admin.account_notes n
   where n.id = p_note_id;
  if v_old is null then
    raise exception 'account note not found';
  end if;

  -- Pinning requires platform_operator; unpinning requires the same tier
  -- (consistency: only platform_operator decides the pinned state).
  if p_pinned is distinct from v_was_pinned then
    perform admin.require_admin('platform_operator');
  end if;

  if length(coalesce(p_body, '')) < 1 then
    raise exception 'body required';
  end if;

  update admin.account_notes
     set body       = p_body,
         pinned     = p_pinned,
         updated_at = now()
   where id = p_note_id;

  insert into admin.admin_audit_log
    (admin_user_id, action, target_table, target_id, account_id,
     old_value, new_value, reason)
  values
    (v_admin, 'update_account_note', 'admin.account_notes', p_note_id, v_account_id,
     v_old,
     jsonb_build_object('pinned', p_pinned, 'body_length', length(p_body)),
     p_reason);
end;
$$;

grant execute on function admin.account_note_update(uuid, text, boolean, text) to cs_admin;

-- ═══════════════════════════════════════════════════════════
-- 5/6 · admin.account_note_delete
-- ═══════════════════════════════════════════════════════════
create or replace function admin.account_note_delete(
  p_note_id uuid,
  p_reason  text default 'operator account note deleted'
)
returns void
language plpgsql
security definer
set search_path = public, admin, pg_catalog
as $$
declare
  v_admin uuid := auth.uid();
  v_old   jsonb;
  v_account_id uuid;
begin
  perform admin.require_admin('platform_operator');

  select to_jsonb(n.*), n.account_id
    into v_old, v_account_id
    from admin.account_notes n
   where n.id = p_note_id;
  if v_old is null then
    raise exception 'account note not found';
  end if;

  delete from admin.account_notes where id = p_note_id;

  insert into admin.admin_audit_log
    (admin_user_id, action, target_table, target_id, account_id,
     old_value, reason)
  values
    (v_admin, 'delete_account_note', 'admin.account_notes', p_note_id, v_account_id,
     v_old, p_reason);
end;
$$;

grant execute on function admin.account_note_delete(uuid, text) to cs_admin;

-- ═══════════════════════════════════════════════════════════
-- 6/6 · Verification
-- ═══════════════════════════════════════════════════════════
-- select count(*) from pg_policies where schemaname='admin' and tablename='account_notes'; → 1
-- select admin.account_note_add('<acct-uuid>','hello world',false,'test add'); → uuid
-- select * from admin.account_note_list('<acct-uuid>'); → one row
