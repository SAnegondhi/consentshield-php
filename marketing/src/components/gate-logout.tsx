'use client'

// ADR-0502 — "Sign out of preview" footer link.

import { useRouter } from 'next/navigation'

export function GateLogout() {
  const router = useRouter()
  const onClick = async (e: React.MouseEvent) => {
    e.preventDefault()
    try {
      const res = await fetch('/api/gate/logout', { method: 'POST' })
      const json = (await res.json()) as { ok: boolean; redirect?: string }
      if (json.ok) router.replace(json.redirect ?? '/gate')
    } catch {
      // Best-effort; on failure stay on the page.
    }
  }
  return (
    <a
      href="/gate"
      onClick={onClick}
      className="gate-logout-link"
      style={{ cursor: 'pointer' }}
    >
      Sign out of preview
    </a>
  )
}
