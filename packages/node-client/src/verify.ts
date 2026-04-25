// ADR-1006 Phase 1 Sprint 1.2 — verify + verifyBatch.
//
// Compliance-load-bearing module. Every code path here either honours the
// fail-CLOSED default (throw `ConsentVerifyError`) OR honours the explicit
// fail-OPEN opt-in (return `OpenFailureEnvelope`); 4xx ALWAYS throws
// regardless of the failOpen flag (a caller bug must never silently
// fall through as "consent unverified — assumed granted").

import {
  ConsentShieldApiError,
  ConsentShieldError,
  ConsentShieldNetworkError,
  ConsentShieldTimeoutError,
  ConsentVerifyError,
} from './errors'
import type { HttpClient } from './http'
import type {
  IdentifierType,
  OpenFailureEnvelope,
  VerifyBatchEnvelope,
  VerifyEnvelope,
} from './types'

/** Single-identifier verify input. camelCase per JS/TS convention. */
export interface VerifyInput {
  propertyId: string
  /** The data principal's identifier value (email / phone / PAN / aadhaar / custom). */
  dataPrincipalIdentifier: string
  identifierType: IdentifierType | string
  purposeCode: string
  /** Optional caller-supplied trace id; round-trips via X-CS-Trace-Id. */
  traceId?: string
  /** Optional caller-supplied AbortSignal; composed with the SDK's per-request timeout. */
  signal?: AbortSignal
}

/** Batch verify input. `identifiers` MUST be 1..10000 entries. */
export interface VerifyBatchInput {
  propertyId: string
  /** Same identifier_type for every entry — batch is over a homogeneous list. */
  identifierType: IdentifierType | string
  purposeCode: string
  /** Non-empty array of identifier values; cap is 10000 per request. */
  identifiers: string[]
  traceId?: string
  signal?: AbortSignal
}

const VERIFY_PATH = '/consent/verify'
const VERIFY_BATCH_PATH = '/consent/verify/batch'

const MAX_BATCH_IDENTIFIERS = 10_000

/**
 * Map a failed `request()` result into the right outcome — throw
 * `ConsentVerifyError` (fail-closed default) or return `OpenFailureEnvelope`
 * (fail-open opt-in). 4xx ALWAYS throws regardless of failOpen.
 *
 * Returns `null` when the error is NOT verify-eligible-for-open (4xx) so
 * the caller can re-throw the original error. Returns a value otherwise.
 */
function decideFailureOutcome(
  err: unknown,
  failOpen: boolean,
): { open: OpenFailureEnvelope } | { rethrow: ConsentShieldError } {
  // Native Error / unknown — wrap once to preserve the SDK contract.
  let normalised: ConsentShieldError
  if (err instanceof ConsentShieldError) {
    normalised = err
  } else if (err instanceof Error) {
    normalised = new ConsentShieldNetworkError(err.message, err)
  } else {
    normalised = new ConsentShieldNetworkError(String(err), err)
  }

  // 4xx → caller bug or auth/scope/validation issue. Never "open" through
  // this path — the customer would silently miss real errors.
  if (
    normalised instanceof ConsentShieldApiError &&
    normalised.status >= 400 &&
    normalised.status < 500
  ) {
    return { rethrow: normalised }
  }

  if (failOpen) {
    let cause: OpenFailureEnvelope['cause']
    if (normalised instanceof ConsentShieldTimeoutError) cause = 'timeout'
    else if (normalised instanceof ConsentShieldApiError) cause = 'server_error'
    else cause = 'network'

    return {
      open: {
        status: 'open_failure',
        reason: normalised.message,
        cause,
        traceId: normalised.traceId,
      },
    }
  }

  // Fail-closed (the default). Wrap in ConsentVerifyError so callers can
  // catch the load-bearing class without losing the underlying cause.
  return { rethrow: new ConsentVerifyError(normalised) }
}

/**
 * GET /v1/consent/verify — single-identifier check.
 *
 * Returns the §5.1 envelope on success. On any failure:
 *   - 4xx (caller bug / scope / 404 property / 422 validation): always
 *     throws `ConsentShieldApiError` — `failOpen` is ignored.
 *   - timeout / network / 5xx + `failOpen=false` (default): throws
 *     `ConsentVerifyError` wrapping the cause.
 *   - timeout / network / 5xx + `failOpen=true`: returns
 *     `OpenFailureEnvelope` so the caller can record the override
 *     deliberately rather than silently default-granting.
 */
