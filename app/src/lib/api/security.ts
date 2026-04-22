// ADR-1016 Sprint 1.2 — /v1/security/scans lib helper over the cs_api pool.

import { csApi } from './cs-api-client'

export type SecuritySeverity = 'critical' | 'high' | 'medium' | 'low' | 'info'

export interface SecurityScanItem {
  id:          string
  property_id: string
  scan_type:   string
  severity:    SecuritySeverity
  signal_key:  string
  details:     unknown
  remediation: string | null
  scanned_at:  string
  created_at:  string
}

export interface SecurityScanEnvelope {
  items:       SecurityScanItem[]
  next_cursor: string | null
}

export interface ListSecurityScansInput {
  keyId:          string
  orgId:          string
  propertyId?:    string
  severity?:      SecuritySeverity
  signalKey?:     string
  scannedAfter?:  string
  scannedBefore?: string
  cursor?:        string
  limit?:         number
}

export type SecurityError =
  | { kind: 'api_key_binding';  detail: string }
  | { kind: 'invalid_severity'; detail: string }
  | { kind: 'bad_cursor';       detail: string }
  | { kind: 'unknown';          detail: string }

function classify(err: { code?: string; message?: string }): SecurityError {
  const msg = err.message ?? ''
  if (
    err.code === '42501' ||
    msg.includes('api_key_') ||
    msg.includes('org_id_missing') ||
    msg.includes('org_not_found')
  ) {
    return { kind: 'api_key_binding', detail: msg }
  }
  if (msg.includes('invalid_severity')) return { kind: 'invalid_severity', detail: msg }
  if (msg.includes('bad_cursor'))        return { kind: 'bad_cursor',       detail: msg }
  return { kind: 'unknown', detail: msg }
}

export async function listSecurityScans(
  input: ListSecurityScansInput,
): Promise<{ ok: true; data: SecurityScanEnvelope } | { ok: false; error: SecurityError }> {
  try {
    const sql = csApi()
    const rows = await sql<Array<{ result: SecurityScanEnvelope }>>`
      select rpc_security_scans_list(
        ${input.keyId}::uuid,
        ${input.orgId}::uuid,
        ${input.propertyId ?? null}::uuid,
        ${input.severity ?? null}::text,
        ${input.signalKey ?? null}::text,
        ${input.scannedAfter ?? null}::timestamptz,
        ${input.scannedBefore ?? null}::timestamptz,
        ${input.cursor ?? null}::text,
        ${input.limit ?? 50}::int
      ) as result
    `
    return { ok: true, data: rows[0].result }
  } catch (e) {
    return { ok: false, error: classify(e as { code?: string; message?: string }) }
  }
}
