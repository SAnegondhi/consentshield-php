// Pure presentational tile. Server Component.

interface MetricTileProps {
  label: string
  value: string | number
  caption?: string
  tone?: 'default' | 'amber' | 'green' | 'red'
}

const TONE_CLASS: Record<NonNullable<MetricTileProps['tone']>, string> = {
  default: 'text-zinc-900',
  amber: 'text-amber-600',
  green: 'text-green-600',
  red: 'text-red-700',
}

export function MetricTile({
  label,
  value,
  caption,
  tone = 'default',
}: MetricTileProps) {
  return (
    <div className="rounded-md border border-zinc-200 bg-white p-4 shadow-sm">
      <div className="text-xs font-medium uppercase tracking-wider text-zinc-500">
        {label}
      </div>
      <div className={`mt-1 text-2xl font-semibold ${TONE_CLASS[tone]}`}>
        {value}
      </div>
      {caption ? (
        <div className="mt-1 text-xs text-zinc-500">{caption}</div>
      ) : null}
    </div>
  )
}
