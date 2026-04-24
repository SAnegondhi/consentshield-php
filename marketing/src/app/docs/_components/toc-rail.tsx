'use client'

import { useEffect, useState } from 'react'

// ADR-1015 Phase 1 Sprint 1.1 — Right-rail "On this page" ToC.
//
// Client component. Walks the <main class="docs-content"> DOM on mount,
// collects every h2 / h3 with an id, and renders them as anchor links.
// IntersectionObserver tracks the currently-visible section and marks
// it active. Every page gets this automatically via the layout — no
// per-page configuration needed.

interface Heading {
  id: string
  text: string
  level: 2 | 3
}

export function DocsTocRail({ editOnGitHubPath }: { editOnGitHubPath?: string }) {
  const [headings, setHeadings] = useState<Heading[]>([])
  const [activeId, setActiveId] = useState<string | null>(null)

  useEffect(() => {
    const container = document.querySelector('.docs-content')
    if (!container) return
    const nodes = container.querySelectorAll('h2[id], h3[id]')
    const collected: Heading[] = Array.from(nodes).map((el) => ({
      id: el.id,
      text: el.textContent ?? '',
      level: (el.tagName === 'H2' ? 2 : 3) as 2 | 3,
    }))
    // ToC is built from the rendered DOM each mount — setState-in-effect
    // is the right tool (React's purity lint can't see the DOM read).
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setHeadings(collected)

    if (collected.length === 0) return

    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)
        if (visible[0]) setActiveId(visible[0].target.id)
      },
      { rootMargin: '-100px 0px -66% 0px' },
    )
    nodes.forEach((n) => observer.observe(n))
    return () => observer.disconnect()
  }, [])

  const editHref = editOnGitHubPath
    ? `https://github.com/SAnegondhi/consentshield/edit/main/${editOnGitHubPath}`
    : null

  return (
    <aside className="docs-toc" aria-label="On this page">
      <div className="toc-title">On this page</div>
      {headings.length === 0 ? (
        <p className="toc-link" style={{ color: 'var(--ink-4)' }}>
          No subsections.
        </p>
      ) : (
        headings.map((h) => (
          <a
            key={h.id}
            href={`#${h.id}`}
            className={[
              'toc-link',
              h.level === 3 ? 'nested' : '',
              activeId === h.id ? 'active' : '',
            ]
              .filter(Boolean)
              .join(' ')}
          >
            {h.text}
          </a>
        ))
      )}
      {editHref ? (
        <div className="toc-foot">
          Found a typo or want to improve this page?{' '}
          <a href={editHref} target="_blank" rel="noreferrer">
            Edit on GitHub →
          </a>
        </div>
      ) : null}
    </aside>
  )
}
