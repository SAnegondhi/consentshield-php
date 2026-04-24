// ADR-1025 Phase 4 Sprint 4.1 — credential rotation for CS-managed buckets.
//
// Mints a fresh bucket-scoped R2 token for the existing bucket, runs the
// verification probe with the new credentials, atomically swaps them
// into write_credential_enc, and revokes the old token. Only valid for
// storage_provider='cs_managed_r2' — BYOK rotation is the customer's
// responsibility (rotate their own token; ConsentShield only manages
// its own tokens).
//
// Audit note: the old and new token IDs both pass through process
// memory, but only the new token-id ends up persisted (encrypted). The
// old token-id leaves scope as soon as revokeBucketToken returns.

import type postgres from 'postgres'
import {
  createBucketScopedToken,
  revokeBucketToken,
  r2Endpoint,
} from './cf-provision'
import {
  decryptCredentials,
  deriveOrgKey,
  encryptCredentials,
} from './org-crypto'
import { runVerificationProbe } from './verify'

type Pg = ReturnType<typeof postgres>

const PROPAGATION_DELAY_MS = 5_000

export type RotateStatus =
  | 'rotated'
  | 'not_eligible'
  | 'not_found'
  | 'failed'

export interface RotateResult {
  status: RotateStatus
  old_token_id?: string
  new_token_id?: string
  error?: string
}

export interface RotateDeps {
  createBucketScopedToken?: typeof createBucketScopedToken
  revokeBucketToken?: typeof revokeBucketToken
  runVerificationProbe?: typeof runVerificationProbe
  r2Endpoint?: typeof r2Endpoint
  sleep?: (ms: number) => Promise<void>
}

interface ConfigRow {
  id: string
  org_id: string
  storage_provider: string
  bucket_name: string
  region: string | null
  write_credential_enc: Buffer
}

export async function rotateStorageCredentials(
  pg: Pg,
  orgId: string,
  deps: RotateDeps = {},
): Promise<RotateResult> {
  const fns = {
    createBucketScopedToken: deps.createBucketScopedToken ?? createBucketScopedToken,
    revokeBucketToken: deps.revokeBucketToken ?? revokeBucketToken,
    runVerificationProbe: deps.runVerificationProbe ?? runVerificationProbe,
    r2Endpoint: deps.r2Endpoint ?? r2Endpoint,
    sleep: deps.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms))),
  }

  const rows = await pg<ConfigRow[]>`
    select id, org_id, storage_provider, bucket_name, region, write_credential_enc
      from public.export_configurations
     where org_id = ${orgId}
     limit 1
  `
  if (!rows.length) return { status: 'not_found' }
  const cfg = rows[0]
  if (cfg.storage_provider !== 'cs_managed_r2') {
    return { status: 'not_eligible' }
  }

  const derivedKey = await deriveOrgKey(pg, orgId)
  const oldCreds = await decryptCredentials(
    pg,
    cfg.write_credential_enc,
    derivedKey,
  )
  const oldTokenId = oldCreds.token_id

  // Mint fresh token for the same bucket.
  const fresh = await fns.createBucketScopedToken(cfg.bucket_name)

  // Wait for CF edge propagation before probing.
  await fns.sleep(PROPAGATION_DELAY_MS)

  try {
    const probe = await fns.runVerificationProbe({
      provider: 'cs_managed_r2',
      endpoint: fns.r2Endpoint(),
      region: cfg.region ?? 'auto',
      bucket: cfg.bucket_name,
      accessKeyId: fresh.access_key_id,
      secretAccessKey: fresh.secret_access_key,
    })
    if (!probe.ok) {
      // New creds are broken — revoke them, leave the old creds in
      // place, surface failure to the operator.
      await fns.revokeBucketToken(fresh.token_id).catch(() => undefined)
      await recordRotationError(
        pg,
        cfg.id,
        `probe failed at ${probe.failedStep}: ${probe.error}`,
      )
      return {
        status: 'failed',
        error: `probe failed at ${probe.failedStep}: ${probe.error}`,
      }
    }

    // Probe passed — encrypt + atomically swap + record success. The
    // old token gets revoked AFTER the swap so a race between the
    // delivery pipeline reading the old creds and this swap is
    // resolved by keeping the old token valid until the swap lands.
    const newEnc = await encryptCredentials(pg, fresh, derivedKey)

    await pg`
      update public.export_configurations
         set write_credential_enc = ${newEnc},
             is_verified          = true,
             last_rotation_at     = now(),
             last_rotation_error  = null,
             updated_at           = now()
       where id = ${cfg.id}
    `

    // Revoke old token (best-effort). A lingering old token is
    // harmless (CF revokes via API; propagates within seconds) and
    // the CS-managed account isn't billed per-token.
    if (oldTokenId) {
      await fns.revokeBucketToken(oldTokenId).catch(() => undefined)
    }

    return {
      status: 'rotated',
      old_token_id: oldTokenId,
      new_token_id: fresh.token_id,
    }
  } catch (err) {
    // Something blew up between mint and swap. Try to clean up the
    // freshly-minted token so we don't leak it into CF's dashboard.
    await fns.revokeBucketToken(fresh.token_id).catch(() => undefined)
    const msg = err instanceof Error ? err.message : String(err)
    await recordRotationError(pg, cfg.id, msg)
    return { status: 'failed', error: msg }
  }
}

async function recordRotationError(
  pg: Pg,
  configId: string,
  errorText: string,
): Promise<void> {
  try {
    await pg`
      update public.export_configurations
         set last_rotation_at    = now(),
             last_rotation_error = ${errorText.slice(0, 2000)},
             updated_at          = now()
       where id = ${configId}
    `
  } catch {
    /* best-effort */
  }
}
