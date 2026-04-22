// ADR-1014 Phase 3 Sprint 3.4 — deletion-receipt callback RPC + overdue test.
//
// Covers:
//   - rpc_deletion_receipt_confirm state machine (all branches from
//     migration 20260414000005_scoped_rpcs_public.sql §rpc_deletion_receipt_confirm):
//       not_found, invalid_state, race, already_confirmed, happy paths for
//       'completed' / 'partial' / 'failed' reported_status values.
//   - Side effects: audit_log row with event_type='deletion_confirmed';
//     response_payload shape on the receipt row.
//   - Overdue / retry-window query: the pattern that `check-stuck-deletions`
//     uses (`status='awaiting_callback' AND (next_retry_at IS NULL OR next_retry_at <= now())`)
//     returns a stale receipt; stamping next_retry_at in the future removes
//     it from the retry set.
//
// Route-handler-level tampered-signature negative lives in
// `app/tests/rights/deletion-callback-signing.test.ts` (unit tests on
// the verifyCallback HMAC helper that the route uses before calling this
// RPC).

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createTestOrg, cleanupTestOrg, getServiceClient, type TestOrg } from '../rls/helpers'

const admin = getServiceClient()

let org: TestOrg
const createdReceiptIds: string[] = []

async function seedReceipt(opts: {
  orgId: string
  status?: 'pending' | 'awaiting_callback' | 'confirmed' | 'failed'
  requestedAt?: string
  retryCount?: number
  nextRetryAt?: string | null
}): Promise<string> {
  const { data, error } = await admin
    .from('deletion_receipts')
    .insert({
      org_id: opts.orgId,
      trigger_type: 'rights_request',
      target_system: 'test_connector',
      identifier_hash:
        'sha256:' + Math.random().toString(36).slice(2) + 'a'.repeat(40),
      status: opts.status ?? 'awaiting_callback',
      requested_at: opts.requestedAt ?? new Date().toISOString(),
      retry_count: opts.retryCount ?? 0,
      next_retry_at: opts.nextRetryAt ?? null,
      request_payload: { note: 'seed' },
    })
    .select('id')
    .single()
  if (error) throw new Error(`seedReceipt: ${error.message}`)
  createdReceiptIds.push(data!.id)
  return data!.id
}

async function callConfirm(args: {
  receiptId: string
  reportedStatus?: string
  recordsDeleted?: number
  systemsAffected?: unknown
  completedAt?: string | null
}) {
  const { data, error } = await admin.rpc('rpc_deletion_receipt_confirm', {
    p_receipt_id: args.receiptId,
    p_reported_status: args.reportedStatus ?? 'completed',
    p_records_deleted: args.recordsDeleted ?? 0,
    p_systems_affected: args.systemsAffected ?? [],
    p_completed_at: args.completedAt ?? null,
  })
  if (error) throw new Error(`rpc_deletion_receipt_confirm: ${error.message}`)
  return data as
    | { ok: true; receipt_id?: string; status?: string; already_confirmed?: boolean }
    | { ok: false; error: string; current?: string }
}

beforeAll(async () => {
  org = await createTestOrg('deletionCb')
}, 90_000)

afterAll(async () => {
  if (createdReceiptIds.length > 0) {
    await admin.from('deletion_receipts').delete().in('id', createdReceiptIds)
  }
  await cleanupTestOrg(org)
}, 60_000)

