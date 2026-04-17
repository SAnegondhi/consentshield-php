'use client'

import { useState } from 'react'
import { endImpersonation } from '../../app/(operator)/orgs/[orgId]/impersonation-actions'

export function EndSessionButton({ label = 'End session' }: { label?: string }) {
  const [pending, setPending] = useState(false)
  return (
    <button
      type="button"
      disabled={pending}
      onClick={async () => {
        setPending(true)
        await endImpersonation()
        setPending(false)
      }}
      className="rounded border border-white/30 bg-white/10 px-2 py-0.5 text-white hover:bg-white/20 disabled:opacity-60"
    >
      {pending ? 'Ending…' : label}
    </button>
  )
}
