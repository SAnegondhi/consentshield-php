// ADR-1025 Phase 4 Sprint 4.1 — retention cleanup for post-migration
// CS-managed buckets.
//
// Finds storage_migrations rows where:
//   · state = 'completed'
//   · mode  = 'forward_only'  (copy_existing migrations already emptied
//                              the source; nothing to clean up)
//   · retention_until < now()
//   · retention_processed_at is null
//
// For each, mints a fresh cleanup token (via the cfut_ user token —
// same pattern as the sprint-11 verification script), lists objects in
// the old bucket, deletes every object, revokes the cleanup token, and
// deletes the bucket itself via the CF REST API. Marks the
// storage_migrations row with retention_processed_at on success.
//
// Bounded per invocation (MAX_BUCKETS_PER_RUN) so one bad bucket
// doesn't stall the sweep. The cron runs daily — unprocessed rows
// carry forward.

import { createHmac } from 'node:crypto'
import type postgres from 'postgres'
import {
  createBucketScopedToken,
  revokeBucketToken,
} from './cf-provision'
import {
  deleteObject,
  deriveSigningKey,
  formatAmzDate,
  sha256Hex,
} from './sigv4'

type Pg = ReturnType<typeof postgres>

const MAX_BUCKETS_PER_RUN = 50
const FETCH_TIMEOUT_MS = 30_000
const PROPAGATION_DELAY_MS = 5_000

export interface RetentionSummary {
  processed: number
  failed: number
  failures: Array<{ migration_id: string; bucket: string; error: string }>
}

export interface RetentionDeps {
  createBucketScopedToken?: typeof createBucketScopedToken
  revokeBucketToken?: typeof revokeBucketToken
  deleteObject?: typeof deleteObject
  fetchFn?: typeof fetch
  sleep?: (ms: number) => Promise<void>
  now?: () => number
}

interface MigrationRow {
  id: string
  bucket: string
}

export async function processRetentionCleanup(
  pg: Pg,
  deps: RetentionDeps = {},
): Promise<RetentionSummary> {
  const fns = {
    createBucketScopedToken:
      deps.createBucketScopedToken ?? createBucketScopedToken,
    revokeBucketToken: deps.revokeBucketToken ?? revokeBucketToken,
    deleteObject: deps.deleteObject ?? deleteObject,
    fetchFn: deps.fetchFn ?? fetch,
    sleep: deps.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms))),
    now: deps.now ?? Date.now,
  }

  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID
  const accountToken = process.env.CLOUDFLARE_ACCOUNT_API_TOKEN
  if (!accountId || !accountToken) {
    throw new Error(
      'CLOUDFLARE_ACCOUNT_ID + CLOUDFLARE_ACCOUNT_API_TOKEN must be set',
    )
  }
  const endpoint = `https://${accountId}.r2.cloudflarestorage.com`

  const rows = await pg<
    Array<{ id: string; from_config_snapshot: { bucket: string } }>
  >`
    select id, from_config_snapshot
      from public.storage_migrations
     where state   = 'completed'
       and mode    = 'forward_only'
       and retention_until < now()
       and retention_processed_at is null
     order by retention_until asc
     limit ${MAX_BUCKETS_PER_RUN}
  `

  const summary: RetentionSummary = {
    processed: 0,
    failed: 0,
    failures: [],
  }

  for (const row of rows) {
    const bucket = row.from_config_snapshot?.bucket
    if (!bucket) {
      summary.failed++
      summary.failures.push({
        migration_id: row.id,
        bucket: '(missing)',
        error: 'from_config_snapshot.bucket missing',
      })
      continue
    }

    try {
      await cleanupOneBucket(
        { id: row.id, bucket },
        { accountId, accountToken, endpoint },
        fns,
      )
      await pg`
        update public.storage_migrations
           set retention_processed_at = now(),
               last_activity_at       = now()
         where id = ${row.id}
      `
      summary.processed++
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      summary.failed++
      summary.failures.push({
        migration_id: row.id,
        bucket,
        error: msg,
      })
      // Record the failure on the migration row so operators can see it.
      await pg`
        update public.storage_migrations
           set error_text       = ${'retention_cleanup: ' + msg.slice(0, 1000)},
               last_activity_at = now()
         where id = ${row.id}
      `.catch(() => undefined)
    }
  }

  return summary
}

