'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createTicket } from '@/app/(dashboard)/dashboard/support/actions'

export function NewTicketForm({
  defaultEmail,
  defaultName,
}: {
  defaultEmail: string
  defaultName: string
}) {
  const router = useRouter()
  const [subject, setSubject] = useState('')
  const [body, setBody] = useState('')
  const [priority, setPriority] = useState<'low' | 'normal' | 'high'>('normal')
  const [reporterEmail, setReporterEmail] = useState(defaultEmail)
  const [reporterName, setReporterName] = useState(defaultName)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const saveOk = subject.trim().length >= 3 && body.trim().length > 0 && reporterEmail.includes('@')

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setPending(true)
    setError(null)

    const r = await createTicket({
      subject,
      body,
      priority,
      reporterEmail,
      reporterName,
    })
    setPending(false)
    if (!r.ok) {
      setError(r.error)
      return
    }
    router.push(`/dashboard/support/${r.data!.ticketId}`)
    router.refresh()
  }

  return (
    <form
      onSubmit={onSubmit}
      className="space-y-4 rounded border border-gray-200 bg-white p-6"
    >
      <label className="block">
        <span className="block text-xs font-medium uppercase tracking-wider text-gray-500">
          Subject
        </span>
        <input
          value={subject}
          onChange={(e) => setSubject(e.target.value)}
          required
          placeholder="Short summary of the issue"
          className="mt-1 w-full rounded border border-gray-300 px-3 py-2 text-sm"
        />
      </label>

      <label className="block">
        <span className="block text-xs font-medium uppercase tracking-wider text-gray-500">
          Message
        </span>
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          rows={6}
          required
          placeholder="What's happening? Include URLs, error messages, or screenshots' URLs if helpful."
          className="mt-1 w-full rounded border border-gray-300 px-3 py-2 text-sm"
        />
      </label>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label className="block">
          <span className="block text-xs font-medium uppercase tracking-wider text-gray-500">
            Priority
          </span>
          <select
            value={priority}
            onChange={(e) =>
              setPriority(e.target.value as 'low' | 'normal' | 'high')
            }
            className="mt-1 w-full rounded border border-gray-300 px-3 py-2 text-sm"
          >
            <option value="low">Low</option>
            <option value="normal">Normal</option>
            <option value="high">High</option>
          </select>
          <p className="mt-1 text-xs text-gray-500">
            Urgent priority is reserved for operators. For incidents affecting
            all of your users, contact ops@consentshield.in.
          </p>
        </label>

        <div className="grid grid-cols-1 gap-2">
          <label className="block">
            <span className="block text-xs font-medium uppercase tracking-wider text-gray-500">
              Reporter email
            </span>
            <input
              type="email"
              value={reporterEmail}
              onChange={(e) => setReporterEmail(e.target.value)}
              required
              className="mt-1 w-full rounded border border-gray-300 px-3 py-2 text-sm"
            />
          </label>
          <label className="block">
            <span className="block text-xs font-medium uppercase tracking-wider text-gray-500">
              Reporter name (optional)
            </span>
            <input
              value={reporterName}
              onChange={(e) => setReporterName(e.target.value)}
              className="mt-1 w-full rounded border border-gray-300 px-3 py-2 text-sm"
            />
          </label>
        </div>
      </div>

      {error ? (
        <p className="rounded border border-red-200 bg-red-50 p-3 text-sm text-red-800">
          {error}
        </p>
      ) : null}

      <div className="flex items-center justify-end gap-2">
        <button
          type="button"
          onClick={() => router.back()}
          className="rounded border border-gray-300 bg-white px-4 py-2 text-sm text-gray-700 hover:bg-gray-50"
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={pending || !saveOk}
          className="rounded bg-black px-4 py-2 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-50"
        >
          {pending ? 'Submitting…' : 'Open ticket'}
        </button>
      </div>
    </form>
  )
}
