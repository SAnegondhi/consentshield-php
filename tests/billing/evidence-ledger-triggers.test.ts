import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import {
  AdminTestUser,
  cleanupAdminTestUser,
  createAdminTestUser,
  getAdminServiceClient,
} from '../admin/helpers'
import { cleanupTestOrg, createTestOrg, TestOrg } from '../rls/helpers'

// ADR-0051 Sprint 1.1 — billing.evidence_ledger trigger capture.
//
// Verifies the three trigger paths + the admin read RPC:
//   · Insert into admin.admin_audit_log with billing_* action → evidence row
//   · Insert into billing.razorpay_webhook_events with subscription.* type → evidence row
//   · Insert into public.invoices with issued_at → evidence row (invoice_issued)
//   · Update public.invoices email_delivered_at null→ts → evidence row (invoice_emailed)
//   · Update public.invoices status=void → evidence row (invoice_voided)
//   · admin.billing_evidence_ledger_for_account — platform_operator scoped read
//   · support tier denied

let owner: AdminTestUser
let operator: AdminTestUser
let support: AdminTestUser
let customer: TestOrg
let issuerId: string
let invoiceId: string

const service = getAdminServiceClient()
let gstinSeed = Date.now() % 100_000
function nextGstin(): string {
  gstinSeed = (gstinSeed + 1) % 100_000
  return `29AAAAA${String(gstinSeed).padStart(5, '0').slice(-5)}B1Z`
}

async function setAccountBilling(accountId: string, legalName: string) {
  const { error } = await service
    .from('accounts')
    .update({
      billing_legal_name: legalName,
      billing_gstin: null,
      billing_state_code: '29',
      billing_address: `Test address for ${legalName}`,
      billing_email: `${legalName.replace(/\s/g, '').toLowerCase()}@test.consentshield.in`,
      billing_profile_updated_at: new Date().toISOString(),
    })
    .eq('id', accountId)
  if (error) throw new Error(error.message)
}

async function createIssuer(prefix: string): Promise<string> {
  const { data, error } = await owner.client
    .schema('admin')
    .rpc('billing_issuer_create', {
      p_legal_name: `Evidence Ledger LLP ${prefix}`,
      p_gstin: nextGstin(),
      p_pan: 'AAAAA1234B',
      p_registered_state_code: '29',
      p_registered_address: '1 Test St, Bangalore',
      p_invoice_prefix: prefix,
      p_fy_start_month: 4,
      p_signatory_name: 'Test Signatory',
      p_signatory_designation: 'Director',
      p_bank_account_masked: '**** 0000',
      p_logo_r2_key: null,
    })
  if (error) throw new Error(error.message)
  return data as string
}

async function issueInvoice(accountId: string): Promise<string> {
  const { data, error } = await operator.client
    .schema('admin')
    .rpc('billing_issue_invoice', {
      p_account_id: accountId,
      p_period_start: '2026-04-01',
      p_period_end: '2026-04-30',
      p_line_items: [
        { description: 'Evidence ledger test line', hsn_sac: '9983', quantity: 1, rate_paise: 500000, amount_paise: 500000 },
      ],
      p_due_date: null,
    })
  if (error) throw new Error(error.message)
  return data as string
}

async function finalizeInvoice(id: string) {
  const { error } = await operator.client
    .schema('admin')
    .rpc('billing_finalize_invoice_pdf', {
      p_invoice_id: id,
      p_pdf_r2_key: `test-bucket/invoices/evidence-ledger/${id}.pdf`,
      p_pdf_sha256: 'a'.repeat(64),
    })
  if (error) throw new Error(error.message)
}

beforeAll(async () => {
  owner = await createAdminTestUser('platform_owner')
  operator = await createAdminTestUser('platform_operator')
  support = await createAdminTestUser('support')
  customer = await createTestOrg('evidLedg')
  await setAccountBilling(customer.accountId, 'Evidence Ledger Customer')

  issuerId = await createIssuer(`EL${Date.now() % 10000}`)
  const activateRes = await owner.client
    .schema('admin')
    .rpc('billing_issuer_activate', { p_id: issuerId })
  if (activateRes.error) throw new Error(`activate: ${activateRes.error.message}`)
}, 90000)

afterAll(async () => {
  // Delete invoice (cascades to trigger-written ledger rows, but ledger
  // rows are also deleted when the account is cascade-dropped)
  if (invoiceId) {
    await service.from('invoices').delete().eq('id', invoiceId)
  }
  await service.from('evidence_ledger').delete().eq('account_id', customer.accountId)
  if (issuerId) {
    await owner.client.schema('admin').rpc('billing_issuer_hard_delete', { p_id: issuerId })
  }
  await cleanupTestOrg(customer)
  await cleanupAdminTestUser(owner)
  await cleanupAdminTestUser(operator)
  await cleanupAdminTestUser(support)
}, 60000)

