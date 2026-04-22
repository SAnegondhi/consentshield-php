// ADR-1010 Phase 1 Sprint 1.1 — probe envelope shared by all three
// prototype mechanisms. The scratch route /v1/_cs_api_probe aggregates
// whichever mechanisms return a result into a single response so
// latency can be compared side-by-side.

export type ProbeMechanism = 'rest' | 'hyperdrive' | 'raw_tcp'

export interface ProbeResult {
  mechanism: ProbeMechanism
  ok: boolean
  latency_ms: number
  current_user?: string
  note?: string
  error?: string
  status_code?: number
}
