// Logo (shield icon + "ConsentShield" wordmark) — used by nav and footer.
// SVG is inlined from the HTML spec verbatim so the visual identity matches
// 1:1 with docs/design/screen designs and ux/marketing-site/consentshield-site-v2.html.
export interface LogoProps {
  variant?: 'light' | 'dark'
}

export function Logo({ variant = 'light' }: LogoProps) {
  // light  → dark text on light background (home/nav)
  // dark   → light text on dark background (footer)
  const isDark = variant === 'dark'
  return (
    <span className="logo">
      <span
        className="logo-icon"
        style={
          isDark
            ? {
                background: 'rgba(255,255,255,.08)',
                border: '1px solid rgba(255,255,255,.12)',
              }
            : undefined
        }
      >
        <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
          <path
            d="M12 3 L19.5 6 V13 C19.5 17.5 16 21 12 22 C8 21 4.5 17.5 4.5 13 V6 Z"
            fill={isDark ? '#14A090' : '#0D7A6B'}
          />
          <path
            d="M12 3 L19.5 6 V13 C19.5 17.5 16 21 12 22 V3 Z"
            fill={isDark ? '#0D7A6B' : '#0A6458'}
          />
          <path
            d="M8.5 12.2 L11 14.7 L15.8 9.7"
            stroke="white"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
            fill="none"
          />
        </svg>
      </span>
      <span
        className="logo-word"
        style={isDark ? { color: 'white' } : undefined}
      >
        Consent
        <em style={isDark ? { color: 'var(--teal-bright)' } : undefined}>
          Shield
        </em>
      </span>
    </span>
  )
}
