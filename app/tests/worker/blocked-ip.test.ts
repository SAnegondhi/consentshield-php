import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createWorker, defaultState, MockState } from './harness'

// ADR-0033 Sprint 2.3 — Worker-side blocked-IP enforcement.
//
// The Worker reads `admin:config:v1` from KV on every request. The
// snapshot carries `blocked_ips` — an array of CIDR strings populated
// from public.blocked_ips via public.admin_config_snapshot() on the
// existing 2-minute sync cadence.
//
// Tests below seed the KV key directly (bypassing the Edge Function)
// and verify the /v1 endpoints reject blocked callers while exempting
// /v1/health (operators must be able to probe even when their IP is
// listed — diagnosability > purity).

const SEED_ORG = '11111111-1111-4111-8111-111111111111'
const SEED_PROPERTY = '22222222-2222-4222-8222-222222222222'

function snapshotWith(blocked: string[]) {
  return {
    kill_switches: {},
    active_tracker_signatures: [],
    published_sectoral_templates: [],
    suspended_org_ids: [],
    blocked_ips: blocked,
    refreshed_at: new Date().toISOString(),
  }
}

function kvSeed(blocked: string[]) {
  return {
    'admin:config:v1': { value: JSON.stringify(snapshotWith(blocked)) },
  }
}

let state: MockState
let mf: Awaited<ReturnType<typeof createWorker>>

beforeEach(() => {
  state = defaultState()
  state.properties[SEED_PROPERTY] = {
    allowed_origins: ['https://customer.example'],
    event_signing_secret: 'a'.repeat(64),
  }
})

afterEach(async () => {
  if (mf) await mf.dispose()
})

describe('ADR-0033 Sprint 2.3 — blocked-IP enforcement', () => {
  it('blocks an exact IPv4 match (/32 implicit)', async () => {
    mf = await createWorker({ state, kvSeed: kvSeed(['1.2.3.4/32']) })

    const res = await mf.fetch('https://cdn.local/v1/events', {
      method: 'POST',
      headers: { 'CF-Connecting-IP': '1.2.3.4', 'Content-Type': 'application/json' },
      body: JSON.stringify({ org_id: SEED_ORG, property_id: SEED_PROPERTY }),
    })

    expect(res.status).toBe(403)
    const body = (await res.json()) as { error: string }
    expect(body.error).toBe('ip_blocked')
  })

  it('blocks an IP inside a /24 range', async () => {
    mf = await createWorker({ state, kvSeed: kvSeed(['198.51.100.0/24']) })

    const res = await mf.fetch('https://cdn.local/v1/observations', {
      method: 'POST',
      headers: { 'CF-Connecting-IP': '198.51.100.42', 'Content-Type': 'application/json' },
      body: JSON.stringify({ observations: [] }),
    })

    expect(res.status).toBe(403)
  })

  it('passes through an IP outside the blocked range', async () => {
    // Seed a block that our test IP does NOT match; expect the request
    // to reach the real handler (which will 400/404/202 on its own —
    // anything except 403 ip_blocked proves the middleware passed).
    mf = await createWorker({ state, kvSeed: kvSeed(['198.51.100.0/24']) })

    const res = await mf.fetch('https://cdn.local/v1/events', {
      method: 'POST',
      headers: { 'CF-Connecting-IP': '203.0.113.5', 'Content-Type': 'application/json' },
      body: JSON.stringify({ org_id: SEED_ORG, property_id: SEED_PROPERTY }),
    })

    // Whatever the downstream handler returns, it must NOT be 403 with
    // ip_blocked — that would mean the middleware falsely matched.
    if (res.status === 403) {
      const body = (await res.json().catch(() => ({}))) as { error?: string }
      expect(body.error).not.toBe('ip_blocked')
    }
  })

  it('passes through when no KV snapshot is seeded (fail-open on bootstrap)', async () => {
    // No kvSeed. getAdminConfig returns EMPTY_SNAPSHOT with blocked_ips: [].
    mf = await createWorker({ state })

    const res = await mf.fetch('https://cdn.local/v1/events', {
      method: 'POST',
      headers: { 'CF-Connecting-IP': '1.2.3.4', 'Content-Type': 'application/json' },
      body: JSON.stringify({ org_id: SEED_ORG, property_id: SEED_PROPERTY }),
    })

    expect(res.status).not.toBe(403)
  })

  it('exempts /v1/health from blocking (operator diagnostics path)', async () => {
    mf = await createWorker({ state, kvSeed: kvSeed(['1.2.3.4/32']) })

    const res = await mf.fetch('https://cdn.local/v1/health', {
      headers: { 'CF-Connecting-IP': '1.2.3.4' },
    })

    expect(res.status).toBe(200)
    const body = (await res.json()) as { status: string }
    expect(body.status).toBe('ok')
  })

  it('ignores IPv6 CIDRs in the blocked list (v1 scope is v4-only)', async () => {
    // IPv6 entries should be tolerated (no crash) and never match an
    // IPv4 caller. Operators today block v4 ranges; v6 support is a
    // V2 follow-up.
    mf = await createWorker({ state, kvSeed: kvSeed(['2001:db8::/32', '1.2.3.4/32']) })

    // The v4 entry must still match; the v6 entry is a no-op.
    const res = await mf.fetch('https://cdn.local/v1/events', {
      method: 'POST',
      headers: { 'CF-Connecting-IP': '1.2.3.4', 'Content-Type': 'application/json' },
      body: JSON.stringify({ org_id: SEED_ORG, property_id: SEED_PROPERTY }),
    })

    expect(res.status).toBe(403)
  })
})
