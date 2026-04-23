// ADR-1005 Sprint 6.2/6.3 — shared HTTP helper for webhook adapters.
//
// Single place to handle timeouts + response-body capture + retryable
// classification. Every adapter wraps its POST in `postJson(url, body,
// opts)`; the adapter then decides which status codes map to which
// DeliveryResult shape. Kept extremely small on purpose — custom adapter
// logic (Slack's X-Slack-No-Retry, PagerDuty's dedup_key, etc.) stays in
// the adapter file.

export interface PostOptions {
  /** Default 10 seconds — webhooks should respond quickly. */
  timeoutMs?: number
  /** Additional headers. `Content-Type: application/json` is always set. */
  headers?: Record<string, string>
  /** `fetch` override for tests. Defaults to globalThis.fetch. */
  fetchImpl?: typeof fetch
}

export interface PostResult {
  status: number
  ok: boolean
  /** Response body as text. Capped at 2 KiB — we only log the first slice. */
  bodyText: string
  /** Response headers for adapters that need Retry-After / X-Slack-*. */
  headers: Record<string, string>
  /** Millisecond latency of the round-trip (start to response complete). */
  latency_ms: number
}

export type PostOutcome =
  | { kind: 'http'; result: PostResult }
  | {
      kind: 'network'
      latency_ms: number
      error: string
      /** AbortError → retryable timeout; other network errors → retryable. */
      retryable: true
    }

export async function postJson(
  url: string,
  body: unknown,
  opts: PostOptions = {},
): Promise<PostOutcome> {
  const fetchImpl = opts.fetchImpl ?? globalThis.fetch
  const timeoutMs = opts.timeoutMs ?? 10_000
  const start = Date.now()

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)

  try {
    const res = await fetchImpl(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...opts.headers,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    })

    const headers: Record<string, string> = {}
    res.headers.forEach((v, k) => {
      headers[k.toLowerCase()] = v
    })

    const text = await res.text().catch(() => '')
    return {
      kind: 'http',
      result: {
        status: res.status,
        ok: res.ok,
        bodyText: text.slice(0, 2048),
        headers,
        latency_ms: Date.now() - start,
      },
    }
  } catch (e) {
    const err = e as Error
    return {
      kind: 'network',
      latency_ms: Date.now() - start,
      error: err.name === 'AbortError' ? `timeout after ${timeoutMs}ms` : err.message,
      retryable: true,
    }
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Default retryable-status mapping used by the chat-channel adapters
 * (Slack / Teams / Discord). Each adapter can override as needed.
 */
export function isRetryableStatus(status: number): boolean {
  if (status >= 500 && status < 600) return true
  if (status === 429) return true
  return false
}
