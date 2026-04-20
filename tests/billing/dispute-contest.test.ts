import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import {
  AdminTestUser,
  cleanupAdminTestUser,
  createAdminTestUser,
  getAdminServiceClient,
} from '../admin/helpers'
import { cleanupTestOrg, createTestOrg, TestOrg } from '../rls/helpers'

// ADR-0052 Sprint 1.1 — billing_dispute_prepare_contest + mark_contest_submitted.
//
// Lifecycle covered:
//   · prepare_contest refuses without evidence bundle
//   · prepare_contest refuses on resolved dispute (won/lost/closed)
//   · prepare_contest succeeds + stamps metadata + emits audit row
//   · mark_submitted refuses without prepared packet
//   · mark_submitted flips status to under_review + stamps timestamps
//   · support tier denied on both

let operator: AdminTestUser
let support: AdminTestUser
let customer: TestOrg
let disputeId: string

const service = getAdminServiceClient()

beforeAll(async () => {
  operator = await createAdminTestUser('platform_operator')
  support = await createAdminTestUser('support')
  customer = await createTestOrg('disputeContest')
}, 60000)

afterAll(async () => {
  await service.from('disputes').delete().eq('account_id', customer.accountId)
  await service.from('evidence_ledger').delete().eq('account_id', customer.accountId)
  await cleanupTestOrg(customer)
  await cleanupAdminTestUser(operator)
  await cleanupAdminTestUser(support)
}, 30000)

async function seedDispute(bundleKey: string | null) {
  const razorpayDisputeId = `disp_test_${Date.now()}`
  const { data, error } = await service.rpc('rpc_razorpay_dispute_upsert', {
    p_razorpay_dispute_id: razorpayDisputeId,
    p_event_type: 'dispute.created',
    p_razorpay_payment_id: `pay_test_${Date.now()}`,
    p_amount_paise: 100000,
    p_currency: 'INR',
    p_reason_code: 'fraud',
    p_phase: 'chargeback',
    p_deadline_at: new Date(Date.now() + 7 * 86_400_000).toISOString(),
    p_opened_at: new Date().toISOString(),
  })
  if (error) throw new Error(error.message)
  const envelope = data as { dispute_id: string }
  const id = envelope.dispute_id

  // Pin to our test account + optionally set a bundle key
  await service
    .from('disputes')
    .update({
      account_id: customer.accountId,
      evidence_bundle_r2_key: bundleKey,
    })
    .eq('id', id)

  return id
}

describe('ADR-0052 Sprint 1.1 — billing_dispute_prepare_contest', () => {
  it('refuses when no evidence bundle is attached', async () => {
    disputeId = await seedDispute(null)

    const { error } = await operator.client
      .schema('admin')
      .rpc('billing_dispute_prepare_contest', {
        p_dispute_id: disputeId,
        p_summary:
          'Detailed operator summary of why this chargeback is disputed — references bundle exhibits.',
        p_packet_r2_key: null,
      })
    expect(error).not.toBeNull()
    expect(error!.message).toMatch(/no_evidence_bundle/)
  })

  it('succeeds when bundle is attached; stamps summary + timestamps', async () => {
    // Attach a fake bundle key
    await service
      .from('disputes')
      .update({ evidence_bundle_r2_key: 'test-bucket/disputes/test/evidence-1.zip' })
      .eq('id', disputeId)

    const { error } = await operator.client
      .schema('admin')
      .rpc('billing_dispute_prepare_contest', {
        p_dispute_id: disputeId,
        p_summary:
          'Contest summary — this payment was authorised by the account owner; see subscription.activated event in the ledger.',
        p_packet_r2_key: null,
      })
    expect(error).toBeNull()

    const { data } = await service
      .from('disputes')
      .select('contest_summary, contest_packet_r2_key, contest_packet_prepared_at')
      .eq('id', disputeId)
      .single()
    expect(data!.contest_summary).toContain('Contest summary')
    expect(data!.contest_packet_r2_key).toBe('test-bucket/disputes/test/evidence-1.zip')
    expect(data!.contest_packet_prepared_at).not.toBeNull()

    // Audit row
    const { data: auditRow } = await service
      .schema('admin')
      .from('admin_audit_log')
      .select('action, new_value')
      .eq('target_id', disputeId)
      .eq('action', 'billing_dispute_contest_prepared')
      .order('occurred_at', { ascending: false })
      .limit(1)
      .single()
    expect(auditRow!.new_value).toBeTruthy()
  })

  it('refuses on already-resolved dispute', async () => {
    const resolvedId = await seedDispute('test-bucket/disputes/resolved/evidence.zip')
    // Force status = closed
    await service.from('disputes').update({ status: 'closed' }).eq('id', resolvedId)

    const { error } = await operator.client
      .schema('admin')
      .rpc('billing_dispute_prepare_contest', {
        p_dispute_id: resolvedId,
        p_summary: 'This should not succeed — dispute is already closed by Razorpay.',
        p_packet_r2_key: null,
      })
    expect(error).not.toBeNull()
    expect(error!.message).toMatch(/cannot_prepare_contest_from_resolved_status/)
  })

  it('summary too short raises', async () => {
    const { error } = await operator.client
      .schema('admin')
      .rpc('billing_dispute_prepare_contest', {
        p_dispute_id: disputeId,
        p_summary: 'short',
        p_packet_r2_key: null,
      })
    expect(error).not.toBeNull()
    expect(error!.message).toMatch(/at least 20 characters/)
  })

  it('support tier denied', async () => {
    const { error } = await support.client
      .schema('admin')
      .rpc('billing_dispute_prepare_contest', {
        p_dispute_id: disputeId,
        p_summary:
          'Support should not be allowed to prepare a contest packet — this is platform_operator only.',
        p_packet_r2_key: null,
      })
    expect(error).not.toBeNull()
  })
})

