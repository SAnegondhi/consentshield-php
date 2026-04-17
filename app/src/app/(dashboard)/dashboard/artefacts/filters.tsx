'use client'

import { useRouter, useSearchParams } from 'next/navigation'

interface Props {
  activeStatus: string
  activeFramework: string
  activePurpose: string
  expiring: string
  purposes: Array<{ purpose_code: string; display_name: string }>
}

export function ArtefactFilters(props: Props) {
  const router = useRouter()
  const search = useSearchParams()

  function applyFilter(key: string, value: string) {
    const next = new URLSearchParams(search.toString())
    if (value) next.set(key, value)
    else next.delete(key)
    next.delete('page')
    router.push(`/dashboard/artefacts?${next.toString()}`)
  }

  function clearAll() {
    router.push('/dashboard/artefacts')
  }

  return (
    <section className="rounded border border-gray-200 p-3 space-y-2 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-medium text-gray-500 uppercase">Status</span>
        {(['', 'active', 'replaced', 'revoked', 'expired'] as const).map((s) => (
          <Chip
            key={s || 'all'}
            active={props.activeStatus === s}
            onClick={() => applyFilter('status', s)}
          >
            {s || 'Any'}
          </Chip>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-medium text-gray-500 uppercase">Framework</span>
        {(['', 'dpdp', 'abdm', 'gdpr'] as const).map((f) => (
          <Chip
            key={f || 'all'}
            active={props.activeFramework === f}
            onClick={() => applyFilter('framework', f)}
          >
            {f || 'Any'}
          </Chip>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-medium text-gray-500 uppercase">Purpose</span>
        <Chip
          active={!props.activePurpose}
          onClick={() => applyFilter('purpose', '')}
        >
          Any
        </Chip>
        {props.purposes.map((p) => (
          <Chip
            key={p.purpose_code}
            active={props.activePurpose === p.purpose_code}
            onClick={() => applyFilter('purpose', p.purpose_code)}
          >
            <span className="font-mono text-xs">{p.purpose_code}</span>
          </Chip>
        ))}
      </div>
      <div className="flex items-center gap-2 pt-1">
        <Chip
          active={props.expiring === '30'}
          onClick={() => applyFilter('expiring', props.expiring === '30' ? '' : '30')}
        >
          Expiring &lt; 30 days
        </Chip>
        <button
          onClick={clearAll}
          className="ml-auto text-xs text-gray-500 hover:text-black"
        >
          Clear all
        </button>
      </div>
    </section>
  )
}

function Chip({
  active,
  onClick,
  children,
}: {
  active: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      onClick={onClick}
      className={`rounded-full px-2.5 py-0.5 text-xs transition ${
        active
          ? 'bg-black text-white'
          : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
      }`}
    >
      {children}
    </button>
  )
}
