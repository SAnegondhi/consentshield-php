'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { EndSessionButton } from './end-session-button'

interface Props {
  sessionId: string
  targetOrgId: string
  targetOrgName: string
  reason: string
  expiresAt: string
}

// Updates the "minutes remaining" display once per minute. When the
// session expires client-side, the banner flips to amber and prompts
// the operator to clear the cookie (the DB-side cron will also mark
// the session expired within 5 min).

export function BannerClient({
  targetOrgId,
  targetOrgName,
  reason,
  expiresAt,
}: Props) {
  const [minutesLeft, setMinutesLeft] = useState<number>(() =>
    computeMinutesLeft(expiresAt),
  )

  useEffect(() => {
    const id = window.setInterval(() => {
      setMinutesLeft(computeMinutesLeft(expiresAt))
    }, 30_000)
    return () => window.clearInterval(id)
  }, [expiresAt])

  if (minutesLeft <= 0) {
    return (
      <div className="flex items-center justify-between bg-amber-500 px-4 py-2 text-xs font-mono text-white">
        <span>
          Impersonation of <strong>{targetOrgName}</strong> expired. The
          DB-side cron will mark the session expired within 5 min.
        </span>
        <EndSessionButton label="Clear" />
      </div>
    )
  }

  return (
    <div className="flex items-center justify-between bg-red-900 px-4 py-2 text-xs font-mono text-white">
      <span>
        IMPERSONATING <strong>{targetOrgName}</strong>{' '}
        <span className="opacity-80">· reason: {reason}</span>{' '}
        <span className="opacity-80">· {minutesLeft} min remaining</span>
      </span>
      <div className="flex items-center gap-2">
        <Link
          href={`/orgs/${targetOrgId}`}
          className="rounded border border-white/30 bg-white/10 px-2 py-0.5 text-white hover:bg-white/20"
        >
          Go to org
        </Link>
        <EndSessionButton label="End session" />
      </div>
    </div>
  )
}

function computeMinutesLeft(expiresAt: string): number {
  const ms = new Date(expiresAt).getTime() - Date.now()
  return Math.max(0, Math.ceil(ms / 60_000))
}
