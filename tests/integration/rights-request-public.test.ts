// ADR-1014 Phase 3 Sprint 3.3 — public rights-request RPC contract test.
//
// Mirrors Sprint 3.1's signup-intake approach: drives the authoritative
// RPCs directly via service role and asserts on DB state.
//
// RPCs under test (migration 20260414000005_scoped_rpcs_public.sql):
//   public.rpc_rights_request_create(org_id, request_type, name, email,
//                                     message, otp_hash, otp_expires_at)
//     → table (request_id uuid, org_name text)
//   public.rpc_rights_request_verify_otp(request_id, otp_hash)
//     → jsonb {ok, ...} or {ok:false, error: '...'}
//
// Route-handler concerns (Turnstile verify, 5/60s per-IP rate limit, OTP
// email dispatch) live at the Node route layer and are covered by unit
// tests on the helper modules — this test exercises the DB-side state
// machine directly.

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createHash, randomBytes } from 'node:crypto'
import { createTestOrg, cleanupTestOrg, getServiceClient, type TestOrg } from '../rls/helpers'

const admin = getServiceClient()

let org: TestOrg
const createdRequestIds: string[] = []

function hashOtp(code: string): string {
  return createHash('sha256').update(code).digest('hex')
}

function otpExpiry(minutesFromNow: number): string {
  return new Date(Date.now() + minutesFromNow * 60_000).toISOString()
}

async function createRequest(opts: {
  orgId: string
  requestType?: string
  name?: string
  email?: string
  message?: string
  otpHash: string
  otpExpiresAt: string
}): Promise<{ request_id: string; org_name: string }> {
  const { data, error } = await admin.rpc('rpc_rights_request_create', {
    p_org_id: opts.orgId,
    p_request_type: opts.requestType ?? 'erasure',
    p_requestor_name: opts.name ?? 'Test Requestor',
    p_requestor_email:
      opts.email ?? `requestor-${Date.now()}@test.consentshield.in`,
    p_requestor_message: opts.message ?? 'seed',
    p_otp_hash: opts.otpHash,
    p_otp_expires_at: opts.otpExpiresAt,
  })
  if (error) throw new Error(`rpc_rights_request_create: ${error.message}`)
  const row = (data as Array<{ request_id: string; org_name: string }>)[0]
  if (!row) throw new Error('create returned empty row')
  createdRequestIds.push(row.request_id)
  return row
}

async function verifyOtp(requestId: string, otpHash: string) {
  const { data, error } = await admin.rpc('rpc_rights_request_verify_otp', {
    p_request_id: requestId,
    p_otp_hash: otpHash,
  })
  if (error) throw new Error(`rpc_rights_request_verify_otp: ${error.message}`)
  return data as
    | { ok: true; org_id: string; org_name: string; compliance_contact_email: string | null; request_type: string; requestor_name: string; requestor_email: string }
    | { ok: false; error: string }
}

beforeAll(async () => {
  org = await createTestOrg('rightsPublic')
}, 90_000)

afterAll(async () => {
  // Purge created requests + their derived audit/events rows (FK cascade covers
  // rights_request_events; audit_log rows for test orgs get swept by cleanup).
  if (createdRequestIds.length > 0) {
    await admin.from('rights_requests').delete().in('id', createdRequestIds)
  }
  await cleanupTestOrg(org)
}, 60_000)

describe('rpc_rights_request_create — input validation', () => {
  it('rejects invalid request_type with 22023', async () => {
    const hash = hashOtp('123456')
    await expect(
      createRequest({
        orgId: org.orgId,
        requestType: 'bogus_type',
        otpHash: hash,
        otpExpiresAt: otpExpiry(10),
      }),
    ).rejects.toThrow(/invalid request_type/)
  })

  it('rejects invalid email shape with 22023', async () => {
    const hash = hashOtp('123456')
    await expect(
      createRequest({
        orgId: org.orgId,
        email: 'not-an-email',
        otpHash: hash,
        otpExpiresAt: otpExpiry(10),
      }),
    ).rejects.toThrow(/invalid requestor_email/)
  })

  it('rejects unknown org_id with P0002', async () => {
    const hash = hashOtp('123456')
    const fakeOrgId = '00000000-0000-0000-0000-000000000000'
    await expect(
      createRequest({
        orgId: fakeOrgId,
        otpHash: hash,
        otpExpiresAt: otpExpiry(10),
      }),
    ).rejects.toThrow(/unknown organisation/)
  })
})