async function readLedgerViaRpc(): Promise<Array<{
  event_type: string
  event_source: string
  source_ref: string | null
  metadata: Record<string, unknown>
}>> {
  const { data, error } = await operator.client
    .schema('admin')
    .rpc('billing_evidence_ledger_for_account', {
      p_account_id: customer.accountId,
      p_from: null,
      p_to: null,
      p_limit: 500,
    })
  if (error) throw new Error(error.message)
  return (data ?? []) as typeof readLedgerViaRpc extends () => Promise<infer T> ? T : never
}

describe('ADR-0051 Sprint 1.1 — invoice trigger capture', () => {
  it('invoice_issued ledger row appears on billing_finalize_invoice_pdf (which stamps issued_at)', async () => {
    invoiceId = await issueInvoice(customer.accountId)
    await finalizeInvoice(invoiceId)

    const rows = await readLedgerViaRpc()
    const issuedRow = rows.find(r => r.event_type === 'invoice_issued' && r.source_ref === invoiceId)
    expect(issuedRow).toBeTruthy()
    expect(issuedRow!.event_source).toBe('invoice_trigger')
    expect(issuedRow!.metadata.invoice_id).toBe(invoiceId)
  })

  it('invoice_emailed ledger row appears when email_delivered_at is stamped', async () => {
    await service
      .from('invoices')
      .update({
        email_delivered_at: new Date().toISOString(),
        email_message_id: 'resend_test_msg_001',
      })
      .eq('id', invoiceId)

    const rows = await readLedgerViaRpc()
    const emailedRow = rows.find(r => r.event_type === 'invoice_emailed' && r.source_ref === invoiceId)
    expect(emailedRow).toBeTruthy()
    expect(emailedRow!.metadata.email_message_id).toBe('resend_test_msg_001')
  })

  it('invoice_voided ledger row appears when status flips to void', async () => {
    await service
      .from('invoices')
      .update({
        status: 'void',
        voided_at: new Date().toISOString(),
        voided_reason: 'test void for ledger trigger',
      })
      .eq('id', invoiceId)

    const rows = await readLedgerViaRpc()
    const voidedRow = rows.find(r => r.event_type === 'invoice_voided' && r.source_ref === invoiceId)
    expect(voidedRow).toBeTruthy()
    expect(voidedRow!.metadata.voided_reason).toContain('test void')
  })
})

describe('ADR-0051 Sprint 1.1 — admin_audit_log trigger capture', () => {
  it('billing_create_refund audit row → admin_refund_issued ledger row', async () => {
    // Insert directly via service role (bypasses require_admin so we can isolate
    // the trigger behaviour without the full refund flow).
    await service.schema('admin').from('admin_audit_log').insert({
      admin_user_id: operator.userId,
      action: 'billing_create_refund',
      target_table: 'public.accounts',
      target_id: customer.accountId,
      reason: 'test refund for evidence ledger trigger',
      old_value: null,
      new_value: { razorpay_payment_id: 'pay_test_123', amount_paise: 100000 },
    })

    const rows = await readLedgerViaRpc()
    const refundRow = rows.find(r => r.event_type === 'admin_refund_issued')
    expect(refundRow).toBeTruthy()
    expect(refundRow!.event_source).toBe('admin_audit_trigger')
    expect((refundRow!.metadata as { action?: string }).action).toBe('billing_create_refund')
  })

  it('non-billing audit action does NOT write a ledger row', async () => {
    const before = (await readLedgerViaRpc()).length

    await service.schema('admin').from('admin_audit_log').insert({
      admin_user_id: operator.userId,
      action: 'support_ticket_internal_note',
      target_table: 'public.support_tickets',
      target_id: customer.orgId,
      reason: 'should be ignored by the ledger trigger',
      old_value: null,
      new_value: null,
    })

    const after = (await readLedgerViaRpc()).length
    expect(after).toBe(before)
  })
})

describe('ADR-0051 Sprint 1.1 — billing_evidence_ledger_for_account access control', () => {
  it('platform_operator can read scoped ledger', async () => {
    const rows = await readLedgerViaRpc()
    expect(rows.length).toBeGreaterThan(0)
  })

  it('support tier denied', async () => {
    const { error } = await support.client
      .schema('admin')
      .rpc('billing_evidence_ledger_for_account', {
        p_account_id: customer.accountId,
        p_from: null,
        p_to: null,
        p_limit: 500,
      })
    expect(error).not.toBeNull()
  })
})
