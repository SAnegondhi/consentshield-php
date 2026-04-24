'use client'

import { useState } from 'react'

// ADR-1015 Phase 1 Sprint 1.1 — Multi-language code-tabs.
//
// Usage in MDX:
//   <CodeTabs tabs={[
//     { label: 'cURL',   language: 'bash',       code: '...' },
//     { label: 'Node',   language: 'typescript', code: '...' },
//     { label: 'Python', language: 'python',     code: '...' },
//   ]} />
//
// Active tab + copy-to-clipboard are client-side. Syntax highlighting
// is intentionally deferred to a later sprint — we ship the container
// + copy UX first; highlighting (shiki / prism) is a polish pass.

export interface CodeTab {
  label: string
  language: string
  code: string
}

export function CodeTabs({ tabs }: { tabs: CodeTab[] }) {
  const [activeIdx, setActiveIdx] = useState(0)
  const [copied, setCopied] = useState(false)
  const active = tabs[activeIdx] ?? tabs[0]

  async function handleCopy() {
    if (!active) return
    await navigator.clipboard.writeText(active.code)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  if (!active) {
    return (
      <div className="code-card">
        <div className="code-body">No code samples provided.</div>
      </div>
    )
  }

  return (
    <div className="code-card">
      <div className="code-head">
        <div className="code-tabs" role="tablist">
          {tabs.map((t, i) => (
            <button
              key={`${t.label}-${i}`}
              type="button"
              role="tab"
              aria-selected={i === activeIdx}
              className={i === activeIdx ? 'code-tab active' : 'code-tab'}
              onClick={() => setActiveIdx(i)}
            >
              {t.label}
            </button>
          ))}
        </div>
        <div className="code-actions">
          <button
            type="button"
            className="code-btn"
            onClick={handleCopy}
            aria-label="Copy code"
          >
            {copied ? 'Copied!' : 'Copy'}
          </button>
        </div>
      </div>
      <pre className="code-body">
        <code>{active.code}</code>
      </pre>
    </div>
  )
}
