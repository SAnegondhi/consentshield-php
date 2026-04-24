import type { RunStatus } from '../data/types'

const LABELS: Record<RunStatus, string> = {
  green: 'Healthy',
  partial: 'Partial',
  red: 'Red'
}

const STYLES: Record<RunStatus, string> = {
  green: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  partial: 'bg-amber-50 text-amber-700 border-amber-200',
  red: 'bg-red-50 text-red-700 border-red-200'
}

export function StatusPill({ status }: { status: RunStatus }) {
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium ${STYLES[status]}`}
      aria-label={`Run status: ${LABELS[status]}`}
    >
      {LABELS[status]}
    </span>
  )
}
