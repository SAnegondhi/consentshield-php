import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { presignGet } from '@/lib/storage/sigv4'

// ADR-0054 Sprint 1.1 — Customer-facing invoice PDF download.
//
// Flow:
//   1. authenticate caller via the customer supabase server client
//   2. call get_account_invoice_pdf_key(p_invoice_id) RPC — the RPC enforces
//      account scope and role (account_owner / account_viewer only)
//   3. presign an R2 GET URL for the returned pdf_r2_key (15-minute TTL)
//   4. 302 redirect to the presigned URL
//
// The RPC raises on:
//   - wrong role (access_denied)
//   - no account context (no_account_context)
//   - wrong account (invoice_not_found — same as "not found", no enumeration)
//   - voided invoice (invoice_void)
//   - missing pdf key (invoice_pdf_unavailable)

const R2_ERRORS = {
  CONFIG_MISSING: 'R2 credentials missing: set R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_INVOICES_BUCKET',
}

function loadR2Config() {
  const accountId = process.env.R2_ACCOUNT_ID
  const accessKeyId = process.env.R2_ACCESS_KEY_ID
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY
  const bucket = process.env.R2_INVOICES_BUCKET
  if (!accountId || !accessKeyId || !secretAccessKey || !bucket) {
    throw new Error(R2_ERRORS.CONFIG_MISSING)
  }
  return {
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
    region: 'auto',
    bucket,
    accessKeyId,
    secretAccessKey,
  }
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ invoiceId: string }> },
) {
  const { invoiceId } = await params
  const supabase = await createServerClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { data, error } = await supabase.rpc('get_account_invoice_pdf_key', {
    p_invoice_id: invoiceId,
  })

  if (error) {
    const msg = error.message ?? 'pdf download failed'
    const status =
      msg.includes('access_denied') || msg.includes('no_account_context')
        ? 403
        : msg.includes('not_found') || msg.includes('void') || msg.includes('unavailable')
          ? 404
          : 500
    return NextResponse.json({ error: msg }, { status })
  }

  const envelope = data as {
    pdf_r2_key: string
    invoice_number: string
    status: string
  }

  let presignedUrl: string
  try {
    const cfg = loadR2Config()
    const prefix = `${cfg.bucket}/`
    const key = envelope.pdf_r2_key.startsWith(prefix)
      ? envelope.pdf_r2_key.slice(prefix.length)
      : envelope.pdf_r2_key
    presignedUrl = presignGet({
      endpoint: cfg.endpoint,
      region: cfg.region,
      bucket: cfg.bucket,
      key,
      accessKeyId: cfg.accessKeyId,
      secretAccessKey: cfg.secretAccessKey,
      expiresIn: 900,
    })
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'presign failed'
    return NextResponse.json({ error: msg }, { status: 500 })
  }

  return NextResponse.redirect(presignedUrl, { status: 302 })
}
