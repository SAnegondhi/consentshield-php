# Runbook — Standard → Insulated migration

ADR-1003 Sprint 2.2. Operator-facing procedure for moving an existing Standard-mode customer to Insulated mode.

## Scope

- **Applies to.** An org currently on `storage_mode = 'standard'` (ConsentShield-managed R2 bucket) moving to `storage_mode = 'insulated'` (customer-owned bucket + write-only credential).
- **Does not apply to.** `standard → zero_storage` or `insulated → zero_storage`. Those have stricter preconditions (verified `export_configurations` row + Worker bridge setup); use the zero-storage runbook.
- **Prerequisite sprint.** ADR-1003 Sprint 2.1 (scope-down probe). Before this runbook is safe to follow, the `byok-validate` route must be enforcing the write-only scope check.

## Roles

| Role | What they do |
|---|---|
| Customer `account_owner` / `org_admin` | Provisions bucket + IAM credential; runs the validator in the dashboard; clicks **Start migration**. |
| ConsentShield operator (`platform_operator`) | Monitors `storage_migrations` state; handles stuck rows; runs the post-cut-over invariant checks. |

The customer drives the happy path. The operator only enters the loop if migration is stuck or fails.

## Pre-flight (customer side)

1. Follow `docs/customer-docs/byos-aws-s3.md` **or** `byos-cloudflare-r2.md` to provision the bucket + write-only credential.
2. Confirm the ConsentShield dashboard validator shows all five probe checks green.
3. Decide cut-over mode (see §Cut-over modes below). If unclear, default to **forward-only**.

## Pre-flight (operator side, optional)

Run these before the customer clicks **Start migration** if you want extra confidence:

```sql
-- 1. No active migration for this org. The unique exclusion constraint
--    storage_migrations_active_unique will reject a second INSERT, but
--    a clear view before start helps with expectation-setting.
select id, mode, state, started_at, objects_copied
  from public.storage_migrations
 where org_id = '<org_id>'
   and state in ('queued', 'copying')
 order by started_at desc;

-- 2. Current export_configurations row — should still point at the
--    CS-managed bucket. The migration orchestrator overwrites this
--    row at cut-over time.
select id, storage_provider, bucket_name, is_verified, last_export_at
  from public.export_configurations
 where org_id = '<org_id>';

-- 3. Baseline object count in the source bucket (informational; the
--    orchestrator re-computes this on ListObjectsV2 for copy_existing).
```

If (1) returns rows, the customer must wait for the existing migration to finish (or be canceled by support) before starting a new one.

## Cut-over modes

| Mode | Duration | Bandwidth | Historical records in new bucket | When to pick |
|---|---|---|---|---|
| `forward_only` | Seconds | None | No (stay in CS-managed for 30 days, then deleted) | Customer exports audit packages regularly; does not need historical records in their own bucket from day one. Default. |
| `copy_existing` | Minutes to hours | ~2× source size | Yes | Customer's procurement / auditor requires a single canonical record store. Resumable — a mid-copy crash picks up where it left off. |

## The migration flow

What happens when the customer clicks **Start migration**:

1. `POST /api/orgs/<orgId>/storage/byok-migrate` — auth + role gate + Turnstile + probe re-run.
2. Credentials encrypted with the per-org derived key via `encrypt_secret`.
3. `INSERT` into `public.storage_migrations` with `state='queued'`, `mode='forward_only' | 'copy_existing'`, `target_credential_enc`, `target_bucket`, `target_region`, `target_endpoint`.
4. The AFTER INSERT trigger (`trg_dispatch_storage_migration`) fires `net.http_post` to `/api/internal/migrate-storage`.
5. The orchestrator picks up the row:
   - **`forward_only`** — updates `export_configurations` to point at the new target, flips `storage_mode = 'insulated'` via the gated RPC, stamps `storage_migrations.state='completed'`. Old CS-managed bucket retained for 30 days (Phase 4 retention cron cleans it up).
   - **`copy_existing`** — runs a chunked `ListObjectsV2` (on the CS-managed source — we own that credential) + streaming copy into the target bucket. Advances `objects_copied` per chunk. On completion, does the same pointer swap as `forward_only`.

## Live monitoring

The dashboard polls `GET /api/orgs/<orgId>/storage/migrations/<migrationId>` every 3s and renders state + progress. Operator-side monitoring SQL:

