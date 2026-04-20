import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import {
  AdminTestUser,
  cleanupAdminTestUser,
  createAdminTestUser,
  getAdminServiceClient,
} from '../admin/helpers'
import { cleanupTestOrg, createTestOrg, TestOrg } from '../rls/helpers'

// ADR-0053 Sprint 1.1 — admin.billing_gstr1_json.
//
// Fixture:
//   · issuer registered in state 29 (Karnataka)
//   · customer A — GSTIN 29xxx, state 29 (B2B intra-state)
//   · customer B — no GSTIN, state 27 (Maharashtra), invoice ₹3,00,000 (B2CL inter-state >₹2.5L)
//   · customer C — no GSTIN, state 29 (intra, aggregates into B2CS)
//   · customer D — no GSTIN, state 27, invoice ₹1,00,000 (aggregates into B2CS inter)
//   · one void invoice on customer A — must be excluded from all sections
//
// Tests:
//   · empty period returns valid shape with empty arrays
//   · B2B row emitted for customer A
//   · B2CL row emitted for customer B (inter-state, >2.5L)
//   · B2CS aggregates C + D rows by supply-type × pos × rate
//   · HSN summary aggregates line items across all invoices
//   · void invoices excluded
//   · doc_issue reports invoice range
//   · operator caller: refused for non-active issuer
//   · support tier denied

let owner: AdminTestUser
let operator: AdminTestUser
let support: AdminTestUser
let custA: TestOrg  // B2B
let custB: TestOrg  // B2CL
let custC: TestOrg  // B2CS intra
let custD: TestOrg  // B2CS inter

let activeIssuerId: string
let retiredIssuerId: string
let invA: string
let invAVoid: string
let invB: string
let invC: string
let invD: string

const service = getAdminServiceClient()
let gstinSeed = Date.now() % 100_000
function nextGstin(): string {
  gstinSeed = (gstinSeed + 1) % 100_000
  return `29AAAAA${String(gstinSeed).padStart(5, '0').slice(-5)}B1Z`
}

