// ADR-1019 Sprint 2.1 — deliver a single delivery_buffer row to R2.
//
// Flow per row:
//   1. SELECT the delivery_buffer row joined to its export_configurations
//      row (LEFT JOIN so we can diagnose missing/unverified configs).
//   2. Refuse & mark delivery_error when the row is un-deliverable:
//      no_export_config | unverified_export_config
//   3. Derive the endpoint (endpointForProvider), derive the per-org key
//      (deriveOrgKey), decrypt the stored credentials (decryptCredentials).
//      Credentials live only in the request-scoped closure; never logged,
//      never returned.
//   4. Canonical-serialise the payload (sorted keys, UTF-8, trailing LF)
//      so content-hash comparisons are reproducible.
//   5. PUT to <bucket>/<path_prefix><event_type>/<YYYY>/<MM>/<DD>/<id>.json
//      with metadata headers cs-row-id / cs-org-id / cs-event-type /
//      cs-created-at.
//   6. On success — UPDATE delivered_at=now() AND DELETE in one transaction.
//      On failure — UPDATE attempt_count + last_attempted_at + delivery_error;
//      leave row in place for retry.
//
// Sprint 2.2 will add the batch variant + exponential backoff.
// Sprint 2.3 will add unknown-event_type handling + manual-review
// escalation once attempt_count >= 10.
//
// Runs under cs_delivery (Next.js LOGIN role via csDelivery() from
// app/src/lib/api/cs-delivery-client.ts). Rule 5 least-privilege
// preserved: cs_delivery has narrow grants on buffer tables +
// export_configurations + decrypt_secret; nothing else.

import type postgres from 'postgres'
import { endpointForProvider } from '@/lib/storage/endpoint'
import { decryptCredentials, deriveOrgKey } from '@/lib/storage/org-crypto'
import { putObject as putObjectReal } from '@/lib/storage/sigv4'
import { canonicalJson } from './canonical-json'
import { objectKeyFor } from './object-key'

type Pg = ReturnType<typeof postgres>

export type DeliverOutcome =
  | 'delivered'
  | 'not_found'
  | 'already_delivered'
  | 'no_export_config'
  | 'unverified_export_config'
  | 'upload_failed'
  | 'decrypt_failed'
  | 'endpoint_failed'
  | 'unknown_event_type'

// ADR-1019 Sprint 2.3 — known event_type values (per Decision table).
// Unknown types are quarantined without incrementing attempt_count so the
// row stays visible until a producer ADR adds the type or an operator
// intervenes. New event_types MUST be added here before they're staged by
// producers.
export const KNOWN_EVENT_TYPES: ReadonlySet<string> = new Set([
  'consent_event',
  'artefact_revocation',
  'artefact_expiry_deletion',
  'consent_expiry_alert',
  'tracker_observation',
  'audit_log_entry',
  'rights_request_event',
  'deletion_receipt',
])

// ADR-1019 Sprint 2.3 — manual-review threshold. markFailure escalates on
// the attempt that PUSHES attempt_count to this value.
const MANUAL_REVIEW_THRESHOLD = 10

export interface DeliverOneResult {
  outcome: DeliverOutcome
  rowId: string
  orgId?: string
  eventType?: string
  bucket?: string
  objectKey?: string
  durationMs: number
  attempt?: number
  error?: string
}

export interface DeliverDeps {
  putObject?: typeof putObjectReal
  now?: () => number
}

// ADR-1019 Sprint 2.2 — batch + backoff.
//
// Per-request wall-time budget. Stops pulling new rows once exceeded; the
// cron's next 60s tick picks up where we left off. 270 s matches the
// convention set by the ADR-1025 storage routes (4.5 min — safe under
// Fluid Compute's 300s cap with ~30s headroom for the last row in flight).
const BATCH_TIME_BUDGET_MS = 270_000

export interface BatchSummary {
  attempted: number
  delivered: number
  quarantined: number
  budgetExceeded: boolean
  outcomes: Record<DeliverOutcome, number>
}

export interface DeliverBatchDeps extends DeliverDeps {
  // Tests override with vi.fn; production callers omit and get the real one.
  deliverOneFn?: typeof deliverOne
}

