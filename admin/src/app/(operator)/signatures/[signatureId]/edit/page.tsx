import Link from 'next/link'
import { notFound } from 'next/navigation'
import { createServerClient } from '@/lib/supabase/server'
import { SignatureForm } from '@/components/signatures/signature-form'

// ADR-0031 Sprint 2.2 — Tracker signature editor.

export const dynamic = 'force-dynamic'

interface PageProps {
  params: Promise<{ signatureId: string }>
}

export default async function EditSignaturePage({ params }: PageProps) {
  const { signatureId } = await params
  const supabase = await createServerClient()

  const { data, error } = await supabase
    .schema('admin')
    .from('tracker_signature_catalogue')
    .select(
      'id, signature_code, display_name, vendor, signature_type, pattern, category, severity, status, notes',
    )
    .eq('id', signatureId)
    .maybeSingle()

  if (error) {
    return (
      <div className="mx-auto max-w-3xl">
        <h1 className="text-xl font-semibold">Edit signature</h1>
        <p className="mt-4 rounded border border-red-200 bg-red-50 p-4 text-sm text-red-800">
          {error.message}
        </p>
      </div>
    )
  }
  if (!data) notFound()

  if (data.status !== 'active') {
    return (
      <div className="mx-auto max-w-3xl space-y-4">
        <header>
          <p className="text-xs text-text-3">
            <Link href={`/signatures/${signatureId}`} className="hover:underline">
              ← Signature detail
            </Link>
          </p>
          <h1 className="mt-1 text-xl font-semibold">Edit signature</h1>
        </header>
        <p className="rounded border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          Only <strong>active</strong> signatures can be edited. This one is{' '}
          <strong>{data.status}</strong>. Create a new signature to replace it.
        </p>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <header>
        <p className="text-xs text-text-3">
          <Link href={`/signatures/${signatureId}`} className="hover:underline">
            ← {data.display_name}
          </Link>
        </p>
        <h1 className="mt-1 text-xl font-semibold">Edit signature</h1>
      </header>
      <SignatureForm
        mode="edit"
        signatureId={signatureId}
        initial={{
          signatureCode: data.signature_code,
          displayName: data.display_name,
          vendor: data.vendor,
          signatureType: data.signature_type,
          pattern: data.pattern,
          category: data.category,
          severity: data.severity,
          notes: data.notes ?? '',
        }}
      />
    </div>
  )
}
