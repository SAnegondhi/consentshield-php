// MARKETING_GATE_INVITES env-var allowlist parser. ADR-0502 Sprint 1.1.
//
// Founder identities are baked in via ALWAYS_ALLOWED so they survive
// any env-var edit / rotation / clear. Everything else lives in the
// env var and is updated via `bunx vercel@39 env add MARKETING_GATE_INVITES …`.

const ALWAYS_ALLOWED: readonly string[] = [
  'sudhindra@consentshield.in',
]

let cached: Set<string> | null = null
let cachedSource = ''

function getAllowlist(): Set<string> {
  const raw = process.env.MARKETING_GATE_INVITES ?? ''
  if (raw === cachedSource && cached !== null) return cached
  cached = new Set([
    ...ALWAYS_ALLOWED.map((s) => s.trim().toLowerCase()),
    ...raw
      .split(',')
      .map((s) => s.trim().toLowerCase())
      .filter((s) => s.length > 0),
  ])
  cachedSource = raw
  return cached
}

export function isInvited(email: string): boolean {
  const normalised = email.trim().toLowerCase()
  if (normalised.length === 0) return false
  return getAllowlist().has(normalised)
}

/** For diagnostics only — never expose this. */
export function allowlistSize(): number {
  return getAllowlist().size
}
