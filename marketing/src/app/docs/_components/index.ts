// ADR-1015 Phase 1 Sprint 1.1 — shared /docs/* components.
//
// MDX pages import from this barrel so the authoring surface stays
// stable across content sprints. Every component here is listed in the
// matching wireframe pattern in consentshield-developer-docs.html.

export { Breadcrumb, type BreadcrumbNode } from './breadcrumb'
export { Callout } from './callout'
export { CodeTabs, type CodeTab } from './code-tabs'
export { EndpointHeader } from './endpoint-header'
export { ParamTable, type Param } from './param-table'
export { StatusGrid, type StatusRow } from './status-grid'
export { FeedbackStrip } from './feedback-strip'
export { DocsSidebar } from './sidebar'
export { DocsTocRail } from './toc-rail'
