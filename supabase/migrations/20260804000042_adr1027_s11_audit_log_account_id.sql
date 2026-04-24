-- ADR-1027 Sprint 1.1 — admin.admin_audit_log.account_id column.
--
-- Context: post-ADR-0044 the tenancy pivot moved from organisations to
-- accounts. admin.admin_audit_log still only carries org_id. Filtering
-- by account requires a join through organisations every time, and any
-- row whose target is the account itself (e.g. suspend_account) carries
-- NULL org_id so it's invisible in org-scoped filters. This migration
-- adds the missing dimension.
--
-- Scope:
--   1) Add admin_audit_log.account_id uuid (nullable; FK to accounts).
--   2) Backfill existing rows from public.organisations.account_id
--      where org_id is not null.
--   3) BEFORE INSERT trigger populates account_id from org_id if the
--      caller omitted it, so no write path can forget.
--   4) Partial index on account_id (for the new filter).
--
-- Append-only invariant: the trigger runs as the table owner (postgres)
-- and bypasses the INSERT/UPDATE revokes; no grant change needed. The
-- backfill UPDATE in this migration runs under supabase db push as the
-- migration owner, which also bypasses the revoke.

alter table admin.admin_audit_log
  add column if not exists account_id uuid;

-- FK after the column is in place so the backfill has a schema target.
-- Nullable: platform-tier actions (e.g. block_ip) have no account scope.
do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conname = 'admin_audit_log_account_id_fkey'
  ) then
    alter table admin.admin_audit_log
      add constraint admin_audit_log_account_id_fkey
      foreign key (account_id) references public.accounts(id);
  end if;
end $$;

-- Backfill: every row with org_id populated inherits its parent account.
-- Rows where the target IS the account itself (target_table = 'public.accounts')
-- get account_id from target_id directly. Rows with neither (platform actions)
-- stay NULL.
update admin.admin_audit_log al
   set account_id = o.account_id
  from public.organisations o
 where al.org_id = o.id
   and al.account_id is null;

-- Only backfill target-is-account rows whose account still exists. A
-- deleted test account will have audit rows that point at a now-gone
-- id; those rows keep account_id = NULL rather than failing the FK.
update admin.admin_audit_log al
   set account_id = al.target_id
  from public.accounts a
 where al.target_table = 'public.accounts'
   and al.target_id is not null
   and al.account_id is null
   and a.id = al.target_id;

-- Partial index — the account filter skips NULL-account rows unless the
-- operator explicitly asks for "Platform (no account)".
create index if not exists admin_audit_log_account_idx
  on admin.admin_audit_log (account_id, occurred_at desc)
  where account_id is not null;

-- BEFORE INSERT trigger: if caller omitted account_id but provided
-- org_id, look up and populate. Same shape for target-is-account rows.
-- Runs as the function owner (postgres), which bypasses the INSERT
-- revoke on authenticated + cs_admin.
create or replace function admin.populate_audit_log_account_id()
returns trigger
language plpgsql
security definer
set search_path = public, admin, pg_catalog
as $$
begin
  -- Explicit account_id wins; never override a caller-supplied value.
  if new.account_id is not null then
    return new;
  end if;

  -- target_table = 'public.accounts' → target_id IS the account_id.
  if new.target_table = 'public.accounts' and new.target_id is not null then
    new.account_id := new.target_id;
    return new;
  end if;

  -- org-scoped row → look up the parent account.
  if new.org_id is not null then
    select o.account_id into new.account_id
      from public.organisations o
     where o.id = new.org_id;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_populate_audit_log_account_id on admin.admin_audit_log;
create trigger trg_populate_audit_log_account_id
  before insert on admin.admin_audit_log
  for each row execute function admin.populate_audit_log_account_id();

-- Verification queries (run manually; not executed by db push):
--   select count(*) filter (where account_id is not null) as with_account,
--          count(*) filter (where account_id is null)     as without_account
--     from admin.admin_audit_log;
--   -- expect: with_account covers every row that has a resolvable org_id
--   --         or target_table='public.accounts'; without_account covers
--   --         platform-tier rows (block_ip, deprecate_connector, etc.).
--
--   -- Trigger test: insert via an admin RPC, observe account_id auto-filled.
