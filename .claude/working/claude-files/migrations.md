---
globs: ["supabase/migrations/**/*.sql", "supabase/seed.sql"]
---

# Database Migration Rules

## New tables — mandatory checklist

Every new table must have ALL of these before the migration is considered complete:

- [ ] `id uuid primary key default gen_random_uuid()`
- [ ] `org_id uuid not null references organisations(id) on delete cascade` (unless it's reference data)
- [ ] `created_at timestamptz default now()`
- [ ] `alter table [name] enable row level security;`
- [ ] At least one RLS policy for SELECT: `using (org_id = current_org_id())`
- [ ] At least one RLS policy for INSERT (if users can write): `with check (org_id = current_org_id())`

## New buffer tables — additional requirements

If the table holds user data that will be delivered to customer storage:

- [ ] `delivered_at timestamptz` column
- [ ] Index: `create index idx_[table]_undelivered on [table] (delivered_at) where delivered_at is null;`
- [ ] Index: `create index idx_[table]_delivered_stale on [table] (delivered_at) where delivered_at is not null;`
- [ ] `revoke update, delete on [table] from authenticated;`
- [ ] `revoke insert on [table] from authenticated;` (if written only by service roles)
- [ ] NO update or delete RLS policies — only SELECT for authenticated users
- [ ] Add the table to `sweep_delivered_buffers()` function
- [ ] Add the table to `detect_stuck_buffers()` function

## Triggers

- Mutable operational tables need: `create trigger trg_updated_at_[table] before update on [table] for each row execute function set_updated_at();`
- Tables with legal deadlines need auto-set triggers (see rights_requests and breach_notifications patterns)

## After every migration

Run the verification queries from Section 9 of consentshield-complete-schema-design.md:
1. RLS enabled on every table
2. No UPDATE/DELETE grants on buffer tables for authenticated
3. No INSERT grants on critical buffers for authenticated
4. All triggers active
5. All pg_cron jobs scheduled

## Never do

- Never disable RLS, even temporarily, even in a migration
- Never add UPDATE or DELETE policies on buffer tables
- Never drop the delivered_at column from a buffer table
- Never change the SLA deadline calculation (30 calendar days) or breach deadline (72 hours) without legal review
