// ADR-1006 Phase 1 Sprint 1.1 — ConsentShieldClient class.
//
// Public surface kicked off in Sprint 1.1 (constructor + auth + transport).
// Per-endpoint methods land in Sprint 1.2 (verify, verifyBatch),
// Sprint 1.3 (record, revoke, deletion, artefact CRUD), and Sprint 1.4
// (publication + integration examples).

import { HttpClient, type FetchImpl } from './http'

/**
 * Configuration for a `ConsentShieldClient` instance.
 *
 * Defaults are tuned for the v2 whitepaper §5.4 compliance posture: a
 * 2-second per-request timeout (so a slow ConsentShield never blocks
 * the customer's hot path past the consent-decision budget), and
 * fail-CLOSED behaviour on `verify` failure (so a network blip never
 * lets withdrawn consent silently fall through).
 */
export interface ConsentShieldClientOptions {
  /** Bearer key issued via the admin console. MUST start with `cs_live_`. */
  apiKey: string
  /** API origin. Default: `https://app.consentshield.in`. No trailing /v1 — added internally. */
  baseUrl?: string
  /** Per-request timeout in ms. Default: 2 000. Compliance posture — do NOT raise above 5 000 without an audit-trail rationale. */
  timeoutMs?: number
  /** Retry attempts on 5xx + transport error. Default: 3. Set 0 to disable retries entirely. */
  maxRetries?: number
  /**
   * Compliance switch — Sprint 1.2 wires this through. When `false` (the
   * SDK default), a `verify` call that times out / 5xx-fails / transport-
   * fails throws `ConsentVerifyError` and the calling code MUST treat
   * the data principal as "consent NOT verified". When `true`, the SDK
   * returns a `{ status: 'open_failure', reason }` shape and writes an
   * audit record via `/v1/audit`. Equivalent to setting
   * `CONSENT_VERIFY_FAIL_OPEN=true` in the environment.
   */
  failOpen?: boolean
  /** Override for testing — defaults to global fetch. */
  fetchImpl?: FetchImpl
  /** Override for testing — defaults to setTimeout. */
  sleepImpl?: (ms: number) => Promise<void>
}

const API_KEY_PREFIX = 'cs_live_'
const DEFAULT_BASE_URL = 'https://app.consentshield.in'
const DEFAULT_TIMEOUT_MS = 2_000
const DEFAULT_MAX_RETRIES = 3

const ENV_FAIL_OPEN = 'CONSENT_VERIFY_FAIL_OPEN'

function readEnvFailOpen(): boolean {
  const raw = (globalThis as { process?: { env?: Record<string, string | undefined> } })
    .process?.env?.[ENV_FAIL_OPEN]
  return raw === 'true' || raw === '1'
}

/**
 * Top-level entry point for the ConsentShield Node SDK.
 *
 * @example
 * ```ts
 * import { ConsentShieldClient } from '@consentshield/node'
 *
 * const client = new ConsentShieldClient({ apiKey: process.env.CS_API_KEY! })
 *
 * // Sprint 1.2 (planned):
 * // const ok = await client.verify({ propertyId, dataPrincipalIdentifier, purposeCode })
 * ```
 */
export class ConsentShieldClient {
  /** @internal — exposed for SDK-internal method modules in Sprint 1.2+. */
  readonly http: HttpClient

  /** Final resolved baseUrl after defaults + trim. Useful for test assertions. */
  readonly baseUrl: string

  /** Resolved timeoutMs (default 2 000). Read-only after construction. */
  readonly timeoutMs: number

  /** Resolved maxRetries (default 3). Read-only after construction. */
  readonly maxRetries: number

  /** Resolved failOpen flag — env var honoured when option is undefined. */
  readonly failOpen: boolean

  constructor(opts: ConsentShieldClientOptions) {
    if (!opts || typeof opts !== 'object') {
      throw new TypeError(
        '@consentshield/node: ConsentShieldClient requires an options object',
      )
    }
    if (typeof opts.apiKey !== 'string' || !opts.apiKey.startsWith(API_KEY_PREFIX)) {
      throw new TypeError(
        '@consentshield/node: apiKey must be a string starting with "cs_live_". ' +
          'Issue keys via the admin console; never hard-code keys in source.',
      )
    }
    if (opts.timeoutMs !== undefined && (!Number.isFinite(opts.timeoutMs) || opts.timeoutMs <= 0)) {
      throw new TypeError(
        '@consentshield/node: timeoutMs must be a positive finite number',
      )
    }
    if (
      opts.maxRetries !== undefined &&
      (!Number.isInteger(opts.maxRetries) || opts.maxRetries < 0)
    ) {
      throw new TypeError(
        '@consentshield/node: maxRetries must be a non-negative integer',
      )
    }

    this.baseUrl = (opts.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, '')
    this.timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS
    this.maxRetries = opts.maxRetries ?? DEFAULT_MAX_RETRIES
    this.failOpen = opts.failOpen ?? readEnvFailOpen()

    this.http = new HttpClient({
      baseUrl: this.baseUrl,
      apiKey: opts.apiKey,
      timeoutMs: this.timeoutMs,
      maxRetries: this.maxRetries,
      fetchImpl: opts.fetchImpl,
      sleepImpl: opts.sleepImpl,
    })
  }

  /**
   * Liveness probe. Returns `true` when `/v1/_ping` responds 200; throws
   * `ConsentShieldApiError` / `ConsentShieldTimeoutError` /
   * `ConsentShieldNetworkError` otherwise. Useful for deploy-time health
   * checks of the Bearer key + base URL.
   *
   * Goes against `/v1/_ping` — see `app/src/app/api/v1/_ping/route.ts`.
   */
  async ping(): Promise<true> {
    await this.http.request<unknown>({ method: 'GET', path: '/_ping' })
    return true
  }
}
