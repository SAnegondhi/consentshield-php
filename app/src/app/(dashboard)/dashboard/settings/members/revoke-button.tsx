'use client'

import { useState } from 'react'
import { revokeInvitation } from './actions'

export function RevokeButton({ invitationId }: { invitationId: string }) {
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function onClick() {
    if (!confirm('Revoke this invitation? The token will stop working immediately.')) return
    setPending(true)
    setError(null)
    const r = await revokeInvitation(invitationId)
    setPending(false)
    if (!r.ok) setError(r.error)
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={onClick}
        disabled={pending}
        className="rounded border border-gray-300 bg-white px-2 py-1 text-xs text-gray-700 hover:bg-gray-100 disabled:opacity-50"
      >
        {pending ? 'Revoking…' : 'Revoke'}
      </button>
      {error ? <span className="text-[10px] text-red-700">{error}</span> : null}
    </div>
  )
}