```sql
-- Live state. last_activity_at should tick every few seconds during
-- copy_existing; forward_only jumps straight from queued → completed.
select id, mode, state, objects_copied, objects_total,
       started_at, last_activity_at, error_text
  from public.storage_migrations
 where org_id = '<org_id>'
 order by started_at desc
 limit 1;

-- Orchestrator errors land in worker_errors (endpoint starts with
-- /api/internal/migrate-storage). Non-empty → investigate.
select created_at, status_code, upstream_error
  from public.worker_errors
 where org_id = '<org_id>'
   and endpoint like '/api/internal/migrate-storage%'
   and created_at > now() - interval '1 hour'
 order by created_at desc;
```

### Stuck rows

A row in `state='copying'` with `last_activity_at` older than 5 minutes is stuck. Usually one of:

- **Source or target credential expired mid-copy.** The orchestrator retries on transient 5xx but not on 401/403. Ask the customer to re-paste credentials via **Settings → Storage → Update credentials** (does not create a new migration row — updates the existing one's encrypted creds).
- **Rate-limit on the target.** R2 throttles aggressive PutObject campaigns. The orchestrator honours `Retry-After` but a multi-hour rate-limit window stalls the migration. Either wait, or switch to forward_only and copy out-of-band.
- **Orchestrator itself is offline.** Check `/api/internal/migrate-storage` route health via Vercel. If the deployment is rolling, wait.

To manually advance a stuck row (emergency use only):

```sql
-- Force-fail a stuck migration so the customer can retry.
update public.storage_migrations
   set state = 'failed',
       error_text = 'Manually failed by operator — <reason>'
 where id = '<migration_id>'
   and state = 'copying'
   and last_activity_at < now() - interval '15 minutes';
```

After marking failed, coordinate with the customer before they click **Start migration** again — a second `copy_existing` run starts over from the beginning unless the orchestrator's chunk-resume logic has been verified against the specific failure mode.

## Post-cut-over validation (operator)

After state flips to `completed`, confirm:

```sql
-- 1. Mode flipped.
select storage_mode from public.organisations where id = '<org_id>';
-- Expected: 'insulated'

-- 2. export_configurations points at the new bucket + is_verified=true.
select storage_provider, bucket_name, region, endpoint, is_verified
  from public.export_configurations
 where org_id = '<org_id>';
-- Expected: storage_provider in ('customer_r2', 'customer_s3'),
-- is_verified = true.

-- 3. New events land in the customer's bucket. Wait 1 minute + post
-- a test consent event against the customer's Worker endpoint, then:
select count(*) from public.delivery_buffer
 where org_id = '<org_id>'
   and created_at > now() - interval '5 minutes'
   and delivered_at is null;
-- Expected: the buffer drains normally; no stuck rows.
```

Post a sample consent event against the customer's `/v1/events` endpoint and spot-check the customer's bucket (ask them to confirm — ConsentShield cannot list it):

```bash
curl -X POST https://workers.consentshield.in/v1/events \
  -H 'Content-Type: application/json' \
  -d '{"org_id": "<org_id>", "property_id": "<property_id>", "banner_id": "<banner_id>", "event_type": "consent_given", "purposes_accepted": ["analytics"]}'
```

Customer confirms via their S3/R2 console that an object landed at `<path_prefix>consent_events/<today>/`.

## Rollback

If the post-cut-over validation fails and the customer needs to revert to Standard mode:

1. **Do NOT** try to copy records back from the customer's bucket — by construction we cannot `GetObject` or `ListBucket` on their side.
2. Flip `storage_mode` back to `standard` via the admin RPC:
   ```sql
   select admin.set_organisation_storage_mode(
     '<org_id>'::uuid,
     'standard',
     'Rollback of botched Insulated cut-over — ref incident <id>'
   );
   ```
3. `export_configurations` will be re-provisioned on the CS side — run ADR-1025's Phase 2 provisioning flow (or call support to do it).
4. Accept that events landed in the customer's bucket during the botched window are only in their bucket. They are not lost, but they are not in the CS record either. The customer's bucket is their compliance record for that window; the operator notes this in their incident report.

Rollback is one-way from the customer's perspective — any records written to their bucket stay there. ConsentShield cannot pull them back.

## Runbook versioning

This runbook is keyed to the schema + route versions at ADR-1003 Sprint 2.2 close-out. Material changes to the BYOK flow (new cut-over modes, changed state machine, different auth chain) must bump this runbook with an explicit ADR reference.
