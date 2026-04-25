// ADR-1006 Phase 1 Sprint 1.1 — HTTP transport.
//
// Single concerns:
//   1. Bearer-token authenticated fetch against the ConsentShield v1 API.
//   2. 2-second default timeout per request (per the v2 whitepaper §5.4
//      compliance posture — the SDK MUST NOT block customer code longer
//      than the consent-decision budget).
//   3. Exponential-backoff retry on transport errors and 5xx responses
//      (default maxRetries=3; never retries 4xx; never retries timeouts).
//   4. Response → typed body OR structured error.
//
// Runs on Node 18+ (global `fetch` + `AbortController` + Web Streams).
// `fetchImpl` is overridable for testing without monkey-patching globals.

import {
  ConsentShieldApiError,
  ConsentShieldNetworkError,
  ConsentShieldTimeoutError,
  type ProblemJson,
} from './errors'

/** Subset of the global fetch signature we depend on — sufficient for stubs. */
export type FetchImpl = (
  input: string,
  init?: RequestInit,
) => Promise<Response>

export interface HttpClientOptions {
  baseUrl: string
  apiKey: string
  /** Per-request timeout in ms. SDK default: 2 000. */
  timeoutMs: number
  /** Retry attempts on 5xx + transport error. SDK default: 3. */
  maxRetries: number
  /** Override for testing; defaults to global fetch. */
  fetchImpl?: FetchImpl
  /** Override for testing; defaults to setTimeout-based delay. */
  sleepImpl?: (ms: number) => Promise<void>
}

export interface HttpRequest {
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE'
  /** Path AFTER the v1 prefix — e.g. '/consent/verify'. Leading slash required. */
  path: string
  /** Optional JSON body — serialised + Content-Type stamped automatically. */
  body?: unknown
  /** Query-string params; values that are undefined or null are omitted. */
  query?: Record<string, string | number | boolean | undefined | null>
  /** Optional caller-supplied AbortSignal — composed with the timeout signal. */
  signal?: AbortSignal
  /** Optional caller-supplied trace id; sent as X-CS-Trace-Id. SDK never overrides. */
  traceId?: string
}

interface HttpResponse<T> {
  status: number
  body: T
  /** Pipeline trace id from the response — see ADR-1014 Sprint 3.2. */
  traceId?: string
}

const TRACE_ID_HEADER_LOWER = 'x-cs-trace-id'

const defaultSleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms))

/**
 * Compose an AbortSignal that fires when EITHER the supplied caller signal
 * fires OR `timeoutMs` elapses. Returns the composed signal + a cleanup
 * function the caller MUST invoke to clear the timeout regardless of
 * whether the request succeeded, failed, or was aborted upstream.
 */
function withTimeout(
  timeoutMs: number,
  callerSignal: AbortSignal | undefined,
): { signal: AbortSignal; cleanup: () => void; timedOut: () => boolean } {
  const ctrl = new AbortController()
  let didTimeout = false
  const handle = setTimeout(() => {
    didTimeout = true
    ctrl.abort()
  }, timeoutMs)

  if (callerSignal) {
    if (callerSignal.aborted) {
      ctrl.abort()
    } else {
      callerSignal.addEventListener(
        'abort',
        () => ctrl.abort(),
        { once: true },
      )
    }
  }

  return {
    signal: ctrl.signal,
    cleanup: () => clearTimeout(handle),
    timedOut: () => didTimeout,
  }
}

/**
 * Backoff: 100 ms, 400 ms, 1 600 ms — bounded so even maxRetries=3 stays
 * within ~2 s of cumulative wait, leaving headroom under the typical
 * caller-side 5 s SLA. Doesn't add jitter — the SDK is per-request, not
 * a thundering-herd retry farm.
 */
function backoffMs(attempt: number): number {
  return 100 * Math.pow(4, attempt)
}

function buildUrl(baseUrl: string, path: string, query?: HttpRequest['query']): string {
  const trimmedBase = baseUrl.replace(/\/+$/, '')
  const trimmedPath = path.startsWith('/') ? path : `/${path}`
  let url = `${trimmedBase}/v1${trimmedPath}`

  if (query) {
    const params = new URLSearchParams()
    for (const [k, v] of Object.entries(query)) {
      if (v === undefined || v === null) continue
      params.set(k, String(v))
    }
    const qs = params.toString()
    if (qs) url += `?${qs}`
  }

  return url
}

