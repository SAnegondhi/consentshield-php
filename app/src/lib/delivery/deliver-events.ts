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
  await pg`
    update public.delivery_buffer
       set attempt_count      = attempt_count + 1,
           last_attempted_at  = now(),
           first_attempted_at = coalesce(first_attempted_at, now()),
           delivery_error     = ${error}
     where id = ${rowId}
  `
}

function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message
  return String(err)
}

function toIso(d: Date | string): string {
  const x = d instanceof Date ? d : new Date(d)
  return x.toISOString()
}
