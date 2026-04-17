interface CronJob {
  jobname: string
  schedule: string
  active: boolean
  last_run_at: string | null
  last_status: string | null
  last_run_ago_seconds: number | null
}

export function CronStatusCard({ jobs }: { jobs: CronJob[] }) {
  const failed = jobs.filter((j) => j.last_status && j.last_status !== 'succeeded').length
  const healthy = jobs.length - failed

  return (
    <section className="rounded-md border border-[color:var(--border)] bg-white shadow-sm">
      <header className="flex items-center justify-between border-b border-[color:var(--border)] p-4">
        <h3 className="text-sm font-semibold">Cron job status</h3>
        <span
          className={
            failed === 0
              ? 'rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700'
              : 'rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700'
          }
        >
          {healthy} of {jobs.length} healthy
        </span>
      </header>
      <table className="w-full text-sm">
        <thead>
          <tr className="bg-bg text-left text-xs uppercase tracking-wider text-text-3">
            <th className="px-4 py-2">Job</th>
            <th className="px-4 py-2">Schedule</th>
            <th className="px-4 py-2">Last run</th>
            <th className="px-4 py-2">Status</th>
          </tr>
        </thead>
        <tbody>
          {jobs.map((job) => (
            <tr key={job.jobname} className="border-t border-[color:var(--border)]">
              <td className="px-4 py-2">
                <code className="font-mono text-xs">{job.jobname}</code>
              </td>
              <td className="px-4 py-2 font-mono text-xs text-text-2">
                {job.schedule}
              </td>
              <td className="px-4 py-2 font-mono text-xs text-text-2">
                {job.last_run_ago_seconds == null
                  ? 'never'
                  : humanAgo(job.last_run_ago_seconds)}
              </td>
              <td className="px-4 py-2 text-xs">
                {statusPill(job.last_status, job.active)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  )
}

function statusPill(status: string | null, active: boolean) {
  if (!active)
    return (
      <span className="rounded-full bg-bg px-2 py-0.5 font-medium text-text-2">
        Paused
      </span>
    )
  if (!status)
    return (
      <span className="rounded-full bg-bg px-2 py-0.5 font-medium text-text-2">
        Pending
      </span>
    )
  if (status === 'succeeded')
    return (
      <span className="rounded-full bg-green-100 px-2 py-0.5 font-medium text-green-700">
        OK
      </span>
    )
  return (
    <span className="rounded-full bg-red-100 px-2 py-0.5 font-medium text-red-700">
      {status}
    </span>
  )
}

function humanAgo(seconds: number): string {
  if (seconds < 60) return `${seconds}s ago`
  const mins = Math.floor(seconds / 60)
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ${mins % 60}m ago`
  const days = Math.floor(hours / 24)
  return `${days}d ago`
}
