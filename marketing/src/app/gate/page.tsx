// ADR-0502 Sprint 1.3 — gate entry surface.
//
// Server component reads `?from=<path>` so a successful verify returns
// the visitor where they originally tried to go. Wireframe spec at
// docs/design/marketing-gate-otp-wireframe.md.

import type { Metadata } from 'next'
import { GateForm } from './gate-form'

export const metadata: Metadata = {
  title: 'Confidential preview · ConsentShield',
  description: 'ConsentShield is in confidential preview. Sign in with your invitation email to continue.',
  robots: {
    index: false,
    follow: false,
    nocache: true,
  },
}

interface PageProps {
  searchParams: Promise<{ from?: string }>
}

export default async function GatePage({ searchParams }: PageProps) {
  const { from } = await searchParams
  const safeFrom = sanitiseFrom(from)

  return (
    <main className="gate-main">
      <div className="gate-shell">
        <GateForm from={safeFrom} />
      </div>
    </main>
  )
}

function sanitiseFrom(raw: string | undefined): string {
  if (!raw) return '/'
  if (!raw.startsWith('/') || raw.startsWith('//')) return '/'
  if (raw.startsWith('/gate') || raw.startsWith('/api/')) return '/'
  return raw
}