export async function verify(
  http: HttpClient,
  input: VerifyInput,
  failOpen: boolean,
): Promise<VerifyEnvelope | OpenFailureEnvelope> {
  validateRequired(input.propertyId, 'propertyId')
  validateRequired(input.dataPrincipalIdentifier, 'dataPrincipalIdentifier')
  validateRequired(input.identifierType, 'identifierType')
  validateRequired(input.purposeCode, 'purposeCode')

  try {
    const resp = await http.request<VerifyEnvelope>({
      method: 'GET',
      path: VERIFY_PATH,
      query: {
        property_id: input.propertyId,
        data_principal_identifier: input.dataPrincipalIdentifier,
        identifier_type: input.identifierType,
        purpose_code: input.purposeCode,
      },
      signal: input.signal,
      traceId: input.traceId,
    })
    return resp.body
  } catch (err) {
    const outcome = decideFailureOutcome(err, failOpen)
    if ('rethrow' in outcome) throw outcome.rethrow
    return outcome.open
  }
}

/**
 * POST /v1/consent/verify/batch — multi-identifier check.
 *
 * Client-side validation BEFORE any network call:
 *   - empty `identifiers` array → throws `RangeError` synchronously.
 *   - more than 10 000 entries → throws `RangeError` synchronously
 *     (server caps at 10 000 with HTTP 413; the client-side throw
 *     saves the round-trip and matches the cap exactly).
 *   - non-string entries → throws `TypeError` synchronously.
 *
 * Same fail-closed/open behaviour as `verify`.
 */
export async function verifyBatch(
  http: HttpClient,
  input: VerifyBatchInput,
  failOpen: boolean,
): Promise<VerifyBatchEnvelope | OpenFailureEnvelope> {
  validateRequired(input.propertyId, 'propertyId')
  validateRequired(input.identifierType, 'identifierType')
  validateRequired(input.purposeCode, 'purposeCode')
  if (!Array.isArray(input.identifiers)) {
    throw new TypeError('@consentshield/node: verifyBatch input.identifiers must be an array')
  }
  if (input.identifiers.length === 0) {
    throw new RangeError('@consentshield/node: verifyBatch input.identifiers must be non-empty')
  }
  if (input.identifiers.length > MAX_BATCH_IDENTIFIERS) {
    throw new RangeError(
      `@consentshield/node: verifyBatch input.identifiers length ${input.identifiers.length} exceeds limit ${MAX_BATCH_IDENTIFIERS}`,
    )
  }
  for (let i = 0; i < input.identifiers.length; i++) {
    const id = input.identifiers[i]
    if (typeof id !== 'string' || id.length === 0) {
      throw new TypeError(
        `@consentshield/node: verifyBatch input.identifiers[${i}] must be a non-empty string`,
      )
    }
  }

  try {
    const resp = await http.request<VerifyBatchEnvelope>({
      method: 'POST',
      path: VERIFY_BATCH_PATH,
      body: {
        property_id: input.propertyId,
        identifier_type: input.identifierType,
        purpose_code: input.purposeCode,
        identifiers: input.identifiers,
      },
      signal: input.signal,
      traceId: input.traceId,
    })
    return resp.body
  } catch (err) {
    const outcome = decideFailureOutcome(err, failOpen)
    if ('rethrow' in outcome) throw outcome.rethrow
    return outcome.open
  }
}

/**
 * Type guard for the open-failure shape so callers can branch
 * ergonomically without a `status === 'open_failure'` string check.
 */
export function isOpenFailure(
  result: VerifyEnvelope | VerifyBatchEnvelope | OpenFailureEnvelope,
): result is OpenFailureEnvelope {
  return (result as { status?: string }).status === 'open_failure'
}

function validateRequired(value: unknown, name: string): void {
  if (typeof value !== 'string' || value.length === 0) {
    throw new TypeError(`@consentshield/node: ${name} is required and must be a non-empty string`)
  }
}
