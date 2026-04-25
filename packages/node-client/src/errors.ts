// ADR-1006 Phase 1 Sprint 1.1 — error class hierarchy.
//
// Every error thrown by the SDK descends from `ConsentShieldError` so callers
// can `catch (e: unknown) { if (e instanceof ConsentShieldError) ... }` and
// branch on the concrete subclass for behaviour-specific recovery.
//
// All errors carry an optional `traceId` lifted from the response's
// `X-CS-Trace-Id` header (ADR-1014 Sprint 3.2). Server-side log correlation
// is one grep away when a partner reports an issue.

/**
 * RFC 7807 problem-document body shape — matches `app/src/lib/api/auth.ts`
 * `problemJson(...)` exactly. Surfaced on 4xx/5xx responses.
 */
export interface ProblemJson {
  type: string
  title: string
  status: number
  detail: string
  [key: string]: unknown
}

/**
 * Base error class for every SDK failure. Catch this if you want to handle
 * any ConsentShield error uniformly without distinguishing the cause.
 */
export class ConsentShieldError extends Error {
  /** ADR-1014 Sprint 3.2 — pipeline trace id from the response header. */
  readonly traceId?: string

  constructor(message: string, traceId?: string) {
    super(message)
    this.name = 'ConsentShieldError'
    this.traceId = traceId
    // Preserve prototype chain across transpilation targets that downlevel
    // class inheritance (the engines >=18 minimum makes this redundant in
    // practice, but it costs nothing and protects against bundler quirks).
    Object.setPrototypeOf(this, new.target.prototype)
  }
}

/**
 * The server returned a structured 4xx/5xx response with an RFC 7807 body.
 * The `problem` field carries the parsed `application/problem+json` payload
 * so callers can branch on `problem.title` / `problem.detail` /
 * service-specific extensions.
 */
export class ConsentShieldApiError extends ConsentShieldError {
  readonly status: number
  readonly problem?: ProblemJson

  constructor(status: number, problem: ProblemJson | undefined, traceId?: string) {
    // Empty-string detail also falls back to title — RFC 7807 doesn't
    // require detail, so an empty string is in the "absent" spirit. `||`
    // (not `??`) honours that.
    const detail = problem?.detail || problem?.title || `HTTP ${status}`
    super(`ConsentShield API error: ${status} ${detail}`, traceId)
    this.name = 'ConsentShieldApiError'
    this.status = status
    this.problem = problem
    Object.setPrototypeOf(this, new.target.prototype)
  }
}

/**
 * Transport failure — DNS, TCP reset, TLS handshake error, or any other
 * `fetch` rejection that isn't a timeout. Network failures are RETRIED
 * by the HTTP helper (up to maxRetries) before this error surfaces.
 */
export class ConsentShieldNetworkError extends ConsentShieldError {
  readonly cause?: unknown

  constructor(message: string, cause?: unknown, traceId?: string) {
    super(`ConsentShield network error: ${message}`, traceId)
    this.name = 'ConsentShieldNetworkError'
    this.cause = cause
    Object.setPrototypeOf(this, new.target.prototype)
  }
}

/**
 * The request exceeded `timeoutMs` (default 2 000 ms — the compliance-
 * posture default per the v2 whitepaper §5.4). Per-request `AbortSignal`
 * fires; the SDK does NOT retry timeouts (the second attempt would
 * compound user-visible latency past the budget).
 */
export class ConsentShieldTimeoutError extends ConsentShieldError {
  readonly timeoutMs: number

  constructor(timeoutMs: number, traceId?: string) {
    super(`ConsentShield request exceeded ${timeoutMs} ms`, traceId)
    this.name = 'ConsentShieldTimeoutError'
    this.timeoutMs = timeoutMs
    Object.setPrototypeOf(this, new.target.prototype)
  }
}

/**
 * Compliance-critical: a `verify` call could not be evaluated (timeout,
 * network, or 5xx), AND the SDK is in fail-CLOSED mode (the default).
 *
 * The SDK refuses to default-OPEN under failure unless the caller
 * explicitly opts in via `failOpen: true` in the constructor. Per the
 * v2 whitepaper §5.4, defaulting open on a verify failure is the worst
 * DPDP outcome — the customer might silently act on withdrawn consent.
 *
 * When this error is thrown the calling code MUST treat the data principal
 * as "consent NOT verified" and refuse the underlying operation. If the
 * caller wants to opt in to fail-open behaviour, set `failOpen: true` and
 * the SDK will return a `{ status: 'open_failure', reason }` shape instead
 * of throwing this error (and the override is recorded in the customer's
 * audit trail via the `/v1/audit` endpoint).
 */
export class ConsentVerifyError extends ConsentShieldError {
  readonly cause: ConsentShieldError

  constructor(cause: ConsentShieldError) {
    super(`Consent verification failed (fail-closed): ${cause.message}`, cause.traceId)
    this.name = 'ConsentVerifyError'
    this.cause = cause
    Object.setPrototypeOf(this, new.target.prototype)
  }
}
