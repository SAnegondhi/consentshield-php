import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import {
  AdminTestUser,
  cleanupAdminTestUser,
  createAdminTestUser,
  getAdminServiceClient,
} from '../admin/helpers'
import { cleanupTestOrg, createTestOrg, TestOrg } from '../rls/helpers'

// ADR-0054 Sprint 1.1 — Customer billing portal read-path RPCs:
//   public.list_account_invoices()
//   public.get_account_billing_profile()
//   public.get_account_invoice_pdf_key(uuid)
//
// Scope rules tested:
//   · account_owner can call all three; returns caller's account's data only
//   · Cross-account: caller cannot see another account's invoices (list returns
//     only caller's rows; pdf_key lookup raises)
//   · Voided invoice: list includes it with status='void'; pdf_key RPC raises
//   · Non-existent invoice id: pdf_key RPC raises same error as cross-account
//     (no existence leak)

let owner: AdminTestUser
let operator: AdminTestUser
let accountA: TestOrg
let accountB: TestOrg
let issuerId: string
let invoicePaidIdA: string
let invoiceVoidIdA: string
let invoicePaidIdB: string

const service = getAdminServiceClient()
let gstinSeed = Date.now() % 100_000
function nextGstin(): string {
  gstinSeed = (gstinSeed + 1) % 100_000
  return `29AAAAA${String(gstinSeed).padStart(5, '0').slice(-5)}B1Z`
}

async function setAccountBilling(accountId: string, legalName: string, stateCode: string) {
  const { error } = await service
    .from('accounts')
    .update({
      billing_legal_name: legalName,
      billing_gstin: null,
      billing_state_code: stateCode,
      billing_address: `Test address for ${legalName}`,
      billing_email: `${legalName.replace(/[^A-Za-z0-9]/g, '').toLowerCase()}@test.consentshield.in`,
      billing_profile_updated_at: new Date().toISOString(),
    })
    .eq('id', accountId)
  if (error) throw new Error(`setAccountBilling: ${error.message}`)
}

