// ADR-1010 Phase 1 Sprint 1.1 — Mechanism C: hand-rolled TCP Postgres.
//
// Scaffold only. A full implementation needs ~300 lines:
//
//   1. Open TLS socket via Cloudflare Workers `connect()` API
//      (`import { connect } from "cloudflare:sockets"`). Upgrade to TLS
//      via STARTSSL (Postgres `SSLRequest` = int32 80877103).
//   2. StartupMessage: protocol version 3.0 + user + database params.
//   3. SCRAM-SHA-256 authentication: AuthenticationSASL →
//      SASLInitialResponse with client-first-message, server sends
//      AuthenticationSASLContinue with nonce + salt + iters, client
//      responds with SASLResponse carrying client-final-message +
//      client-proof; server responds AuthenticationSASLFinal +
//      AuthenticationOk.
//   4. ReadyForQuery.
//   5. Simple Query: 'Q' message + 'SELECT current_user'.
//   6. Parse RowDescription + DataRow + CommandComplete + ReadyForQuery.
//
// Each step requires careful byte-level framing (length-prefixed +
// network-byte-order integers + null-terminated strings). The
// canonical references are libpq's fe-protocol.c and the Postgres
// source's backend/libpq/auth-scram.c.
//
// Implementing this only becomes worthwhile if Hyperdrive is rejected
// (too expensive / too much Cloudflare dashboard surface / p99 worse
// than REST). The scaffold below returns a structured skip so the
// route still reports the mechanism; the ADR tracks the implementation
// decision, not the skeleton.

import type { Env } from '../index'
import type { ProbeResult } from './types'

export async function probeViaRawTcp(_env: Env): Promise<ProbeResult> {
  const start = Date.now()

  // cloudflare:sockets is the Worker-native TCP connect API.
  // Referencing it unconditionally throws in harnesses that don't
  // polyfill it, so we gate via typeof and return a structured skip.
  const hasConnect = typeof globalThis !== 'undefined'
    && 'connect' in (globalThis as unknown as Record<string, unknown>)

  return {
    mechanism: 'raw_tcp',
    ok: false,
    latency_ms: Date.now() - start,
    note: hasConnect
      ? 'scaffold_only — implementation deferred pending Hyperdrive A/B result'
      : 'sockets_api_unavailable — requires node_compat or cloudflare:sockets',
    error:
      'probe-raw-tcp.ts is a scaffold. See the header comment for the 6-step '
      + 'protocol outline; implementation lives in an ADR-1010 amendment if '
      + 'Hyperdrive is rejected at Phase 1 close.',
  }
}
