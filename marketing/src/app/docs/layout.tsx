import type { Metadata } from 'next'
import './_styles/docs.css'
import { DocsSidebar } from './_components/sidebar'
import { DocsTocRail } from './_components/toc-rail'

// ADR-1015 Phase 1 Sprint 1.1 — Docs shell.
//
// Three-pane layout: sidebar (taxonomy) / content / ToC rail.
// Wraps every /docs/* route. The marketing site's top <Nav> + <Footer>
// are supplied by the root layout above — we don't repeat them here.
//
// The ToC rail walks the content column's h2/h3 ids via client
// component; individual MDX pages don't have to author their ToC.

export const metadata: Metadata = {
  title: {
    default: 'Developer Docs — ConsentShield',
    template: '%s — ConsentShield Docs',
  },
  description:
    'Build DPDP-compliant consent flows with the ConsentShield API — record, verify, revoke, and export consent artefacts the DPB treats as first-class evidence.',
}

export default function DocsLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <div className="docs-shell">
      <DocsSidebar />
      <main className="docs-content">{children}</main>
      <DocsTocRail />
    </div>
  )
}
