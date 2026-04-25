// ADR-1006 Phase 1 Sprint 1.2 — wire-format types for the v1 API.
//
// Mirrors `app/src/lib/consent/verify.ts` exactly so the SDK contract
// stays in lockstep with the server. snake_case fields are intentional —
// they're the actual JSON the server emits.
//
// Where the SDK exposes a higher-level method API, it accepts camelCase
// inputs (the JS/TS convention) and translates to snake_case at the
// network boundary; the response shapes stay snake_case so callers can
// pipe them straight into logging / audit storage without any rename.

/**
 * §5.1 verify-result statuses. Stable contract — adding a value is a
 * minor-version bump in `@consentshield/node`.
 */
export type VerifyStatus = 'granted' | 'revoked' | 'expired' | 'never_consented'

/**
 * Identifier classes accepted by `data_principal_identifier`. The server
 * may accept additional `custom` identifier sub-types via the
 * `custom_identifier_type` field on the artefact; from the SDK's
 * perspective only these five literal classes flow through.
 */
export type IdentifierType = 'email' | 'phone' | 'pan' | 'aadhaar' | 'custom'

/** Single-identifier verify response (HTTP 200). */
export interface VerifyEnvelope {
  property_id: string
  identifier_type: string
  purpose_code: string
  status: VerifyStatus
  active_artefact_id: string | null
  revoked_at: string | null
  revocation_record_id: string | null
  expires_at: string | null
  /** ISO 8601 UTC timestamp the server stamped at verify-time. */
  evaluated_at: string
}

/** One row of the batch verify response, in input order. */
export interface VerifyBatchResultRow {
  identifier: string
  status: VerifyStatus
  active_artefact_id: string | null
  revoked_at: string | null
  revocation_record_id: string | null
  expires_at: string | null
}

/** Batch verify response (HTTP 200). `results` preserves input order. */
export interface VerifyBatchEnvelope {
  property_id: string
  identifier_type: string
  purpose_code: string
  evaluated_at: string
  results: VerifyBatchResultRow[]
}

/**
 * Fail-open shape returned by `verify` / `verifyBatch` when:
 *   (a) the SDK is in fail-open mode (`failOpen: true` or
 *       `CONSENT_VERIFY_FAIL_OPEN=true`), AND
 *   (b) the verify request failed for an OPEN-eligible reason
 *       (timeout / network / 5xx — NEVER 4xx, which always throws).
 *
 * The compliance contract: when this shape surfaces, the calling code
 * MUST log it to the customer's audit trail (Sprint 1.3 wires the
 * automatic POST to /v1/audit; Sprint 1.2 ships the shape only).
 */
export interface OpenFailureEnvelope {
  status: 'open_failure'
  /** Free-form reason string suitable for audit-log inclusion. */
  reason: string
  /** The cause class name (`ConsentShieldTimeoutError` etc.) for downstream filtering. */
  cause: 'timeout' | 'network' | 'server_error'
  /** Trace id from the failed-request response header, when present. */
  traceId?: string
}
