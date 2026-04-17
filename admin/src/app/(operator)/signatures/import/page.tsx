import Link from 'next/link'
import { ImportPackForm } from '@/components/signatures/import-form'

// ADR-0031 Sprint 2.2 — Tracker signature pack import.
//
// Paste a JSON array of { signature_code, display_name, vendor,
// signature_type, pattern, category, severity, notes } objects. Each
// row is INSERTed with ON CONFLICT (signature_code) DO NOTHING — so
// re-running an import is idempotent.

export const dynamic = 'force-dynamic'

const SAMPLE = `[
  {
    "signature_code": "example_v1",
    "display_name": "Example Tracker",
    "vendor": "Example Inc",
    "signature_type": "script_src",
    "pattern": "/example\\\\.com\\\\/tracker\\\\.js/",
    "category": "analytics",
    "severity": "warn",
    "notes": "Detected on sample sites"
  }
]`

export default function ImportPackPage() {
  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <header>
        <p className="text-xs text-text-3">
          <Link href="/signatures" className="hover:underline">
            ← Tracker Signatures
          </Link>
        </p>
        <h1 className="mt-1 text-xl font-semibold">Import signature pack</h1>
        <p className="text-sm text-text-2">
          Bulk-insert signatures from a JSON array. Existing codes are skipped
          (<code>ON CONFLICT DO NOTHING</code>). Platform-operator only.
        </p>
      </header>

      <section className="rounded-md border border-[color:var(--border)] bg-white p-4 shadow-sm">
        <h2 className="text-sm font-semibold">Expected shape</h2>
        <pre className="mt-2 overflow-x-auto rounded bg-bg p-3 font-mono text-[11px] text-text-2">
          {SAMPLE}
        </pre>
      </section>

      <ImportPackForm />
    </div>
  )
}
