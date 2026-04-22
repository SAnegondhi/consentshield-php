// ADR-1016 Sprint 1.1 — /v1/audit lib helper over the cs_api pool.

import { csApi } from './cs-api-client'

export interface AuditLogItem {
  id:          string
  actor_id:    string | null
  actor_email: string | null
  event_type:  string
  entity_type: string | null
  entity_id:   string | null
  payload:     unknown
  created_at:  string
}

export interface AuditLogEnvelope {
  items:       AuditLogItem[]
  next_cursor: string | null
}

export interface ListAuditInput {
  keyId:          string
  orgId:          string
  eventType?:     string
  entityType?:    string
  createdAfter?:  string
  createdBefore?: string
  cursor?:        string
  limit?:         number
}

export type AuditError =
  | { kind: 'api_key_binding'; detail: string }
  | { kind: 'bad_cursor';      detail: string }
  | { kind: 'unknown';         detail: string }

function classify(err: { code?: string; message?: string }): AuditError {
  const msg = err.message ?? ''
  if (
    err.code === '42501' ||
    msg.includes('api_key_') ||
    msg.includes('org_id_missing') ||
    msg.includes('org_not_found')
  ) {
    return { kind: 'api_key_binding', detail: msg }
  }
  if (msg.includes('bad_cursor')) return { kind: 'bad_cursor', detail: msg }
  return { kind: 'unknown', detail: msg }
}

export async function listAuditLog(
  input: ListAuditInput,
): Promise<{ ok: true; data: AuditLogEnvelope } | { ok: false; error: AuditError }> {
  try {
    const sql = csApi()
    const rows = await sql<Array<{ result: AuditLogEnvelope }>>`
      select rpc_audit_log_list(
        ${input.keyId}::uuid,
        ${input.orgId}::uuid,
        ${input.eventType ?? null}::text,
        ${input.entityType ?? null}::text,
        ${input.createdAfter ?? null}::timestamptz,
        ${input.createdBefore ?? null}::timestamptz,
        ${input.cursor ?? null}::text,
        ${input.limit ?? 50}::int
      ) as result
    `
    return { ok: true, data: rows[0].result }
  } catch (e) {
    return { ok: false, error: classify(e as { code?: string; message?: string }) }
  }
}
