import type { ReactNode } from 'react'

// ADR-1015 Phase 1 Sprint 1.1 — HTTP-status grid.
//
// MDX:
//   <StatusGrid
//     statuses={[
//       { code: '201', label: 'Created',  description: 'Consent artefact recorded.' },
//       { code: '400', label: 'Bad Request', description: '`purposes` missing or empty.' },
//       { code: '429', label: 'Too Many Requests', description: 'Plan rate limit hit.' },
//     ]}
//   />

export interface StatusRow {
  code: string
  label?: string
  description: ReactNode
}

export function StatusGrid({ statuses }: { statuses: StatusRow[] }) {
  return (
    <div className="status-grid">
      {statuses.map((s) => (
        <FragmentRow key={s.code} row={s} />
      ))}
    </div>
  )
}

function FragmentRow({ row }: { row: StatusRow }) {
  const firstDigit = row.code[0]
  const klass =
    firstDigit === '2' ? 's2xx' : firstDigit === '5' ? 's5xx' : 's4xx'
  return (
    <>
      <div className={`status-chip ${klass}`}>
        {row.code}
        {row.label ? ` ${row.label}` : ''}
      </div>
      <div className="status-desc">{row.description}</div>
    </>
  )
}
