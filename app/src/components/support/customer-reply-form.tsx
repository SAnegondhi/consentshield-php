'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { replyToTicket } from '@/app/(dashboard)/dashboard/support/actions'

export function CustomerReplyForm({ ticketId }: { ticketId: string }) {
  const router = useRouter()
  const [body, setBody] = useState('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!body.trim()) return
    setPending(true)
    setError(null)
    const r = await replyToTicket(ticketId, body)
    setPending(false)
    if (!r.ok) {
      setError(r.error)
      return
    }
    setBody('')
    router.refresh()
  }

  return (
    <form
      onSubmit={onSubmit}
      className="rounded border border-gray-200 bg-white p-4"
    >
      <label className="block text-xs font-medium uppercase tracking-wider text-gray-500">
        Reply
      </label>
      <textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        rows={4}
        required
        placeholder="Send a reply to the operator team."
        className="mt-1 w-full rounded border border-gray-300 px-3 py-2 text-sm"
      />
      {error ? <p className="mt-2 text-sm text-red-700">{error}</p> : null}
      <div className="mt-3 flex justify-end">
        <button
          type="submit"
          disabled={pending || !body.trim()}
          className="rounded bg-black px-3 py-1.5 text-xs font-medium text-white hover:bg-gray-800 disabled:opacity-50"
        >
          {pending ? 'Sending…' : 'Send reply'}
        </button>
      </div>
    </form>
  )
}
