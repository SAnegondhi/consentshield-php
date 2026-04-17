import Link from 'next/link'
import { SignatureForm } from '@/components/signatures/signature-form'

// ADR-0031 Sprint 2.2 — New tracker signature.

export const dynamic = 'force-dynamic'

export default function NewSignaturePage() {
  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <header>
        <p className="text-xs text-text-3">
          <Link href="/signatures" className="hover:underline">
            ← Tracker Signatures
          </Link>
        </p>
        <h1 className="mt-1 text-xl font-semibold">New tracker signature</h1>
        <p className="text-sm text-text-2">
          Goes live as active. Syncs to Cloudflare KV within 2 minutes.
        </p>
      </header>

      <SignatureForm mode="create" />
    </div>
  )
}