export async function deliverBatch(
  pg: Pg,
  limit = 200,
  deps: DeliverBatchDeps = {},
): Promise<BatchSummary> {
  const now = deps.now ?? (() => Date.now())
  const oneFn = deps.deliverOneFn ?? deliverOne
  const started = now()

  // Select candidate row ids:
  //   · not delivered
  //   · under the manual-review threshold (Sprint 2.3 handles the escalation;
  //     this sprint skips them so retries don't burn cycles)
  //   · past the exponential-backoff gate (LEAST(2^attempt_count, 60) min
  //     since last_attempted_at)
  //   · oldest-first (first_attempted_at NULLS FIRST, then created_at)
  const candidates = (await pg`
    select id
      from public.delivery_buffer
     where delivered_at is null
       and attempt_count < ${MANUAL_REVIEW_THRESHOLD}
       and (
         last_attempted_at is null
         or last_attempted_at
            + (least(power(2, attempt_count)::int, 60) * interval '1 minute')
            <= now()
       )
     order by first_attempted_at asc nulls first, created_at asc
     limit ${limit}
  `) as unknown as Array<{ id: string }>

  const outcomes: Record<DeliverOutcome, number> = {
    delivered: 0,
    not_found: 0,
    already_delivered: 0,
    no_export_config: 0,
    unverified_export_config: 0,
    upload_failed: 0,
    decrypt_failed: 0,
    endpoint_failed: 0,
    unknown_event_type: 0,
  }
  let attempted = 0
  let budgetExceeded = false

  for (const { id } of candidates) {
    if (now() - started >= BATCH_TIME_BUDGET_MS) {
      budgetExceeded = true
      break
    }
    attempted += 1
    // One bad row doesn't halt the batch. Unexpected throws (e.g. a
    // transient pg outage) mark the row best-effort; on failure to mark,
    // log-and-move-on.
    try {
      const res = await oneFn(pg, id, deps)
      outcomes[res.outcome] = (outcomes[res.outcome] ?? 0) + 1
    } catch (err) {
      outcomes.upload_failed += 1
      await markFailure(pg, id, `batch_exception: ${errorMessage(err).slice(0, 380)}`)
        .catch(() => {})
    }
  }

  const delivered = outcomes.delivered
  const quarantined =
    outcomes.no_export_config +
    outcomes.unverified_export_config +
    outcomes.decrypt_failed +
    outcomes.endpoint_failed +
    outcomes.upload_failed +
    outcomes.unknown_event_type

  return {
    attempted,
    delivered,
    quarantined,
    budgetExceeded,
    outcomes,
  }
}

interface JoinedRow {
  id: string
  org_id: string
  event_type: string
  payload: unknown
  attempt_count: number
  first_attempted_at: Date | null
  delivered_at: Date | null
  created_at: Date
  ec_id: string | null
  ec_bucket_name: string | null
  ec_path_prefix: string | null
  ec_region: string | null
  ec_storage_provider: string | null
  ec_write_credential_enc: Buffer | null
  ec_is_verified: boolean | null
}