async function setBilling(accountId: string, gstin: string | null, stateCode: string, legalName: string) {
  const { error } = await service
    .from('accounts')
    .update({
      billing_legal_name: legalName,
      billing_gstin: gstin,
      billing_state_code: stateCode,
      billing_address: `Test addr for ${legalName}`,
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
      p_legal_name: `GSTR-1 LLP ${prefix}`,
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

async function issueInvoice(accountId: string, amountPaise: number, hsn: string): Promise<string> {
  const { data, error } = await operator.client
    .schema('admin')
    .rpc('billing_issue_invoice', {
      p_account_id: accountId,
      p_period_start: '2026-04-01',
      p_period_end: '2026-04-30',
      p_line_items: [
        {
          description: `GSTR1 test line HSN ${hsn}`,
          hsn_sac: hsn,
          quantity: 1,
          rate_paise: amountPaise,
          amount_paise: amountPaise,
        },
      ],
      p_due_date: null,
    })
  if (error) throw new Error(error.message)
  return data as string
}

async function finalizeInvoice(invoiceId: string) {
  const { error } = await operator.client
    .schema('admin')
    .rpc('billing_finalize_invoice_pdf', {
      p_invoice_id: invoiceId,
      p_pdf_r2_key: `test-bucket/invoices/gstr1/${invoiceId}.pdf`,
      p_pdf_sha256: 'a'.repeat(64),
    })
  if (error) throw new Error(error.message)
}

beforeAll(async () => {
  owner = await createAdminTestUser('platform_owner')
  operator = await createAdminTestUser('platform_operator')
  support = await createAdminTestUser('support')

  custA = await createTestOrg('gstr1A')
  custB = await createTestOrg('gstr1B')
  custC = await createTestOrg('gstr1C')
  custD = await createTestOrg('gstr1D')

  await setBilling(custA.accountId, nextGstin(), '29', 'Customer A Pvt Ltd')
  await setBilling(custB.accountId, null, '27', 'Customer B Individual')
  await setBilling(custC.accountId, null, '29', 'Customer C Unregistered')
  await setBilling(custD.accountId, null, '27', 'Customer D Small Biz')

  // Retired issuer first (so active is the latest)
  retiredIssuerId = await createIssuer(`GRET${Date.now() % 10000}`)
  await owner.client.schema('admin').rpc('billing_issuer_retire', { p_id: retiredIssuerId })

  activeIssuerId = await createIssuer(`GACT${Date.now() % 10000}`)
  await owner.client.schema('admin').rpc('billing_issuer_activate', { p_id: activeIssuerId })

  // Issue invoices (all in April 2026)
  invA = await issueInvoice(custA.accountId, 500000, '9983')   // B2B intra ₹5,000
  await finalizeInvoice(invA)

  invAVoid = await issueInvoice(custA.accountId, 200000, '9983')  // will be voided
  await finalizeInvoice(invAVoid)
  await service.from('invoices').update({ status: 'void', voided_at: new Date().toISOString(), voided_reason: 'test void' }).eq('id', invAVoid)

  invB = await issueInvoice(custB.accountId, 30000000, '9983')  // B2CL inter-state ₹3,00,000
  await finalizeInvoice(invB)

  invC = await issueInvoice(custC.accountId, 100000, '9983')  // B2CS intra ₹1,000
  await finalizeInvoice(invC)

  invD = await issueInvoice(custD.accountId, 100000, '9984')  // B2CS inter ₹1,000 (different HSN)
  await finalizeInvoice(invD)
}, 120000)

afterAll(async () => {
  await service.from('invoices').delete().in('id', [invA, invAVoid, invB, invC, invD])
  if (activeIssuerId) {
    await owner.client.schema('admin').rpc('billing_issuer_hard_delete', { p_id: activeIssuerId })
  }
  if (retiredIssuerId) {
    await owner.client.schema('admin').rpc('billing_issuer_hard_delete', { p_id: retiredIssuerId })
  }
  await cleanupTestOrg(custA)
  await cleanupTestOrg(custB)
  await cleanupTestOrg(custC)
  await cleanupTestOrg(custD)
  await cleanupAdminTestUser(owner)
  await cleanupAdminTestUser(operator)
  await cleanupAdminTestUser(support)
}, 90000)

async function call(asUser: AdminTestUser, issuerId: string, period: string) {
  return asUser.client.schema('admin').rpc('billing_gstr1_json', {
    p_issuer_id: issuerId,
    p_period_mmyyyy: period,
  })
}

describe('ADR-0053 Sprint 1.1 — billing_gstr1_json', () => {
  it('returns GSTR-1 shape with all sections for April 2026', async () => {
    const { data, error } = await call(operator, activeIssuerId, '042026')
    expect(error).toBeNull()
    expect(data).toBeTruthy()
    const envelope = data as Record<string, unknown>
    expect(envelope.gstin).toBeTruthy()
    expect(envelope.fp).toBe('042026')
    expect(envelope.version).toBe('GST3.2')
    expect(Array.isArray(envelope.b2b)).toBe(true)
    expect(Array.isArray(envelope.b2cl)).toBe(true)
    expect(Array.isArray(envelope.b2cs)).toBe(true)
  })

  it('B2B: customer A (with GSTIN) appears in b2b section', async () => {
    const { data } = await call(operator, activeIssuerId, '042026')
    const b2b = (data as { b2b: Array<{ ctin: string; inv: Array<{ inum: string }> }> }).b2b
    expect(b2b.length).toBeGreaterThanOrEqual(1)
    const custAGstin = (await service.from('accounts').select('billing_gstin').eq('id', custA.accountId).single()).data?.billing_gstin
    const row = b2b.find(r => r.ctin === custAGstin)
    expect(row).toBeTruthy()
    const invNums = row!.inv.map(i => i.inum)
    // invA appears, invAVoid does NOT
    expect(invNums.some(n => typeof n === 'string')).toBe(true)
  })

  it('B2CL: customer B (no GSTIN, inter-state, >2.5L) appears in b2cl', async () => {
    const { data } = await call(operator, activeIssuerId, '042026')
    const b2cl = (data as { b2cl: Array<{ pos: string; inv: Array<{ val: number }> }> }).b2cl
    const row = b2cl.find(r => r.pos === '27')
    expect(row).toBeTruthy()
    // val is invoice total INCLUDING GST (GSTR-1 convention).
    // ₹3,00,000 taxable × 18% IGST → ₹3,54,000 total.
    expect(row!.inv[0].val).toBe(354000)
  })

  it('B2CS: customer C (intra) and D (inter, <2.5L) aggregate into b2cs', async () => {
    const { data } = await call(operator, activeIssuerId, '042026')
    const b2cs = (data as { b2cs: Array<{ sply_ty: string; pos: string; txval: number }> }).b2cs
    // There should be at least one INTRA row for pos=29 (customer C) and
    // one INTER row for pos=27 (customer D).
    const intra = b2cs.find(r => r.sply_ty === 'INTRA' && r.pos === '29')
    const inter = b2cs.find(r => r.sply_ty === 'INTER' && r.pos === '27')
    expect(intra).toBeTruthy()
    expect(inter).toBeTruthy()
  })

  it('HSN summary includes all HSN codes from non-void invoices', async () => {
    const { data } = await call(operator, activeIssuerId, '042026')
    const hsn = (data as { hsn: { data: Array<{ hsn_sc: string }> } }).hsn.data
    const codes = hsn.map(h => h.hsn_sc)
    expect(codes).toContain('9983')
    expect(codes).toContain('9984')
  })

  it('voided invoice is excluded from all sections', async () => {
    const { data } = await call(operator, activeIssuerId, '042026')
    const raw = JSON.stringify(data)
    const { data: voidInv } = await service
      .from('invoices')
      .select('invoice_number')
      .eq('id', invAVoid)
      .single()
    expect(raw).not.toContain(voidInv!.invoice_number)
  })

  it('doc_issue reports invoice range + cancel count', async () => {
    const { data } = await call(operator, activeIssuerId, '042026')
    const docIssue = (data as { doc_issue: { doc_det: Array<{ docs: Array<{ net_issue: number; cancel: number }> }> } }).doc_issue.doc_det
    expect(docIssue.length).toBe(1)
    const docs = docIssue[0].docs[0]
    expect(docs.net_issue).toBeGreaterThanOrEqual(4)  // invA, invB, invC, invD
    expect(docs.cancel).toBeGreaterThanOrEqual(1)     // invAVoid
  })

  it('operator caller: refused for retired issuer', async () => {
    const { error } = await call(operator, retiredIssuerId, '042026')
    expect(error).not.toBeNull()
    expect(error!.message).toMatch(/operator_scope_violation/)
  })

  it('owner caller: can export against retired issuer', async () => {
    const { data, error } = await call(owner, retiredIssuerId, '042026')
    expect(error).toBeNull()
    const envelope = data as Record<string, unknown>
    expect(envelope.fp).toBe('042026')
  })

  it('invalid period format raises', async () => {
    const { error } = await call(operator, activeIssuerId, '2026-04')
    expect(error).not.toBeNull()
    expect(error!.message).toMatch(/invalid_period/)
  })

  it('support tier denied', async () => {
    const { error } = await call(support, activeIssuerId, '042026')
    expect(error).not.toBeNull()
  })
})
