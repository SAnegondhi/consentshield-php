// ADR-1015 Phase 1 Sprint 1.1 — End-of-page "was this useful" strip.
//
// In Sprint 4.3 the Yes / No buttons get wired to the structured
// GitHub issue form. For 1.1 they're anchor links to the repo's issue
// template placeholder — enough for the shell to render as spec.

export function FeedbackStrip({
  pagePath,
  issueUrl = 'https://github.com/SAnegondhi/consentshield/issues/new?template=docs-issue.yml',
}: {
  /** Path on disk (relative to repo root) — pre-filled into the issue. */
  pagePath?: string
  issueUrl?: string
}) {
  const withContext = pagePath
    ? `${issueUrl}&page=${encodeURIComponent(pagePath)}`
    : issueUrl
  return (
    <aside className="feedback-strip" aria-label="Was this page useful?">
      <div className="feedback-prompt">
        Was this page useful? We read every response.
      </div>
      <div className="feedback-actions">
        <a
          className="feedback-btn"
          href={withContext + '&vote=yes'}
          target="_blank"
          rel="noreferrer"
        >
          👍 Yes
        </a>
        <a
          className="feedback-btn"
          href={withContext + '&vote=no'}
          target="_blank"
          rel="noreferrer"
        >
          👎 Needs work
        </a>
      </div>
    </aside>
  )
}