export async function deliverOne(
  pg: Pg,
  rowId: string,
  deps: DeliverDeps = {},
): Promise<DeliverOneResult> {
  const now = deps.now ?? (() => Date.now())
  const doPut = deps.putObject ?? putObjectReal
  const started = now()

  const rows = (await pg`
    select
      db.id,
      db.org_id,
      db.event_type,
      db.payload,
      db.attempt_count,
      db.first_attempted_at,
      db.delivered_at,
      db.created_at,
      ec.id                    as ec_id,
      ec.bucket_name           as ec_bucket_name,
      ec.path_prefix           as ec_path_prefix,
      ec.region                as ec_region,
      ec.storage_provider      as ec_storage_provider,
      ec.write_credential_enc  as ec_write_credential_enc,
      ec.is_verified           as ec_is_verified
    from public.delivery_buffer db
    left join public.export_configurations ec on ec.id = db.export_config_id
    where db.id = ${rowId}
  `) as unknown as JoinedRow[]

  if (rows.length === 0) {
    return { outcome: 'not_found', rowId, durationMs: now() - started }
  }
  const row = rows[0]!

  // Short-circuit: row was already delivered. Trigger + cron may dispatch
  // the same id twice before the DELETE propagates to a replica reader.
  if (row.delivered_at !== null) {
    return {
      outcome: 'already_delivered',
      rowId,
      orgId: row.org_id,
      eventType: row.event_type,
      durationMs: now() - started,
    }
  }

  // Unknown event_type: quarantine WITHOUT incrementing attempt_count so
  // the row remains visible until a producer ADR adds the type (or an
  // operator cleans it up). Does not escalate to manual-review: the fix
  // is "add the type to KNOWN_EVENT_TYPES and redeploy", not "contact
  // the customer".
  if (!KNOWN_EVENT_TYPES.has(row.event_type)) {
    await pg`
      update public.delivery_buffer
         set delivery_error    = ${`unknown_event_type:${row.event_type}`},
             last_attempted_at = now()
       where id = ${rowId}
    `
    return {
      outcome: 'unknown_event_type',
      rowId,
      orgId: row.org_id,
      eventType: row.event_type,
      durationMs: now() - started,
      attempt: row.attempt_count, // not incremented
      error: `unknown_event_type:${row.event_type}`,
    }
  }

  // No export_config reference → fence.
  if (row.ec_id === null || row.ec_write_credential_enc === null) {
    await markFailure(pg, rowId, 'no_export_config')
    return {
      outcome: 'no_export_config',
      rowId,
      orgId: row.org_id,
      eventType: row.event_type,
      durationMs: now() - started,
      attempt: row.attempt_count + 1,
      error: 'no_export_config',
    }
  }

  if (row.ec_is_verified !== true) {
    await markFailure(pg, rowId, 'unverified_export_config')
    return {
      outcome: 'unverified_export_config',
      rowId,
      orgId: row.org_id,
      eventType: row.event_type,
      bucket: row.ec_bucket_name ?? undefined,
      durationMs: now() - started,
      attempt: row.attempt_count + 1,
      error: 'unverified_export_config',
    }
  }

  // Endpoint derivation — throws for unsupported providers.
  let endpoint: string
  try {
    endpoint = endpointForProvider(
      row.ec_storage_provider ?? 'cs_managed_r2',
      row.ec_region,
    )
  } catch (err) {
    const msg = errorMessage(err)
    await markFailure(pg, rowId, msg.slice(0, 400))
    return {
      outcome: 'endpoint_failed',
      rowId,
      orgId: row.org_id,
      eventType: row.event_type,
      bucket: row.ec_bucket_name ?? undefined,
      durationMs: now() - started,
      attempt: row.attempt_count + 1,
      error: msg,
    }
  }

  // Credential decryption.
  let accessKeyId: string
  let secretAccessKey: string
  try {
    const orgKey = await deriveOrgKey(pg, row.org_id)
    const creds = await decryptCredentials(
      pg,
      row.ec_write_credential_enc,
      orgKey,
    )
    accessKeyId = creds.access_key_id
    secretAccessKey = creds.secret_access_key
  } catch (err) {
    const msg = errorMessage(err)
    await markFailure(pg, rowId, `decrypt_failed: ${msg.slice(0, 320)}`)
    return {
      outcome: 'decrypt_failed',
      rowId,
      orgId: row.org_id,
      eventType: row.event_type,
      bucket: row.ec_bucket_name ?? undefined,
      durationMs: now() - started,
      attempt: row.attempt_count + 1,
      error: 'decrypt_failed',
    }
  }

  const body = Buffer.from(canonicalJson(row.payload), 'utf8')
  const objectKey = objectKeyFor(row.ec_path_prefix, row)

  try {
    await doPut({
      endpoint,
      region: row.ec_region ?? 'auto',
      bucket: row.ec_bucket_name!,
      key: objectKey,
      accessKeyId,
      secretAccessKey,
      body,
      contentType: 'application/json; charset=utf-8',
      metadata: {
        'cs-row-id': row.id,
        'cs-org-id': row.org_id,
        'cs-event-type': row.event_type,
        'cs-created-at': toIso(row.created_at),
      },
    })
  } catch (err) {
    const msg = errorMessage(err)
    await markFailure(pg, rowId, msg.slice(0, 400))
    return {
      outcome: 'upload_failed',
      rowId,
      orgId: row.org_id,
      eventType: row.event_type,
      bucket: row.ec_bucket_name ?? undefined,
      objectKey,
      durationMs: now() - started,
      attempt: row.attempt_count + 1,
      error: msg,
    }
  }

  // Confirmed 2xx from R2 — mark delivered + DELETE in one transaction
  // (Rule 2: buffer tables are transient; delete after confirmed delivery).
  await pg.begin(async (tx) => {
    await tx`update public.delivery_buffer set delivered_at = now() where id = ${rowId}`
    await tx`delete from public.delivery_buffer where id = ${rowId}`
  })

  return {
    outcome: 'delivered',
    rowId,
    orgId: row.org_id,
    eventType: row.event_type,
    bucket: row.ec_bucket_name ?? undefined,
    objectKey,
    durationMs: now() - started,
    attempt: row.attempt_count + 1,
  }
}

async function markFailure(pg: Pg, rowId: string, error: string): Promise<void> {
  // UPDATE returns the new attempt_count + org_id + event_type in one
  // round-trip so we can decide escalation without a second SELECT.
  const updated = (await pg`
    update public.delivery_buffer
       set attempt_count      = attempt_count + 1,
           last_attempted_at  = now(),
           first_attempted_at = coalesce(first_attempted_at, now()),
           delivery_error     = ${error}
     where id = ${rowId}
    returning attempt_count, org_id, event_type
  `) as unknown as Array<{
    attempt_count: number
    org_id: string
    event_type: string
  }>

  const row = updated[0]
  if (!row) return

  // Manual-review escalation: exactly once, as the failing attempt lifts
  // attempt_count to the threshold. The batch candidate SELECT already
  // excludes rows at/above the threshold, so subsequent reties won't call
  // markFailure again — but the RPC itself is idempotent per
  // (org_id, event_type) so a duplicate call is still safe.
  if (row.attempt_count === MANUAL_REVIEW_THRESHOLD) {
    await pg`
      update public.delivery_buffer
         set delivery_error = ${'MANUAL_REVIEW: ' + error}
       where id = ${rowId}
    `
    // Best-effort readiness-flag insert. A failure here must not prevent
    // the row from being marked — the MANUAL_REVIEW prefix is the
    // load-bearing signal.
    await pg`
      select admin.record_delivery_retry_exhausted(
        ${rowId}::uuid,
        ${row.org_id}::uuid,
        ${row.event_type},
        ${error}
      )
    `.catch(() => {})
  }
}

function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message
  return String(err)
}

function toIso(d: Date | string): string {
  const x = d instanceof Date ? d : new Date(d)
  return x.toISOString()
}