describe('rpc_rights_request_create — happy path', () => {
  it('creates a pending request with email_verified=false + otp fields stored', async () => {
    const code = '654321'
    const hash = hashOtp(code)
    const expires = otpExpiry(10)
    const { request_id, org_name } = await createRequest({
      orgId: org.orgId,
      requestType: 'access',
      name: 'Alice Tester',
      email: `alice-${Date.now()}@test.consentshield.in`,
      otpHash: hash,
      otpExpiresAt: expires,
    })

    expect(request_id).toMatch(/^[0-9a-f-]{36}$/)
    expect(org_name).toBeTruthy()

    const { data: row, error } = await admin
      .from('rights_requests')
      .select(
        'id, org_id, request_type, email_verified, email_verified_at, otp_hash, otp_expires_at, status, turnstile_verified, otp_attempts',
      )
      .eq('id', request_id)
      .single()
    if (error) throw new Error(`fetch rights_requests row: ${error.message}`)
    expect(row.org_id).toBe(org.orgId)
    expect(row.request_type).toBe('access')
    expect(row.email_verified).toBe(false)
    expect(row.email_verified_at).toBeNull()
    expect(row.otp_hash).toBe(hash)
    expect(new Date(row.otp_expires_at as string).getTime()).toBeGreaterThan(
      Date.now(),
    )
    expect(row.status).toBe('new')
    expect(row.turnstile_verified).toBe(true)
    expect(row.otp_attempts ?? 0).toBe(0)
  })

  it('all four request_type values are accepted', async () => {
    for (const rt of ['erasure', 'access', 'correction', 'nomination']) {
      const r = await createRequest({
        orgId: org.orgId,
        requestType: rt,
        email: `${rt}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@test.consentshield.in`,
        otpHash: hashOtp(randomBytes(8).toString('hex')),
        otpExpiresAt: otpExpiry(10),
      })
      expect(r.request_id).toBeTruthy()
    }
  })
})

describe('rpc_rights_request_verify_otp — happy path', () => {
  it('correct OTP → ok:true, row flipped to email_verified=true, audit_log + rights_request_events written', async () => {
    const code = '246810'
    const hash = hashOtp(code)
    const { request_id } = await createRequest({
      orgId: org.orgId,
      otpHash: hash,
      otpExpiresAt: otpExpiry(10),
    })

    const result = await verifyOtp(request_id, hash)
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error('expected ok:true')

    expect(result.org_id).toBe(org.orgId)
    expect(result.request_type).toBeTruthy()
    expect(result.requestor_email).toBeTruthy()

    // Row flipped.
    const { data: row } = await admin
      .from('rights_requests')
      .select('email_verified, email_verified_at, otp_hash, otp_expires_at, otp_attempts, status')
      .eq('id', request_id)
      .single()
    expect(row!.email_verified).toBe(true)
    expect(row!.email_verified_at).toBeTruthy()
    expect(row!.otp_hash).toBeNull()
    expect(row!.otp_expires_at).toBeNull()
    expect(row!.otp_attempts).toBe(0)
    expect(row!.status).toBe('new')

    // rights_request_events row created with event_type='created'.
    const { data: events } = await admin
      .from('rights_request_events')
      .select('event_type, notes, org_id')
      .eq('request_id', request_id)
    expect(events).toBeTruthy()
    const createdEv = events!.find((e: { event_type: string }) => e.event_type === 'created')
    expect(createdEv).toBeTruthy()
    expect((createdEv as { org_id: string }).org_id).toBe(org.orgId)

    // audit_log row created with event_type='rights_request_created'.
    const { data: audit } = await admin
      .from('audit_log')
      .select('event_type, entity_id, entity_type, payload, org_id')
      .eq('entity_id', request_id)
      .eq('event_type', 'rights_request_created')
    expect(audit).toBeTruthy()
    expect(audit!.length).toBe(1)
    expect((audit![0] as { entity_type: string }).entity_type).toBe('rights_request')
  })
})

