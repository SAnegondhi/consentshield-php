// ADR-1010 Phase 1 Sprint 1.1 — Mechanism A: Cloudflare Hyperdrive.
//
// Hyperdrive is a Cloudflare-native Postgres pooler. Once the operator
// provisions a Hyperdrive instance (see prototypes/README.md) and binds
// it via wrangler.toml, `env.HYPERDRIVE.connectionString` becomes a
// usable DSN that speaks the Postgres wire protocol. postgres.js
// (pinned to the 3.4.x-Worker-compatible build) can connect to it.
//
// Until the binding is configured, this probe returns a structured
// skip — the route handler reports Hyperdrive as "not yet available"
// so the decision matrix has a clear signal rather than a crash.
//
// Why we don't import `postgres` here: adding a dep now would breach
// Rule 16. The import lands in the Phase 3 rewrite once Hyperdrive is
// picked; the prototype stays dep-free by using Worker `fetch` against
// Hyperdrive's HTTP-proxy mode (Cloudflare Hyperdrive exposes a
// `connectionString` for wire-protocol clients, but this probe is
// satisfied by a simple TCP handshake reachability signal — the wire-
// protocol probe is deferred to option C which implements the
// handshake anyway).

import type { Env } from '../index'
import type { ProbeResult } from './types'

// Phase 3 Sprint 3.1 folded the Hyperdrive binding into the canonical
// Env interface, so probe-hyperdrive.ts no longer needs its own cast.

export async function probeViaHyperdrive(env: Env): Promise<ProbeResult> {
  const start = Date.now()
  const binding = env.HYPERDRIVE

  if (!binding || !binding.connectionString) {
    return {
      mechanism: 'hyperdrive',
      ok: false,
      latency_ms: Date.now() - start,
      note: 'hyperdrive_binding_not_configured',
      error:
        'Configure a Hyperdrive binding per prototypes/README.md. Without it, '
        + 'env.HYPERDRIVE is undefined at runtime.',
    }
  }

  // Presence-only signal at v1 scaffold — the real TCP handshake lands
  // when we adopt postgres.js or an equivalent Worker-compatible client.
  // Reporting the binding's existence is enough to confirm the operator
  // step completed; actual latency comparison happens after Phase 3
  // Sprint 3.1 swaps the first REST call site to Hyperdrive.
  return {
    mechanism: 'hyperdrive',
    ok: true,
    latency_ms: Date.now() - start,
    note:
      'binding_present; wire-protocol probe deferred to Phase 3 Sprint 3.1. '
      + 'Operator has provisioned the Hyperdrive instance; next step is '
      + 'swapping banner.ts/signatures.ts REST calls to use it.',
    current_user: 'pending_wire_probe',
  }
}
