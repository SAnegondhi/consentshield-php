import type { Metadata } from 'next'
import { Breadcrumb } from '../_components/breadcrumb'
import { ScalarPlayground } from './_components/scalar-playground'

// ADR-1015 Phase 1 Sprint 1.2 — Interactive API playground.
//
// Mounts @scalar/api-reference-react against /openapi.yaml — the
// copy scripts/copy-openapi.ts writes at prebuild time from the
// canonical spec in app/public/openapi.yaml. Theme overrides pull
// from the marketing CSS variables so the playground matches the
// site's typography + palette.

export const metadata: Metadata = {
  title: 'API playground',
  description:
    'Try every ConsentShield /v1/* endpoint against a sandboxed environment — in-browser, no server round-trip.',
}

export default function ApiPlaygroundPage() {
  return (
    <>
      <Breadcrumb
        trail={[
          { label: 'Docs', href: '/docs' },
          { label: 'API playground' },
        ]}
      />
      <h1 className="page-title">Interactive API playground</h1>
      <p className="page-sub">
        Every <code>/v1/*</code> endpoint is listed below. Try requests
        against our sandbox environment — your API key stays in your
        browser and is never sent to our servers. Rendered by{' '}
        <code>@scalar/api-reference-react</code> from our public
        OpenAPI spec.
      </p>

      <ScalarPlayground />
    </>
  )
}
