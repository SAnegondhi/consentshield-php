import Link from 'next/link'
import { notFound } from 'next/navigation'
import { createServerClient } from '@/lib/supabase/server'
import { SignatureDetailActions } from '@/components/signatures/detail-actions'

// ADR-0031 Sprint 2.1 — Tracker Signature detail page.

export const dynamic = 'force-dynamic'

interface Signature {
  id: string
  signature_code: string
  display_name: string
  vendor: string
  signature_type: string
  pattern: string
  category: string
  severity: 'info' | 'warn' | 'critical'
  status: 'active' | 'deprecated'
  notes: string | null
  created_at: string
  created_by: string
}

interface PageProps {
  params: Promise<{ signatureId: string }>
}

export default async function SignatureDetailPage({ params }: PageProps) {
  const { signatureId } = await params
  const supabase = await createServerClient()

  const { data, error } = await supabase
    .schema('admin')
    .from('tracker_signature_catalogue')
    .select(
      'id, signature_code, display_name, vendor, signature_type, pattern, category, severity, status, notes, created_at, created_by',
    )
    .eq('id', signatureId)
    .maybeSingle()

  if (error) {
    return (
      <div className="mx-auto max-w-4xl">
        <h1 className="text-xl font-semibold">Tracker Signature</h1>
        <p className="mt-4 rounded border border-red-200 bg-red-50 p-4 text-sm text-red-800">
          {error.message}
        </p>
      </div>
    )
  }
  if (!data) notFound()

  const sig = data as Signature

  const { data: creator } = await supabase
    .schema('admin')
    .from('admin_users')
    .select('display_name')
    .eq('id', sig.created_by)
    .maybeSingle()

  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <header className="flex items-start justify-between">
        <div>
          <p className="text-xs text-text-3">
            <Link href="/signatures" className="hover:underline">
              ← Tracker Signatures
            </Link>
          </p>
          <h1 className="mt-1 text-xl font-semibold">{sig.display_name}</h1>
          <p className="mt-1 font-mono text-xs text-text-3">
            {sig.signature_code} · {sig.vendor}
          </p>
        </div>
        <div className="flex flex-col items-end gap-1">
          <StatusPill status={sig.status} />
          <SeverityPill severity={sig.severity} />
        </div>
      </header>

      <section className="grid grid-cols-1 gap-3 md:grid-cols-3">
        <InfoTile label="Type">{sig.signature_type}</InfoTile>
        <InfoTile label="Category">{sig.category}</InfoTile>
        <InfoTile label="Created">
          {new Date(sig.created_at).toLocaleDateString()}
          <br />
          <span className="text-xs text-text-3">
            {creator?.display_name ?? sig.created_by.slice(0, 8)}
          </span>
        </InfoTile>
      </section>

      <section className="rounded-md border border-[color:var(--border)] bg-white p-4 shadow-sm">
        <h2 className="text-sm font-semibold">Pattern</h2>
        <pre className="mt-2 overflow-x-auto rounded bg-bg p-3 font-mono text-xs text-text">
          {sig.pattern}
        </pre>
      </section>

      {sig.notes ? (
        <section className="rounded-md border border-[color:var(--border)] bg-white p-4 shadow-sm">
          <h2 className="text-sm font-semibold">Notes (operator-only)</h2>
          <p className="mt-2 whitespace-pre-wrap text-sm text-text-2">
            {sig.notes}
          </p>
        </section>
      ) : null}

      <section className="rounded-md border border-[color:var(--border)] bg-white p-4 shadow-sm">
        <h2 className="mb-3 text-sm font-semibold">Actions</h2>
        <SignatureDetailActions signatureId={sig.id} status={sig.status} />
      </section>
    </div>
  )
}

function StatusPill({ status }: { status: 'active' | 'deprecated' }) {
  return status === 'active' ? (
    <span className="rounded-full bg-green-100 px-3 py-1 text-xs font-medium text-green-700">
      active
    </span>
  ) : (
    <span className="rounded-full bg-[color:var(--border)] px-3 py-1 text-xs font-medium text-text-2">
      deprecated
    </span>
  )
}

function SeverityPill({ severity }: { severity: 'info' | 'warn' | 'critical' }) {
  const classes =
    severity === 'critical'
      ? 'rounded-full bg-red-100 px-3 py-1 text-xs font-medium text-red-700'
      : severity === 'warn'
        ? 'rounded-full bg-amber-100 px-3 py-1 text-xs font-medium text-amber-800'
        : 'rounded-full bg-[color:var(--border)] px-3 py-1 text-xs font-medium text-text-2'
  return <span className={classes}>{severity}</span>
}

function InfoTile({
  label,
  children,
}: {
  label: string
  children: React.ReactNode
}) {
  return (
    <div className="rounded-md border border-[color:var(--border)] bg-white p-3 shadow-sm">
      <p className="text-xs font-medium uppercase tracking-wider text-text-3">
        {label}
      </p>
      <p className="mt-1 text-sm capitalize text-text">{children}</p>
    </div>
  )
}
