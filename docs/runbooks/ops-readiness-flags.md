# Ops Readiness Flags — operator runbook

**Scope:** `admin.ops_readiness_flags` table + `/admin/(operator)/readiness` panel.
**Source:** ADR-1017 — admin ops-readiness flags.

## What it is

A surface in the operator console that lists every pending
external/organisational blocker the product carries across its ADR
backlog. Every row is one blocker: "engage counsel", "sign a reference
partner", "provision PagerDuty", "decide SE capacity", etc.

Without this panel, those blockers live only in session-handoff notes
and ADR sprint tables. A founder who opens the admin console between
coding sessions has no warning that (for example) SLA docs don't exist
and that a BFSI procurement conversation depending on them would over-
commit.

## Blocker types

`admin.ops_readiness_flags.blocker_type` has six values:

| type       | use for                                                             |
|------------|---------------------------------------------------------------------|
| `legal`    | counsel review, draft contracts from counsel, compliance sign-off.  |
| `partner`  | friendly partner MoU, reference customer, integration pilot.        |
| `infra`    | paid SaaS provisioning, DNS, Cloudflare, vendor accounts.           |
| `contract` | SLA / severity matrix / purchase terms / commercial templates.      |
| `hiring`   | headcount decisions, contractor onboarding, named reserves.         |
| `other`    | internal sprint deferrals (pure code but explicitly parked).        |

The first five are "real-world" blockers that require a purchase,
signature, or named human. `other` is for sprints deferred inside a
session that would otherwise fall off the back of handoffs — the
resolution is code, but the tracking pattern is the same.

## Severity

| severity   | meaning                                                            |
|------------|---------------------------------------------------------------------|
| `critical` | blocks a revenue-bearing or safety path right now.                  |
| `high`     | blocks a near-term procurement conversation or customer commit.     |
| `medium`   | required for a declared release line but not today's commitments.   |
| `low`      | cleanup; no customer commitment depends on it.                      |

`/admin/(operator)/readiness` surfaces `pending` + `in_progress` rows
first, ordered by severity. `resolved` / `deferred` rows stay in the
list for history but sort last.

## Adding a new flag

Insert rows via migration. Hand-writing into the table from psql is
fine for experiments but every shipped flag should live in a migration
so that the seed is reproducible on a fresh database.

```sql
insert into admin.ops_readiness_flags (
  title, description, source_adr, blocker_type, severity, status, owner
) values (
  'Short human-readable title — what needs to happen',
  'Longer paragraph: exactly what must happen, what resolves it, who '
  'owns it, any links or budget estimates, what the risk looks like '
  'if this drifts for weeks.',
  'ADR-XXXX Sprint Y.Z',
  'legal',          -- or partner / infra / contract / hiring / other
  'high',           -- or critical / medium / low
  'pending',
  'Sudhindra (procurement)'
);
```

Keep the migration filename in the `20260804NNNNNN_ops_readiness_*.sql`
family so related flag changes are locatable.

## Resolving / deferring a flag

### Via the admin UI

1. Open `/admin/(operator)/readiness` as a `platform_operator` or
   `platform_owner`.
2. Click "Mark in progress" when the work begins (any admin role can
   do this, incl. support).
3. When the work is done (contract signed, partner live, flag no
   longer relevant), click "Resolve" and paste a short note — the note
   lands in `resolution_notes` and shows up in the audit log.
4. For blockers that are consciously parked (e.g. "hold off until
   Phase 2 ships"), use "Defer" and again add a short note.

### Via SQL (emergency / bulk)

```sql
select * from admin.set_ops_readiness_flag_status(
  p_flag_id          => '00000000-...',
  p_status           => 'resolved',
  p_resolution_notes => 'counsel retainer signed 2026-05-10; '
                        'reviewer_name backfilled via '
                        'scripts/seed-legal-review.ts'
);
```

`set_ops_readiness_flag_status` is SECURITY DEFINER and audit-logs
every call to `admin.admin_audit_log` (action =
`ops_readiness_flag.status_changed`).

## Role gates

| action                                 | who can perform it                     |
|----------------------------------------|-----------------------------------------|
| list flags (`list_ops_readiness_flags`) | any admin (`support` and above)        |
| mark `in_progress`                      | any admin                               |
| mark `resolved` / `deferred`            | `platform_operator` or `platform_owner` |
| reopen (mark `pending` again)           | any admin                               |
| INSERT / delete rows                    | by migration (or service role in psql) |

The `platform_operator`-tier gate on resolve/defer is enforced inside
the RPC — support-tier attempts get `42501` (insufficient privilege).

## Audit expectations

Every successful `set_ops_readiness_flag_status` emits one row in
`admin.admin_audit_log`:

| column         | value                                                    |
|----------------|----------------------------------------------------------|
| `action`       | `ops_readiness_flag.status_changed`                      |
| `target_table` | `admin.ops_readiness_flags`                              |
| `target_id`    | the flag's UUID                                          |
| `old_value`    | `to_jsonb(row before update)`                            |
| `new_value`    | `to_jsonb(row after update)`                             |
| `reason`       | `ops_readiness_flag:<new_status> — <notes or 'no notes'>` |

Tests: `tests/admin/ops-readiness-flags.test.ts` (12 assertions).

## Related

- ADR-1017 — introduces the table + RPCs + admin panel.
- ADR-1018 — status-page tables + RPCs that live in the same admin
  console.
- `docs/runbooks/notification-channel-accounts.md` — several of the
  standing `infra` flags depend on this runbook being executed.
- `docs/runbooks/status-page-setup.md` — DNS + Vercel cutover covered
  by `ADR-1018 Sprint 1.5`, tracked as a `medium`/`infra` flag.
