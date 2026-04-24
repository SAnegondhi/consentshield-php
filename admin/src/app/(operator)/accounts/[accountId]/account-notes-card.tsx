'use client'

import { useState, useTransition } from 'react'
import {
  addAccountNote,
  deleteAccountNote,
  updateAccountNote,
} from './account-notes-actions'

// ADR-1027 Sprint 3.2 — client card for account notes.
//
// Renders the list (pinned first, then newest first), an add form at
// the top, and per-row edit + delete affordances. Pin/unpin and delete
// are guarded by canPlatformOperator in the UI; the RPCs re-check at
// the DB layer so this is belt + suspenders.

export interface AccountNote {
  id: string
  account_id: string
  admin_user_id: string
  body: string
  pinned: boolean
  created_at: string
  updated_at: string
}

export function AccountNotesCard({
  accountId,
  notes,
  adminNameById,
  canPlatformOperator,
}: {
  accountId: string
  notes: AccountNote[]
  adminNameById: Record<string, string | null>
  canPlatformOperator: boolean
}) {
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)

  function submitAdd(formData: FormData) {
    setError(null)
    startTransition(async () => {
      const res = await addAccountNote(formData)
      if (res && 'error' in res && res.error) setError(res.error)
    })
  }

  function submitUpdate(formData: FormData) {
    setError(null)
    startTransition(async () => {
      const res = await updateAccountNote(formData)
      if (res && 'error' in res && res.error) setError(res.error)
      else setEditingId(null)
    })
  }

  function submitDelete(noteId: string) {
    const reason = window.prompt(
      'Reason for deletion (audit-logged):',
      'operator account note deleted',
    )
    if (!reason) return
    setError(null)
    const fd = new FormData()
    fd.set('account_id', accountId)
    fd.set('note_id', noteId)
    fd.set('reason', reason)
    startTransition(async () => {
      const res = await deleteAccountNote(fd)
      if (res && 'error' in res && res.error) setError(res.error)
    })
  }

  return (
    <section className="rounded-md border border-[color:var(--border)] bg-white shadow-sm">
      <header className="flex items-center justify-between border-b border-[color:var(--border)] px-4 py-2.5">
        <h2 className="text-sm font-semibold">Account notes</h2>
        <span className="text-[11px] text-text-3">
          {notes.length} {notes.length === 1 ? 'note' : 'notes'} ·{' '}
          {notes.filter((n) => n.pinned).length} pinned
        </span>
      </header>

      {/* Add form — always visible; support+ can add. */}
      <form
        action={submitAdd}
        className="space-y-2 border-b border-[color:var(--border)] px-4 py-3"
      >
        <input type="hidden" name="account_id" value={accountId} />
        <textarea
          name="body"
          required
          rows={3}
          placeholder="Add an account-level note (visible to all operators)…"
          className="w-full rounded border border-[color:var(--border-mid)] px-2 py-1.5 text-xs"
        />
        <div className="flex flex-wrap items-center gap-3">
          <input
            name="reason"
            placeholder="Reason (audit-logged)"
            className="flex-1 rounded border border-[color:var(--border-mid)] px-2 py-1 text-xs"
            minLength={1}
          />
          {canPlatformOperator ? (
            <label className="flex items-center gap-1 text-[11px] text-text-2">
              <input type="checkbox" name="pinned" />
              Pin to top
            </label>
          ) : null}
          <button
            type="submit"
            disabled={pending}
            className="rounded bg-red-700 px-3 py-1 text-xs font-medium text-white hover:bg-red-800 disabled:opacity-50"
          >
            {pending ? 'Saving…' : 'Add note'}
          </button>
        </div>
      </form>

      {error ? (
        <div className="border-b border-red-200 bg-red-50 px-4 py-2 text-xs text-red-800">
          {error}
        </div>
      ) : null}

      {notes.length === 0 ? (
        <p className="p-6 text-center text-sm text-text-3">
          No account-level notes yet. Add one above — it will be visible on
          every org in this account.
        </p>
      ) : (
        <ul className="divide-y divide-[color:var(--border)]">
          {notes.map((n) =>
            editingId === n.id ? (
              <li key={n.id} className="space-y-2 px-4 py-3">
                <form action={submitUpdate} className="space-y-2">
                  <input type="hidden" name="account_id" value={accountId} />
                  <input type="hidden" name="note_id" value={n.id} />
                  <textarea
                    name="body"
                    required
                    rows={3}
                    defaultValue={n.body}
                    className="w-full rounded border border-[color:var(--border-mid)] px-2 py-1.5 text-xs"
                  />
                  <div className="flex flex-wrap items-center gap-3">
                    <input
                      name="reason"
                      required
                      placeholder="Reason (audit-logged)"
                      className="flex-1 rounded border border-[color:var(--border-mid)] px-2 py-1 text-xs"
                    />
                    <label className="flex items-center gap-1 text-[11px] text-text-2">
                      <input
                        type="checkbox"
                        name="pinned"
                        defaultChecked={n.pinned}
                        disabled={!canPlatformOperator}
                      />
                      Pinned {canPlatformOperator ? '' : '(platform_operator only)'}
                    </label>
                    <button
                      type="submit"
                      disabled={pending}
                      className="rounded bg-red-700 px-3 py-1 text-xs font-medium text-white hover:bg-red-800 disabled:opacity-50"
                    >
                      Save
                    </button>
                    <button
                      type="button"
                      onClick={() => setEditingId(null)}
                      className="rounded border border-[color:var(--border-mid)] bg-white px-3 py-1 text-xs text-text-2 hover:bg-bg"
                    >
                      Cancel
                    </button>
                  </div>
                </form>
              </li>
            ) : (
              <li key={n.id} className="flex items-start gap-3 px-4 py-3">
                <div className="flex-1">
                  {n.pinned ? (
                    <span className="mr-2 rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider text-amber-800">
                      pinned
                    </span>
                  ) : null}
                  <span className="whitespace-pre-wrap text-sm text-text">
                    {n.body}
                  </span>
                  <div className="mt-1 text-[11px] text-text-3">
                    {adminNameById[n.admin_user_id] ?? n.admin_user_id.slice(0, 8)}
                    {' · '}
                    {new Date(n.created_at).toLocaleString('en-IN', {
                      dateStyle: 'medium',
                      timeStyle: 'short',
                    })}
                    {n.updated_at !== n.created_at ? (
                      <>
                        {' · edited '}
                        {new Date(n.updated_at).toLocaleDateString('en-IN')}
                      </>
                    ) : null}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setEditingId(n.id)}
                    className="rounded border border-[color:var(--border-mid)] bg-white px-2 py-1 text-[11px] text-text-2 hover:bg-bg"
                  >
                    Edit
                  </button>
                  {canPlatformOperator ? (
                    <button
                      type="button"
                      disabled={pending}
                      onClick={() => submitDelete(n.id)}
                      className="rounded border border-red-300 bg-red-50 px-2 py-1 text-[11px] text-red-700 hover:bg-red-100 disabled:opacity-50"
                    >
                      Delete
                    </button>
                  ) : null}
                </div>
              </li>
            ),
          )}
        </ul>
      )}
    </section>
  )
}