async function parseProblemBody(resp: Response): Promise<ProblemJson | undefined> {
  const ctype = resp.headers.get('content-type') ?? ''
  if (!ctype.includes('json')) return undefined
  try {
    return (await resp.json()) as ProblemJson
  } catch {
    return undefined
  }
}

export class HttpClient {
  private readonly baseUrl: string
  private readonly apiKey: string
  private readonly timeoutMs: number
  private readonly maxRetries: number
  private readonly fetchImpl: FetchImpl
  private readonly sleepImpl: (ms: number) => Promise<void>

  constructor(opts: HttpClientOptions) {
    this.baseUrl = opts.baseUrl
    this.apiKey = opts.apiKey
    this.timeoutMs = opts.timeoutMs
    this.maxRetries = opts.maxRetries
    this.fetchImpl = opts.fetchImpl ?? ((input, init) => fetch(input, init))
    this.sleepImpl = opts.sleepImpl ?? defaultSleep
  }

  async request<T>(req: HttpRequest): Promise<HttpResponse<T>> {
    const url = buildUrl(this.baseUrl, req.path, req.query)
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.apiKey}`,
      Accept: 'application/json',
    }
    if (req.body !== undefined) {
      headers['Content-Type'] = 'application/json'
    }
    if (req.traceId) {
      headers['X-CS-Trace-Id'] = req.traceId
    }

    let lastError: unknown
    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      const { signal, cleanup, timedOut } = withTimeout(this.timeoutMs, req.signal)

      let resp: Response
      try {
        resp = await this.fetchImpl(url, {
          method: req.method,
          headers,
          body: req.body !== undefined ? JSON.stringify(req.body) : undefined,
          signal,
        })
      } catch (err) {
        cleanup()
        // Distinguish timeout from generic transport failure. Native fetch
        // throws an AbortError when the signal aborts; we treat OUR
        // timeout as ConsentShieldTimeoutError and the caller's external
        // abort as a re-thrown signal-honoured error.
        if (timedOut()) {
          // Don't retry timeouts — second attempt would compound latency
          // past the compliance budget. Surface immediately.
          throw new ConsentShieldTimeoutError(this.timeoutMs)
        }
        if (req.signal?.aborted) {
          // Caller aborted explicitly. Re-throw the underlying error so
          // they see their own AbortError.
          throw err
        }
        lastError = new ConsentShieldNetworkError(
          err instanceof Error ? err.message : String(err),
          err,
        )
        if (attempt < this.maxRetries) {
          await this.sleepImpl(backoffMs(attempt))
          continue
        }
        throw lastError
      }

      cleanup()
      const traceId = resp.headers.get(TRACE_ID_HEADER_LOWER) ?? undefined

      // 5xx → retry with backoff (server might be transiently overloaded).
      if (resp.status >= 500 && resp.status < 600) {
        const problem = await parseProblemBody(resp)
        lastError = new ConsentShieldApiError(resp.status, problem, traceId)
        if (attempt < this.maxRetries) {
          await this.sleepImpl(backoffMs(attempt))
          continue
        }
        throw lastError
      }

      // 4xx → never retry. Caller bug or auth/scope problem; another
      // attempt would just rate-limit them.
      if (!resp.ok) {
        const problem = await parseProblemBody(resp)
        throw new ConsentShieldApiError(resp.status, problem, traceId)
      }

      // 2xx → parse the body. 204 No Content returns null.
      let body: T
      if (resp.status === 204) {
        body = null as unknown as T
      } else {
        const ctype = resp.headers.get('content-type') ?? ''
        if (ctype.includes('json')) {
          body = (await resp.json()) as T
        } else {
          body = (await resp.text()) as unknown as T
        }
      }
      return { status: resp.status, body, traceId }
    }

    // Loop exhausted (maxRetries=0 case where the very first attempt
    // failed and returned out of the catch block above).
    throw lastError ?? new ConsentShieldNetworkError('request failed without a captured error')
  }
}
