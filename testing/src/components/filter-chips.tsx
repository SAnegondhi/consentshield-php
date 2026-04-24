import Link from 'next/link'

interface ChipRowProps {
  label: string
  items: string[]
  hrefForItem: (item: string) => string
  renderItem?: (item: string) => string
}

export function ChipRow({ label, items, hrefForItem, renderItem }: ChipRowProps) {
  if (items.length === 0) return null
  return (
    <div className="flex flex-wrap items-baseline gap-2 text-sm">
      <span className="text-slate-500 uppercase tracking-wider text-xs">{label}</span>
      {items.map((it) => (
        <Link
          key={it}
          href={hrefForItem(it)}
          className="inline-flex items-center rounded-full border border-slate-300 bg-white px-3 py-1 text-slate-700 hover:border-slate-500 hover:text-ink"
        >
          {renderItem ? renderItem(it) : it}
        </Link>
      ))}
    </div>
  )
}
