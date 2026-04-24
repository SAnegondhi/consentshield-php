import type { MDXComponents } from 'mdx/types'
import {
  Breadcrumb,
  Callout,
  CodeTabs,
  EndpointHeader,
  FeedbackStrip,
  ParamTable,
  StatusGrid,
} from '@/app/docs/_components'

// ADR-1015 Phase 1 Sprint 1.1 — top-level MDX component registry.
//
// @next/mdx auto-discovers this file at the project root. Every
// `<Callout>` / `<CodeTabs>` / etc. used in any /docs/*.mdx page
// resolves to the component here — so MDX authors don't have to
// import each component individually.

export function useMDXComponents(
  components: MDXComponents,
): MDXComponents {
  return {
    ...components,
    Breadcrumb,
    Callout,
    CodeTabs,
    EndpointHeader,
    FeedbackStrip,
    ParamTable,
    StatusGrid,
  }
}
