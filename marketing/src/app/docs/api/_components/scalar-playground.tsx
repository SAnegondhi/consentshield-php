'use client'

import { ApiReferenceReact } from '@scalar/api-reference-react'
import '@scalar/api-reference-react/style.css'
import './scalar-overrides.css'

// ADR-1015 Phase 1 Sprint 1.2 — Scalar playground client component.
//
// Rendered from /docs/api. The default Scalar stylesheet is loaded
// first; scalar-overrides.css then tints headings + link colours to
// match the marketing site's navy/teal palette.

export function ScalarPlayground() {
  return (
    <div className="scalar-container">
      <ApiReferenceReact
        configuration={{
          url: '/openapi.yaml',
          theme: 'default',
          hideClientButton: false,
          hideDownloadButton: false,
          defaultOpenAllTags: false,
          darkMode: false,
          hideModels: false,
          metaData: {
            title: 'ConsentShield v1 API',
            description:
              'DPDP-native consent, artefacts, rights requests, and deletion.',
          },
        }}
      />
    </div>
  )
}