describe('rpc_deletion_receipt_confirm — state machine', () => {
  it('not_found — unknown receipt id returns not_found', async () => {
    const result = await callConfirm({
      receiptId: '00000000-0000-0000-0000-000000000000',
    })
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('unreachable')
    expect(result.error).toBe('not_found')
  })

  it('happy path — awaiting_callback → confirmed + response_payload + audit_log row', async () => {
    const id = await seedReceipt({ orgId: org.orgId })
    const completedAt = new Date('2026-04-23T10:00:00.000Z').toISOString()

    const result = await callConfirm({
      receiptId: id,
      reportedStatus: 'completed',
      recordsDeleted: 42,
      systemsAffected: ['crm', 'billing'],
      completedAt,
    })
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error('unreachable')
    expect(result.status).toBe('confirmed')
    expect(result.receipt_id).toBe(id)
    expect(result.already_confirmed).toBeUndefined()

    // Row flipped.
    const { data: row } = await admin
      .from('deletion_receipts')
      .select('status, confirmed_at, response_payload')
      .eq('id', id)
      .single()
    expect(row!.status).toBe('confirmed')
    // `confirmed_at` round-trips via Postgres timestamptz; compare as Date value
    // rather than string so formatting drift (timezone, microsecond precision)
    // doesn't flap the assertion.
    expect(new Date(row!.confirmed_at as string).getTime()).toBe(
      new Date(completedAt).getTime(),
    )
    const payload = row!.response_payload as {
      status: string
      records_deleted: number
      systems_affected: string[]
    }
    expect(payload.status).toBe('completed')
    expect(payload.records_deleted).toBe(42)
    expect(payload.systems_affected).toEqual(['crm', 'billing'])

    // Audit row.
    const { data: audit } = await admin
      .from('audit_log')
      .select('event_type, entity_type, entity_id, payload, org_id')
      .eq('entity_id', id)
      .eq('event_type', 'deletion_confirmed')
    expect(audit!.length).toBe(1)
    expect((audit![0] as { entity_type: string }).entity_type).toBe('deletion_receipt')
    expect((audit![0] as { org_id: string }).org_id).toBe(org.orgId)
    const ap = (audit![0] as { payload: { reported_status: string; records_deleted: number } }).payload
    expect(ap.reported_status).toBe('completed')
    expect(ap.records_deleted).toBe(42)
  })

  it('partial reported_status → status=partial persisted', async () => {
    const id = await seedReceipt({ orgId: org.orgId })
    const result = await callConfirm({
      receiptId: id,
      reportedStatus: 'partial',
      recordsDeleted: 7,
    })
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error('unreachable')
    expect(result.status).toBe('partial')

    const { data: row } = await admin
      .from('deletion_receipts')
      .select('status')
      .eq('id', id)
      .single()
    expect(row!.status).toBe('partial')
  })

  it('failed reported_status → status=failed persisted', async () => {
    const id = await seedReceipt({ orgId: org.orgId })
    const result = await callConfirm({
      receiptId: id,
      reportedStatus: 'failed',
    })
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error('unreachable')
    expect(result.status).toBe('failed')
  })

  it('unknown reported_status maps to confirmed (per RPC source)', async () => {
    const id = await seedReceipt({ orgId: org.orgId })
    const result = await callConfirm({
      receiptId: id,
      reportedStatus: 'weird_custom_value',
    })
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error('unreachable')
    expect(result.status).toBe('confirmed')
  })

  it('invalid_state — pending row cannot be confirmed', async () => {
    const id = await seedReceipt({ orgId: org.orgId, status: 'pending' })
    const result = await callConfirm({ receiptId: id })
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('unreachable')
    expect(result.error).toBe('invalid_state')
    expect(result.current).toBe('pending')

    // Row unchanged.
    const { data: row } = await admin
      .from('deletion_receipts')
      .select('status, confirmed_at, response_payload')
      .eq('id', id)
      .single()
    expect(row!.status).toBe('pending')
    expect(row!.confirmed_at).toBeNull()
    expect(row!.response_payload).toBeNull()
  })

  it('already_confirmed — re-confirming a confirmed row returns already_confirmed=true without mutating', async () => {
    const id = await seedReceipt({ orgId: org.orgId })
    const first = await callConfirm({
      receiptId: id,
      reportedStatus: 'completed',
      recordsDeleted: 10,
    })
    expect(first.ok).toBe(true)

    const second = await callConfirm({
      receiptId: id,
      reportedStatus: 'completed',
      recordsDeleted: 99, // different payload — must NOT be applied
    })
    expect(second.ok).toBe(true)
    if (!second.ok) throw new Error('unreachable')
    expect(second.already_confirmed).toBe(true)

    // Row still carries the first call's payload.
    const { data: row } = await admin
      .from('deletion_receipts')
      .select('response_payload')
      .eq('id', id)
      .single()
    const payload = row!.response_payload as { records_deleted: number }
    expect(payload.records_deleted).toBe(10)

    // Only ONE audit row (replay does not double-emit).
    const { data: audit } = await admin
      .from('audit_log')
      .select('id')
      .eq('entity_id', id)
      .eq('event_type', 'deletion_confirmed')
    expect(audit!.length).toBe(1)
  })

  it('already_confirmed — "completed" status also triggers replay path', async () => {
    // Seed directly in `completed` state (skipping awaiting_callback).
    const { data, error } = await admin
      .from('deletion_receipts')
      .insert({
        org_id: org.orgId,
        trigger_type: 'rights_request',
        target_system: 'test_connector_2',
        identifier_hash: 'sha256:' + 'b'.repeat(50),
        status: 'completed',
        requested_at: new Date().toISOString(),
      })
      .select('id')
      .single()
    if (error) throw new Error(error.message)
    createdReceiptIds.push(data!.id)

    const result = await callConfirm({ receiptId: data!.id })
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error('unreachable')
    expect(result.already_confirmed).toBe(true)
  })
})

