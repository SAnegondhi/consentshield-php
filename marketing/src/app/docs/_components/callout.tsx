// ADR-1015 Phase 1 Sprint 1.1 — Callout component.
//
// Four tones: `tip` (default, teal), `info` (blue), `warn` (amber),
// `security` (red). Used from MDX as:
//   <Callout tone="security" title="Do not commit keys">
//     `cs_live_*` keys grant full tenant API access…
//   </Callout>

import type { ReactNode } from 'react'

type Tone = 'tip' | 'info' | 'warn' | 'security'

const TONE_ICONS: Record<Tone, string> = {
  tip: '💡',
  info: 'ℹ︎',
  warn: '⚠︎',
  security: '🔒',
}

const TONE_TITLES: Record<Tone, string> = {
  tip: 'Tip',
  info: 'Note',
  warn: 'Heads up',
  security: 'Security',
}

export function Callout({
  tone = 'tip',
  title,
  children,
}: {
  tone?: Tone
  title?: string
  children: ReactNode
}) {
  return (
    <div className={`callout ${tone === 'tip' ? '' : tone}`}>
      <div className="callout-head">
        <span aria-hidden>{TONE_ICONS[tone]}</span>
        <span>{title ?? TONE_TITLES[tone]}</span>
      </div>
      <div>{children}</div>
    </div>
  )
}
