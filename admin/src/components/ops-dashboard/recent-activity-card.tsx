interface AuditRow {
  id: number
  occurred_at: string
  action: string
  reason: string
  admin_user_id: string
  display_name: string | null
  target_table: string | null
  org_id: string | null
}

export function RecentActivityCard({ rows }: { rows: AuditRow[] }) {
  return (
    <section className="rounded-md border border-[color:var(--border)] bg-white shadow-sm">
      <header className="flex items-center justify-between border-b border-[color:var(--border)] p-4">
        <h3 className="text-sm font-semibold">Recent admin activity</h3>
        <span className="rounded-full bg-bg px-2 py-0.5 text-xs font-medium text-text-2">
          last {rows.length}
        </span>
      </header>
      <div>
        {rows.length === 0 ? (
          <p className="p-4 text-sm text-text-3">
            No admin activity recorded yet.
          </p>
        ) : (
          rows.map((row) => (
            <div
              key={row.id}
              className="border-t border-[color:var(--border)] p-3 first:border-t-0"
            >
              <div className="flex items-center justify-between gap-2">
                <code className="font-mono text-xs text-red-700">
                  {row.action}
                </code>
                <span className="font-mono text-xs text-text-3">
                  {new Date(row.occurred_at).toLocaleString('en-IN', {
                    dateStyle: 'short',
                    timeStyle: 'short',
                  })}
                </span>
              </div>
              <div className="mt-1 text-xs text-text-2">
                <span className="font-medium">
                  {row.display_name ?? row.admin_user_id.slice(0, 8)}
                </span>{' '}
                — {row.reason}
              </div>
              {row.target_table ? (
                <div className="mt-0.5 text-xs text-text-3">
                  target: <code className="font-mono">{row.target_table}</code>
                  {row.org_id ? (
                    <>
                      {' '}
                      · org: <code className="font-mono">{row.org_id.slice(0, 8)}</code>
                    </>
                  ) : null}
                </div>
              ) : null}
            </div>
          ))
        )}
      </div>
    </section>
  )
}
