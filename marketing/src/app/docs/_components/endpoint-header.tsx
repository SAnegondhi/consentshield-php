// ADR-1015 Phase 1 Sprint 1.1 — Endpoint header card.
//
// Top-of-page banner on every /docs/api/* reference page. Shows the
// method pill, the path, and three pieces of metadata:
// authentication, rate limit, and idempotency behaviour.

type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'

const METHOD_CLASS: Record<HttpMethod, string> = {
  GET: 'get',
  POST: 'post',
  PUT: 'put',
  PATCH: 'put',
  DELETE: 'del',
}

export function EndpointHeader({
  method,
  path,
  auth,
  rateLimit,
  idempotent,
}: {
  method: HttpMethod
  /**
   * Path template; `{id}` segments are highlighted as params.
   */
  path: string
  auth?: string
  rateLimit?: string
  idempotent?: string
}) {
  return (
    <div className="endpoint-head">
      <div className="endpoint-url">
        <span className={`method-pill ${METHOD_CLASS[method]}`}>{method}</span>
        <span className="endpoint-path">{renderPath(path)}</span>
      </div>
      {(auth || rateLimit || idempotent) && (
        <div className="endpoint-meta">
          {auth ? <span><strong>Auth:</strong> {auth}</span> : null}
          {rateLimit ? <span><strong>Rate:</strong> {rateLimit}</span> : null}
          {idempotent ? <span><strong>Idempotent:</strong> {idempotent}</span> : null}
        </div>
      )}
    </div>
  )
}

// Wrap every `{param}` segment in a <span class="param"> for styling.
function renderPath(path: string) {
  const parts = path.split(/(\{[^}]+\})/g)
  return parts.map((p, i) => {
    if (p.startsWith('{') && p.endsWith('}')) {
      return (
        <span key={i} className="param">
          {p}
        </span>
      )
    }
    return <span key={i}>{p}</span>
  })
}
