import Link from 'next/link'

// ADR-1015 Phase 1 Sprint 1.1 — Docs breadcrumb. Each trail segment is
// a discrete node; the final segment is the current page (non-clickable).
// MDX pages render the breadcrumb by hand via <Breadcrumb trail={[...]} />
// so the same pattern works for nested API-reference endpoint pages.

export interface BreadcrumbNode {
  label: string
  href?: string
}

export function Breadcrumb({ trail }: { trail: BreadcrumbNode[] }) {
  return (
    <nav aria-label="Breadcrumb" className="docs-breadcrumb">
      {trail.map((node, i) => {
        const isLast = i === trail.length - 1
        return (
          <span key={i}>
            {i > 0 ? <span className="sep"> / </span> : null}
            {node.href && !isLast ? (
              <Link href={node.href}>{node.label}</Link>
            ) : (
              <span>{node.label}</span>
            )}
          </span>
        )
      })}
    </nav>
  )
}