async function createIssuer(prefix: string): Promise<string> {
  const { data, error } = await owner.client
    .schema('admin')
    .rpc('billing_issuer_create', {
      p_legal_name: `Customer Reads Test LLP ${prefix}`,
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
  if (error) throw new Error(`createIssuer: ${error.message}`)
  return data as string
}

async function issueInvoice(accountId: string, periodStart: string, periodEnd: string): Promise<string> {
  const { data, error } = await operator.client
    .schema('admin')
    .rpc('billing_issue_invoice', {
      p_account_id: accountId,
      p_period_start: periodStart,
      p_period_end: periodEnd,
      p_line_items: [
        { description: 'Customer reads test line', hsn_sac: '9983', quantity: 1, rate_paise: 500000, amount_paise: 500000 },
      ],
      p_due_date: null,
    })
  if (error) throw new Error(`issueInvoice: ${error.message}`)
  return data as string
}

async function finalizeInvoice(invoiceId: string) {
  const { error } = await operator.client
    .schema('admin')
    .rpc('billing_finalize_invoice_pdf', {
      p_invoice_id: invoiceId,
      p_pdf_r2_key: `test-bucket/invoices/customer-reads/${invoiceId}.pdf`,
      p_pdf_sha256: 'a'.repeat(64),
    })
  if (error) throw new Error(`finalizeInvoice: ${error.message}`)
}

async function voidInvoice(invoiceId: string) {
  // Direct service-role update since there may not be an admin "void" RPC
  const { error } = await service
    .from('invoices')
    .update({ status: 'void', voided_at: new Date().toISOString(), voided_reason: 'test void' })
    .eq('id', invoiceId)
  if (error) throw new Error(`voidInvoice: ${error.message}`)
}

beforeAll(async () => {
  owner = await createAdminTestUser('platform_owner')
  operator = await createAdminTestUser('platform_operator')
  accountA = await createTestOrg('custA')
  accountB = await createTestOrg('custB')

  await setAccountBilling(accountA.accountId, 'Customer A Pvt Ltd', '29')
  await setAccountBilling(accountB.accountId, 'Customer B Pvt Ltd', '27')

  // Note: use a unique issuer per test run (GST tests keep issuers around)
  issuerId = await createIssuer(`CR${Date.now() % 10000}`)
  // Activate — billing_issue_invoice requires an active issuer
  const activateRes = await owner.client
    .schema('admin')
    .rpc('billing_issuer_activate', { p_id: issuerId })
  if (activateRes.error) throw new Error(`activate: ${activateRes.error.message}`)

  invoicePaidIdA = await issueInvoice(accountA.accountId, '2026-04-01', '2026-04-30')
  await finalizeInvoice(invoicePaidIdA)

  invoiceVoidIdA = await issueInvoice(accountA.accountId, '2026-03-01', '2026-03-31')
  await finalizeInvoice(invoiceVoidIdA)
  await voidInvoice(invoiceVoidIdA)

  invoicePaidIdB = await issueInvoice(accountB.accountId, '2026-04-01', '2026-04-30')
  await finalizeInvoice(invoicePaidIdB)
}, 90000)

afterAll(async () => {
  await service.from('invoices').delete().in('id', [invoicePaidIdA, invoiceVoidIdA, invoicePaidIdB])
  // Issuer cleanup via owner RPC
  if (issuerId) {
    await owner.client.schema('admin').rpc('billing_issuer_hard_delete', { p_id: issuerId })
  }
  await cleanupTestOrg(accountA)
  await cleanupTestOrg(accountB)
  await cleanupAdminTestUser(owner)
  await cleanupAdminTestUser(operator)
}, 60000)

describe('ADR-0054 Sprint 1.1 — list_account_invoices', () => {
  it('account_owner sees only their own account invoices', async () => {
    const { data, error } = await accountA.client.rpc('list_account_invoices')
    expect(error).toBeNull()
    expect(Array.isArray(data)).toBe(true)

    const rows = data as Array<{ id: string; account_legal_name: string; status: string }>
    const ids = rows.map(r => r.id)
    expect(ids).toContain(invoicePaidIdA)
    expect(ids).toContain(invoiceVoidIdA)
    expect(ids).not.toContain(invoicePaidIdB)
    rows.forEach(r => expect(r.account_legal_name).toBe('Customer A Pvt Ltd'))
  })

  it('accountB cannot see accountA invoices', async () => {
    const { data, error } = await accountB.client.rpc('list_account_invoices')
    expect(error).toBeNull()
    const rows = data as Array<{ id: string }>
    const ids = rows.map(r => r.id)
    expect(ids).toContain(invoicePaidIdB)
    expect(ids).not.toContain(invoicePaidIdA)
    expect(ids).not.toContain(invoiceVoidIdA)
  })

  it('includes void invoices with status=void', async () => {
    const { data } = await accountA.client.rpc('list_account_invoices')
    const rows = data as Array<{ id: string; status: string }>
    const voidRow = rows.find(r => r.id === invoiceVoidIdA)
    expect(voidRow).toBeTruthy()
    expect(voidRow!.status).toBe('void')
  })
})

describe('ADR-0054 Sprint 1.1 — get_account_billing_profile', () => {
  it('account_owner gets their own billing profile', async () => {
    const { data, error } = await accountA.client.rpc('get_account_billing_profile')
    expect(error).toBeNull()
    const p = data as {
      account_id: string
      billing_legal_name: string
      billing_state_code: string
      role: string
    }
    expect(p.account_id).toBe(accountA.accountId)
    expect(p.billing_legal_name).toBe('Customer A Pvt Ltd')
    expect(p.billing_state_code).toBe('29')
    expect(p.role).toBe('account_owner')
  })

  it('isolated per account — accountB gets B\'s profile', async () => {
    const { data } = await accountB.client.rpc('get_account_billing_profile')
    const p = data as { account_id: string; billing_legal_name: string }
    expect(p.account_id).toBe(accountB.accountId)
    expect(p.billing_legal_name).toBe('Customer B Pvt Ltd')
  })
})

describe('ADR-0054 Sprint 1.1 — get_account_invoice_pdf_key', () => {
  it('account_owner can resolve their own invoice pdf key', async () => {
    const { data, error } = await accountA.client.rpc('get_account_invoice_pdf_key', {
      p_invoice_id: invoicePaidIdA,
    })
    expect(error).toBeNull()
    const envelope = data as { pdf_r2_key: string; status: string }
    expect(envelope.pdf_r2_key).toMatch(/^test-bucket\/invoices\//)
    expect(envelope.status).toBe('issued')
  })

  it('cannot resolve another account\'s invoice pdf', async () => {
    const { error } = await accountA.client.rpc('get_account_invoice_pdf_key', {
      p_invoice_id: invoicePaidIdB,
    })
    expect(error).not.toBeNull()
    expect(error!.message).toMatch(/invoice_not_found/)
  })

  it('voided invoice raises invoice_void', async () => {
    const { error } = await accountA.client.rpc('get_account_invoice_pdf_key', {
      p_invoice_id: invoiceVoidIdA,
    })
    expect(error).not.toBeNull()
    expect(error!.message).toMatch(/invoice_void/)
  })

  it('non-existent uuid raises invoice_not_found', async () => {
    const { error } = await accountA.client.rpc('get_account_invoice_pdf_key', {
      p_invoice_id: '00000000-0000-0000-0000-000000000000',
    })
    expect(error).not.toBeNull()
    expect(error!.message).toMatch(/invoice_not_found/)
  })
})
