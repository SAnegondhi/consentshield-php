// ADR-1025 Phase 4 Sprint 4.1 — shared per-org cryptographic helpers.
//
// Narrow utility module used by the storage orchestrators
// (provision, migrate, rotate, retention) when they need to derive
// the per-org HMAC key and round-trip credentials through pgcrypto
// via the cs_orchestrator direct-Postgres client.
//
// Matches @consentshield/encryption.deriveOrgKey byte-for-byte so
// ciphertext written through here round-trips through decryptForOrg
// on the read path.
//
// Rule 11: the derived key + decrypted credentials stay in narrow
// local scopes; never logged.

import { createHmac } from 'node:crypto'
import type postgres from 'postgres'

type Pg = ReturnType<typeof postgres>

export interface StorageCredentials {
  access_key_id: string
  secret_access_key: string
  token_id?: string
}

/**
 * Derive the per-org HMAC key. Needs MASTER_ENCRYPTION_KEY in env plus
 * the organisations.encryption_salt row.
 */
export async function deriveOrgKey(pg: Pg, orgId: string): Promise<string> {
  const masterKey = process.env.MASTER_ENCRYPTION_KEY
  if (!masterKey) throw new Error('MASTER_ENCRYPTION_KEY must be set')
  const rows = await pg<{ encryption_salt: string }[]>`
    select encryption_salt from public.organisations
     where id = ${orgId} limit 1
  `
  if (!rows.length || !rows[0].encryption_salt) {
    throw new Error(`Org ${orgId} missing encryption_salt`)
  }
  return createHmac('sha256', masterKey)
    .update(`${orgId}${rows[0].encryption_salt}`)
    .digest('hex')
}

/**
 * Decrypt a bytea credential blob. Expects the JSON shape written by
 * encryptCredentials — `{access_key_id, secret_access_key, token_id?}`.
 */
export async function decryptCredentials(
  pg: Pg,
  encrypted: Buffer,
  derivedKey: string,
): Promise<StorageCredentials> {
  const rows = await pg<{ decrypt_secret: string }[]>`
    select public.decrypt_secret(${encrypted}, ${derivedKey})
  `
  if (!rows.length || !rows[0].decrypt_secret) {
    throw new Error('decrypt_secret returned empty')
  }
  const parsed = JSON.parse(rows[0].decrypt_secret) as StorageCredentials
  if (!parsed.access_key_id || !parsed.secret_access_key) {
    throw new Error('decrypted credentials malformed')
  }
  return parsed
}

/**
 * Encrypt a credential blob via the pgcrypto `encrypt_secret` RPC.
 * Returns a Buffer ready for the bytea column.
 */
export async function encryptCredentials(
  pg: Pg,
  creds: StorageCredentials,
  derivedKey: string,
): Promise<Buffer> {
  const plaintext = JSON.stringify(creds)
  const rows = await pg<{ encrypt_secret: Buffer | string }[]>`
    select public.encrypt_secret(${plaintext}, ${derivedKey})
  `
  if (!rows.length) throw new Error('encrypt_secret returned no rows')
  return normaliseBytea(rows[0].encrypt_secret)
}

/**
 * pg returns bytea as `\x<hex>` string or as Buffer depending on driver
 * settings. Coerce to Buffer so downstream INSERTs bind correctly.
 */
export function normaliseBytea(v: Buffer | string): Buffer {
  if (Buffer.isBuffer(v)) return v
  const hex = v.startsWith('\\x') ? v.slice(2) : v
  return Buffer.from(hex, 'hex')
}