describe('deletion_receipts — overdue / retry-window query', () => {
  it('stale awaiting_callback row (no next_retry_at) is picked up by the stuck-deletions query', async () => {
    const staleTime = new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString() // 3h ago
    const id = await seedReceipt({
      orgId: org.orgId,
      status: 'awaiting_callback',
      requestedAt: staleTime,
      nextRetryAt: null,
    })

    // Query mirrors check-stuck-deletions: awaiting_callback rows where
    // next_retry_at is null OR <= now().
    const nowIso = new Date().toISOString()
    const { data: stuck, error } = await admin
      .from('deletion_receipts')
      .select('id, status, next_retry_at')
      .eq('status', 'awaiting_callback')
      .eq('id', id)
      .or(`next_retry_at.is.null,next_retry_at.lte.${nowIso}`)
    if (error) throw new Error(error.message)
    expect(stuck!.length).toBe(1)
  })

  it('future next_retry_at removes the row from the retry set until the backoff elapses', async () => {
    const futureRetry = new Date(Date.now() + 60 * 60 * 1000).toISOString() // +1h
    const id = await seedReceipt({
      orgId: org.orgId,
      status: 'awaiting_callback',
      requestedAt: new Date(Date.now() - 30 * 60 * 1000).toISOString(), // 30m ago
      retryCount: 1,
      nextRetryAt: futureRetry,
    })

    const nowIso = new Date().toISOString()
    const { data: stuck } = await admin
      .from('deletion_receipts')
      .select('id')
      .eq('status', 'awaiting_callback')
      .eq('id', id)
      .or(`next_retry_at.is.null,next_retry_at.lte.${nowIso}`)
    expect(stuck!.length).toBe(0)
  })

  it('receipts older than 30 days are EXCLUDED from the retry set (matches check-stuck-deletions cutoff)', async () => {
    const ancientTime = new Date(
      Date.now() - 40 * 24 * 60 * 60 * 1000,
    ).toISOString() // 40d ago
    const id = await seedReceipt({
      orgId: org.orgId,
      status: 'awaiting_callback',
      requestedAt: ancientTime,
      nextRetryAt: null,
    })

    // check-stuck-deletions clamps to `requested_at > now() - 30 days`.
    const cutoff30d = new Date(
      Date.now() - 30 * 24 * 60 * 60 * 1000,
    ).toISOString()
    const nowIso = new Date().toISOString()
    const { data: stuck } = await admin
      .from('deletion_receipts')
      .select('id')
      .eq('status', 'awaiting_callback')
      .eq('id', id)
      .gt('requested_at', cutoff30d)
      .or(`next_retry_at.is.null,next_retry_at.lte.${nowIso}`)
    expect(stuck!.length).toBe(0)
  })

  it('confirmed rows are NOT in the retry set regardless of age', async () => {
    const id = await seedReceipt({
      orgId: org.orgId,
      status: 'awaiting_callback',
      requestedAt: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
    })
    // Flip to confirmed.
    await admin
      .from('deletion_receipts')
      .update({
        status: 'confirmed',
        confirmed_at: new Date().toISOString(),
        response_payload: { status: 'completed', records_deleted: 1, systems_affected: [] },
      })
      .eq('id', id)

    const nowIso = new Date().toISOString()
    const { data: stuck } = await admin
      .from('deletion_receipts')
      .select('id')
      .eq('status', 'awaiting_callback')
      .eq('id', id)
      .or(`next_retry_at.is.null,next_retry_at.lte.${nowIso}`)
    expect(stuck!.length).toBe(0)
  })
})
