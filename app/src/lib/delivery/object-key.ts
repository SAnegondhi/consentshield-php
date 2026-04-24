// ADR-1019 Sprint 2.1 — object-key layout for R2 deliveries.
//
// Convention: <path_prefix><event_type>/<YYYY>/<MM>/<DD>/<row_id>.json
//
//   · path_prefix comes from export_configurations.path_prefix. It is
//     expected to already include a trailing slash when non-empty; we do not
//     silently massage it because operators configure it deliberately.
//     Empty string is valid — produces a bucket-rooted layout.
//   · <event_type> is the delivery_buffer.event_type verbatim (slug-safe;
//     current producers use lower_snake_case). Unknown event_type values
//     are fenced by Sprint 2.3's quarantine path, not here.
//   · date partition is UTC, matching row.created_at (NOT local time).
//   · row.id is the uuid primary key — globally unique.
//
// Idempotency: the same row id always maps to the same object key, so a
// retry after a partial failure overwrites the prior object (R2 PUT is
// last-write-wins). That's fine — the canonical body is deterministic.

export interface DeliveryRowKey {
  id: string
  event_type: string
  created_at: Date | string
}

export function objectKeyFor(
  pathPrefix: string | null | undefined,
  row: DeliveryRowKey,
): string {
  const prefix = pathPrefix ?? ''
  const d = row.created_at instanceof Date ? row.created_at : new Date(row.created_at)
  if (Number.isNaN(d.getTime())) {
    throw new Error(`objectKeyFor: invalid created_at for row ${row.id}`)
  }
  const yyyy = d.getUTCFullYear().toString().padStart(4, '0')
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0')
  const dd = String(d.getUTCDate()).padStart(2, '0')
  return `${prefix}${row.event_type}/${yyyy}/${mm}/${dd}/${row.id}.json`
}