describe('ADR-0052 Sprint 1.1 — billing_dispute_mark_contest_submitted', () => {
  it('refuses when packet not prepared', async () => {
    const fresh = await seedDispute('test-bucket/disputes/fresh/evidence.zip')

    const { error } = await operator.client
      .schema('admin')
      .rpc('billing_dispute_mark_contest_submitted', {
        p_dispute_id: fresh,
        p_response: null,
      })
    expect(error).not.toBeNull()
    expect(error!.message).toMatch(/contest_packet_not_prepared/)
  })

  it('manual submit: status flips to under_review + submitted_at stamped + response recorded as manual', async () => {
    // disputeId already has prepare_contest run on it from previous test
    const { error } = await operator.client
      .schema('admin')
      .rpc('billing_dispute_mark_contest_submitted', {
        p_dispute_id: disputeId,
        p_response: null,
      })
    expect(error).toBeNull()

    const { data } = await service
      .from('disputes')
      .select('status, submitted_at, contest_razorpay_response')
      .eq('id', disputeId)
      .single()
    expect(data!.status).toBe('under_review')
    expect(data!.submitted_at).not.toBeNull()
    const resp = data!.contest_razorpay_response as { manual: boolean }
    expect(resp.manual).toBe(true)
  })

  it('auto-submit: records Razorpay response payload', async () => {
    // Seed a new dispute + prepare contest for it
    const autoId = await seedDispute('test-bucket/disputes/auto/evidence.zip')
    await operator.client
      .schema('admin')
      .rpc('billing_dispute_prepare_contest', {
        p_dispute_id: autoId,
        p_summary:
          'Auto-submission test — Razorpay response body recorded as JSON in contest_razorpay_response.',
        p_packet_r2_key: null,
      })

    const mockResponse = {
      id: 'disp_rzp_123',
      entity: 'dispute',
      status: 'under_review',
      contest_api_version: 'v1',
    }

    const { error } = await operator.client
      .schema('admin')
      .rpc('billing_dispute_mark_contest_submitted', {
        p_dispute_id: autoId,
        p_response: mockResponse,
      })
    expect(error).toBeNull()

    const { data } = await service
      .from('disputes')
      .select('contest_razorpay_response')
      .eq('id', autoId)
      .single()
    const resp = data!.contest_razorpay_response as typeof mockResponse
    expect(resp.id).toBe('disp_rzp_123')
  })

  it('support tier denied', async () => {
    const { error } = await support.client
      .schema('admin')
      .rpc('billing_dispute_mark_contest_submitted', {
        p_dispute_id: disputeId,
        p_response: null,
      })
    expect(error).not.toBeNull()
  })
})
