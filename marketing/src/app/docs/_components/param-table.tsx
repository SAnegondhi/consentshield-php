import type { ReactNode } from 'react'

// ADR-1015 Phase 1 Sprint 1.1 — Request / response / query parameter table.
//
// MDX:
//   <ParamTable
//     params={[
//       { name: 'property_id', type: 'uuid', required: true,
//         description: 'Web property the consent belongs to…' },
//       { name: 'purposes',    type: 'string[]', required: true,
//         description: 'Purpose codes the user affirmed…' },
//     ]}
//   />

export interface Param {
  name: string
  type: string
  required?: boolean
  default?: string
  description: ReactNode
}

export function ParamTable({ params }: { params: Param[] }) {
  return (
    <div className="param-table">
      {params.map((p) => (
        <div key={p.name} className="param-row">
          <div className="param-name-cell">
            <div className="param-name">
              {p.name}
              {p.required ? (
                <span className="param-required">REQUIRED</span>
              ) : null}
            </div>
            <div className="param-type">{p.type}</div>
          </div>
          <div className="param-desc-cell">
            {p.description}
            {p.default !== undefined ? (
              <div className="param-default">default: {p.default}</div>
            ) : null}
          </div>
        </div>
      ))}
    </div>
  )
}