describe('rpc_rights_request_verify_otp — negative branches', () => {
  it('not_found — unknown request id', async () => {
    const fakeId = '00000000-0000-0000-0000-000000000000'
    const result = await verifyOtp(fakeId, hashOtp('000000'))
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('unreachable')
    expect(result.error).toBe('not_found')
  })

  it('invalid_otp — wrong hash increments otp_attempts; row stays pending', async () => {
    const correct = hashOtp('111111')
    const { request_id } = await createRequest({
      orgId: org.orgId,
      otpHash: correct,
      otpExpiresAt: otpExpiry(10),
    })

    const result = await verifyOtp(request_id, hashOtp('222222'))
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('unreachable')
    expect(result.error).toBe('invalid_otp')

    const { data: row } = await admin
      .from('rights_requests')
      .select('email_verified, otp_attempts, otp_hash')
      .eq('id', request_id)
      .single()
    expect(row!.email_verified).toBe(false)
    expect(row!.otp_attempts).toBe(1)
    expect(row!.otp_hash).toBe(correct) // still stored; next retry sees it
  })

  it('too_many_attempts — 5 wrong attempts lock further retries even if 6th is correct', async () => {
    const correct = hashOtp('333333')
    const wrong = hashOtp('444444')
    const { request_id } = await createRequest({
      orgId: org.orgId,
      otpHash: correct,
      otpExpiresAt: otpExpiry(10),
    })

    for (let i = 0; i < 5; i++) {
      const r = await verifyOtp(request_id, wrong)
      expect(r.ok).toBe(false)
    }
    const sixth = await verifyOtp(request_id, correct)
    expect(sixth.ok).toBe(false)
    if (sixth.ok) throw new Error('unreachable')
    expect(sixth.error).toBe('too_many_attempts')
  })

  it('expired — otp_expires_at in the past returns expired; row stays pending', async () => {
    const hash = hashOtp('555555')
    const { request_id } = await createRequest({
      orgId: org.orgId,
      otpHash: hash,
      // Future → create succeeds; then we push the row expiry back in time via admin UPDATE.
      otpExpiresAt: otpExpiry(10),
    })
    // Expire the stored row directly (the RPC itself refuses to create an
    // expired OTP — we only care about verify's behaviour, so bypass via service role).
    await admin
      .from('rights_requests')
      .update({ otp_expires_at: new Date(Date.now() - 60_000).toISOString() })
      .eq('id', request_id)

    const result = await verifyOtp(request_id, hash)
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('unreachable')
    expect(result.error).toBe('expired')

    const { data: row } = await admin
      .from('rights_requests')
      .select('email_verified')
      .eq('id', request_id)
      .single()
    expect(row!.email_verified).toBe(false)
  })

  it('already_verified — verifying twice returns the already_verified branch', async () => {
    const hash = hashOtp('666666')
    const { request_id } = await createRequest({
      orgId: org.orgId,
      otpHash: hash,
      otpExpiresAt: otpExpiry(10),
    })

    const first = await verifyOtp(request_id, hash)
    expect(first.ok).toBe(true)

    // After success, otp_hash is cleared. Second call hits the email_verified
    // branch. Passing any hash; the check is on email_verified, not the OTP.
    const second = await verifyOtp(request_id, hash)
    expect(second.ok).toBe(false)
    if (second.ok) throw new Error('unreachable')
    expect(second.error).toBe('already_verified')
  })

  it('no_otp_issued — row with null otp_hash reports no_otp_issued', async () => {
    const hash = hashOtp('777777')
    const { request_id } = await createRequest({
      orgId: org.orgId,
      otpHash: hash,
      otpExpiresAt: otpExpiry(10),
    })
    // Clear OTP via admin UPDATE so the branch condition fires.
    await admin
      .from('rights_requests')
      .update({ otp_hash: null, otp_expires_at: null })
      .eq('id', request_id)

    const result = await verifyOtp(request_id, hash)
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('unreachable')
    expect(result.error).toBe('no_otp_issued')
  })
})

describe('rpc_rights_request_verify_otp — side-effect isolation', () => {
  it('verifying request A does not mutate request B or any cross-org row', async () => {
    const otherOrg = await createTestOrg('rightsPublicOther')
    try {
      const hashA = hashOtp('123123')
      const hashB = hashOtp('456456')

      const { request_id: idA } = await createRequest({
        orgId: org.orgId,
        otpHash: hashA,
        otpExpiresAt: otpExpiry(10),
      })
      const { request_id: idB } = await createRequest({
        orgId: otherOrg.orgId,
        otpHash: hashB,
        otpExpiresAt: otpExpiry(10),
      })

      const r = await verifyOtp(idA, hashA)
      expect(r.ok).toBe(true)

      const { data: rowB } = await admin
        .from('rights_requests')
        .select('email_verified, otp_hash, otp_attempts')
        .eq('id', idB)
        .single()
      expect(rowB!.email_verified).toBe(false)
      expect(rowB!.otp_hash).toBe(hashB)
      expect(rowB!.otp_attempts ?? 0).toBe(0)
    } finally {
      await cleanupTestOrg(otherOrg)
    }
  }, 90_000)
})
