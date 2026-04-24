import Link from 'next/link'
import type { Metadata } from 'next'
import { Breadcrumb } from './_components/breadcrumb'
import { FeedbackStrip } from './_components/feedback-strip'

// ADR-1015 Phase 1 Sprint 1.1 — Developer Hub placeholder.
//
// Shell-only landing that proves the layout renders (sidebar + content
// + ToC rail). Sprint 2.1 replaces the body with the full wireframe
// Hub: 4-card grid, at-a-glance table, "stay in the loop". The shell
// stays untouched across that edit.

export const metadata: Metadata = {
  title: 'Developer Hub',
  description:
    'Integrate ConsentShield — record, verify, revoke, and export consent artefacts via the /v1/* API.',
}

export default function DocsHome() {
  return (
    <>
      <Breadcrumb trail={[{ label: 'Docs', href: '/docs' }]} />
      <h1 className="page-title">
        Build DPDP-compliant consent flows — without building a compliance engine.
      </h1>
      <p className="page-sub">
        The ConsentShield API lets you record, verify, revoke, and export
        consent artefacts that the DPDP Act treats as first-class evidence.
        This is the reference documentation for developers integrating the{' '}
        <code>/v1/*</code> surface.
      </p>

      <h2 id="getting-started">Getting started</h2>
      <p>
        Every page in this docs surface is part of ADR-1015. Phase 1
        (shell + MDX pipeline + Scalar playground + navigation) is
        live; Phase 2 (content authoring: Developer Hub,
        Quickstart, 6 concepts, 7 cookbook recipes, error catalog,
        API changelog) and Phase 3 (external-consumer integration
        test suite) are next.
      </p>
      <p>
        In the meantime, the sidebar lays out the final taxonomy. Every
        link there is the eventual home for its content; clicking one
        before the page has been authored renders a 404.
      </p>

      <h2 id="quick-links">Quick links</h2>
      <ul>
        <li>
          <Link href="/docs/quickstart">Quickstart — 15 min</Link> — issue a
          key, record a consent, verify it.
        </li>
        <li>
          <Link href="/docs/api">Interactive API playground</Link> — every
          endpoint, executable against sandbox in-browser.
        </li>
        <li>
          <Link href="/docs/concepts/dpdp-in-3-minutes">
            DPDP Act in 3 minutes
          </Link>{' '}
          — the law, in enough detail to decide if ConsentShield is the right
          fit.
        </li>
        <li>
          <Link href="/docs/errors">Error codes</Link> — every `error.code`
          the `/v1/*` surface can return, with remediation.
        </li>
      </ul>

      <FeedbackStrip pagePath="marketing/src/app/docs/page.tsx" />
    </>
  )
}
