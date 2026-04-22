// ADR-1016 Sprint 1.3 — /v1/score lib helper over the cs_api pool.
//
// Reads the single cached DEPA row from depa_compliance_metrics (ADR-0025).
// Returns an envelope with null scores for an org whose nightly cron has
// not yet run — the client never has to special-case a 404.

import { csApi } from './cs-api-client'

export interface DepaScoreEnvelope {
  total_score:      number | null
  coverage_score:   number | null
  expiry_score:     number | null
  freshness_score:  number | null
  revocation_score: number | null
  computed_at:      string | null
  max_score:        20
}

export type ScoreError =
  | { kind: 'api_key_binding'; detail: string }
  | { kind: 'unknown';         detail: string }

function classify(err: { code?: string; message?: string }): ScoreError {
  const msg = err.message ?? ''
  if (
    err.code === '42501' ||
    msg.includes('api_key_') ||
    msg.includes('org_id_missing') ||
    msg.includes('org_not_found')
  ) {
    return { kind: 'api_key_binding', detail: msg }
  }
  return { kind: 'unknown', detail: msg }
}

export async function getDepaScore(params: {
  keyId: string
  orgId: string
}): Promise<{ ok: true; data: DepaScoreEnvelope } | { ok: false; error: ScoreError }> {
  try {
    const sql = csApi()
    const rows = await sql<Array<{ result: DepaScoreEnvelope }>>`
      select rpc_depa_score_self(${params.keyId}::uuid, ${params.orgId}::uuid) as result
    `
    return { ok: true, data: rows[0].result }
  } catch (e) {
    return { ok: false, error: classify(e as { code?: string; message?: string }) }
  }
}
