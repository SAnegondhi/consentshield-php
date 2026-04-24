// ADR-1019 Sprint 2.1 — canonical JSON serialization for consent-event
// delivery.
//
// Serialises a JSON value with:
//   · object keys sorted lexicographically (recursively),
//   · no whitespace between tokens,
//   · UTF-8 output,
//   · a single trailing LF byte.
//
// The LF terminator is a convention for line-oriented audit-log files in R2;
// hashing a whole-object body with a trailing newline matches the sha256
// check the ADR-1014 Sprint 3.2 positive test will perform.
//
// Reproducibility matters: two independent runs against the same payload
// MUST produce the same bytes (and the same sha256). JSON.stringify's key
// order is insertion-order, not sorted — this helper fixes that.

export function canonicalJson(value: unknown): string {
  return canonicalise(value) + '\n'
}

function canonicalise(v: unknown): string {
  if (v === null) return 'null'
  if (typeof v === 'boolean') return v ? 'true' : 'false'
  if (typeof v === 'number') {
    if (!Number.isFinite(v)) {
      throw new Error(`canonicalJson: non-finite number ${v}`)
    }
    // JSON.stringify uses the shortest roundtrip representation; reuse it
    // rather than rolling our own IEEE-754 formatter.
    return JSON.stringify(v)
  }
  if (typeof v === 'string') return JSON.stringify(v)
  if (Array.isArray(v)) {
    return '[' + v.map(canonicalise).join(',') + ']'
  }
  if (typeof v === 'object') {
    const obj = v as Record<string, unknown>
    const keys = Object.keys(obj).sort()
    const parts: string[] = []
    for (const k of keys) {
      parts.push(JSON.stringify(k) + ':' + canonicalise(obj[k]))
    }
    return '{' + parts.join(',') + '}'
  }
  // Functions, symbols, bigints — callers should never pass these. JSON
  // payloads from delivery_buffer only contain JSON-native types.
  throw new Error(`canonicalJson: unsupported type ${typeof v}`)
}
