// ADR-1012 Sprint 1.1 — /v1/keys/self and /v1/usage helpers over the cs_api pool.

import { csApi } from './cs-api-client'

// ── /v1/keys/self ────────────────────────────────────────────────────────────

export interface KeySelfEnvelope {
  key_id:          string
  account_id:      string
  org_id:          string | null
  name:            string
  key_prefix:      string
  scopes:          string[]
  rate_tier:       string
  created_at:      string
  last_rotated_at: string | null
  expires_at:      string | null
  revoked_at:      string | null
}

export type KeySelfError =
  | { kind: 'api_key_not_found' }
  | { kind: 'unknown'; detail: string }

export async function keySelf(params: {
  keyId: string
}): Promise<{ ok: true; data: KeySelfEnvelope } | { ok: false; error: KeySelfError }> {
  try {
    const sql = csApi()
    const rows = await sql<Array<{ result: KeySelfEnvelope }>>`
      select rpc_api_key_self(${params.keyId}::uuid) as result
    `
    return { ok: true, data: rows[0].result }
  } catch (e) {
    const err = e as { code?: string; message?: string }
    const msg = err.message ?? ''
    if (msg.includes('api_key_not_found')) return { ok: false, error: { kind: 'api_key_not_found' } }
    return { ok: false, error: { kind: 'unknown', detail: msg } }
  }
}

// ── /v1/usage ────────────────────────────────────────────────────────────────

export interface UsageDayRow {
  day:           string
  request_count: number
  p50_ms:        number
  p95_ms:        number
}

export interface UsageEnvelope {
  key_id: string
  days:   number
  series: UsageDayRow[]
}

export type UsageError = { kind: 'unknown'; detail: string }

export async function keyUsageSelf(params: {
  keyId: string
  days?: number
}): Promise<{ ok: true; data: UsageEnvelope } | { ok: false; error: UsageError }> {
  try {
    const sql = csApi()
    const days = params.days ?? 7
    // The RPC returns a table; postgres.js yields each row as an object.
    const rows = await sql<Array<{
      day: string | Date
      request_count: bigint | number
      p50_ms: string | number
      p95_ms: string | number
    }>>`
      select * from rpc_api_key_usage_self(${params.keyId}::uuid, ${days}::int)
    `
    const series: UsageDayRow[] = rows.map((r) => ({
      day:           r.day instanceof Date ? r.day.toISOString().slice(0, 10) : String(r.day),
      request_count: Number(r.request_count),
      p50_ms:        Number(r.p50_ms),
      p95_ms:        Number(r.p95_ms),
    }))
    return { ok: true, data: { key_id: params.keyId, days, series } }
  } catch (e) {
    const err = e as { message?: string }
    return { ok: false, error: { kind: 'unknown', detail: err.message ?? '' } }
  }
}