async function cleanupOneBucket(
  mig: MigrationRow,
  ctx: { accountId: string; accountToken: string; endpoint: string },
  fns: Required<Omit<RetentionDeps, 'now'>> & { now?: () => number },
): Promise<void> {
  // Mint cleanup token.
  const cleanup = await fns.createBucketScopedToken(mig.bucket)
  try {
    await fns.sleep(PROPAGATION_DELAY_MS)
    await emptyBucket(
      mig.bucket,
      ctx.endpoint,
      cleanup.access_key_id,
      cleanup.secret_access_key,
      fns,
    )
  } finally {
    // Always try to revoke the cleanup token, even if emptying failed.
    await fns.revokeBucketToken(cleanup.token_id).catch(() => undefined)
  }
  // Delete the bucket (only succeeds if empty).
  const resp = await fns.fetchFn(
    `https://api.cloudflare.com/client/v4/accounts/${ctx.accountId}/r2/buckets/${mig.bucket}`,
    {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${ctx.accountToken}` },
    },
  )
  if (![200, 204, 404].includes(resp.status)) {
    throw new Error(
      `bucket delete failed: HTTP ${resp.status} — ${(await resp.text()).slice(0, 300)}`,
    )
  }
}

async function emptyBucket(
  bucketName: string,
  endpoint: string,
  accessKeyId: string,
  secretAccessKey: string,
  fns: Required<Omit<RetentionDeps, 'now'>> & { now?: () => number },
): Promise<void> {
  let continuationToken: string | undefined
  for (let page = 0; page < 1000; page++) {
    const result = await listObjects(
      bucketName,
      endpoint,
      accessKeyId,
      secretAccessKey,
      continuationToken,
      fns.fetchFn,
    )
    for (const key of result.keys) {
      await fns.deleteObject({
        endpoint,
        region: 'auto',
        bucket: bucketName,
        key,
        accessKeyId,
        secretAccessKey,
      })
    }
    if (!result.isTruncated || !result.nextToken) break
    continuationToken = result.nextToken
  }
}

async function listObjects(
  bucketName: string,
  endpoint: string,
  accessKeyId: string,
  secretAccessKey: string,
  continuationToken: string | undefined,
  fetchFn: typeof fetch,
): Promise<{ keys: string[]; isTruncated: boolean; nextToken?: string }> {
  const host = new URL(endpoint).host
  const region = 'auto'
  const amzDate = formatAmzDate(new Date())
  const dateStamp = amzDate.slice(0, 8)
  const credScope = `${dateStamp}/${region}/s3/aws4_request`
  const q: [string, string][] = [
    ['list-type', '2'],
    ['max-keys', '1000'],
  ]
  if (continuationToken) q.push(['continuation-token', continuationToken])
  const canonicalQuery = q
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(
      ([k, v]) =>
        `${encodeURIComponent(k)}=${encodeURIComponent(v).replace(/\*/g, '%2A')}`,
    )
    .join('&')
  const canonicalUri = '/' + bucketName + '/'
  const canonicalHeaders =
    `host:${host}\nx-amz-content-sha256:UNSIGNED-PAYLOAD\nx-amz-date:${amzDate}\n`
  const signedHeaders = 'host;x-amz-content-sha256;x-amz-date'
  const crStr = [
    'GET',
    canonicalUri,
    canonicalQuery,
    canonicalHeaders,
    signedHeaders,
    'UNSIGNED-PAYLOAD',
  ].join('\n')
  const stringToSign = [
    'AWS4-HMAC-SHA256',
    amzDate,
    credScope,
    sha256Hex(crStr),
  ].join('\n')
  const signingKey = deriveSigningKey(secretAccessKey, dateStamp, region)
  const sig = createHmac('sha256', signingKey).update(stringToSign).digest('hex')
  const auth = `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${credScope}, SignedHeaders=${signedHeaders}, Signature=${sig}`
  const ac = new AbortController()
  const timer = setTimeout(() => ac.abort(), FETCH_TIMEOUT_MS)
  try {
    const resp = await fetchFn(`${endpoint}${canonicalUri}?${canonicalQuery}`, {
      method: 'GET',
      headers: {
        Authorization: auth,
        Host: host,
        'X-Amz-Content-Sha256': 'UNSIGNED-PAYLOAD',
        'X-Amz-Date': amzDate,
      },
      signal: ac.signal,
    })
    if (!resp.ok) {
      throw new Error(
        `ListObjectsV2 ${resp.status} — ${(await resp.text()).slice(0, 300)}`,
      )
    }
    const xml = await resp.text()
    const keys = Array.from(xml.matchAll(/<Key>([^<]+)<\/Key>/g)).map((m) => m[1])
    const isTruncated = /<IsTruncated>true<\/IsTruncated>/.test(xml)
    const nextMatch = xml.match(
      /<NextContinuationToken>([^<]+)<\/NextContinuationToken>/,
    )
    return { keys, isTruncated, nextToken: nextMatch?.[1] }
  } finally {
    clearTimeout(timer)
  }
}
