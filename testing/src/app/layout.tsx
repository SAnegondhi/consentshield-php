import type { Metadata } from 'next'
import Link from 'next/link'
import './globals.css'

export const metadata: Metadata = {
  title: {
    default: 'ConsentShield — Testing & Verification',
    template: '%s · ConsentShield Testing'
  },
  description:
    'Public index of ConsentShield end-to-end test runs — date, commit, pass/fail counts, mutation score, sealed-evidence archives. Auditor-facing by design.',
  metadataBase: new URL('https://testing.consentshield.in'),
  robots: { index: true, follow: true },
  alternates: {
    types: {
      'application/rss+xml': '/feed.xml'
    }
  }
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen flex flex-col bg-white text-ink">
        <header className="border-b border-slate-200">
          <div className="mx-auto max-w-6xl px-6 py-4 flex items-center justify-between gap-6">
            <Link href="/" className="flex items-center gap-2 text-navy font-semibold">
              <span className="inline-block w-2 h-2 rounded-full bg-teal" aria-hidden />
              ConsentShield · Testing
            </Link>
            <nav className="flex items-center gap-6 text-sm text-slate-700">
              <Link href="/" className="hover:text-ink">Runs</Link>
              <Link href="/about" className="hover:text-ink">About</Link>
              <Link href="/feed.xml" className="hover:text-ink">RSS</Link>
              <a
                href="https://consentshield.in/docs/test-verification"
                className="hover:text-ink"
                target="_blank"
                rel="noopener noreferrer"
              >
                Reproduce
              </a>
            </nav>
          </div>
        </header>
        <main className="flex-1">
          <div className="mx-auto max-w-6xl px-6 py-10">{children}</div>
        </main>
        <footer className="border-t border-slate-200 mt-10">
          <div className="mx-auto max-w-6xl px-6 py-6 text-sm text-slate-500 flex flex-col sm:flex-row justify-between gap-2">
            <span>
              (c) 2026 Sudhindra Anegondhi · ConsentShield. Evidence archives are content-hashed
              and verifiable via <code className="text-slate-700">scripts/e2e-verify-evidence.ts</code>.
            </span>
            <span>
              Publication index governed by{' '}
              <a
                className="underline hover:text-ink"
                href="https://github.com/aiSpirit-systems/consentshield/blob/main/docs/ADRs/ADR-1014-e2e-test-harness-and-vertical-demos.md"
                target="_blank"
                rel="noopener noreferrer"
              >
                ADR-1014
              </a>
              .
            </span>
          </div>
        </footer>
      </body>
    </html>
  )
}
