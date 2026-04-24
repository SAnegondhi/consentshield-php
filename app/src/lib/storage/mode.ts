// ADR-1003 Sprint 1.1 — storage_mode resolver for Next.js handlers.
//
// Mirror of worker/src/storage-mode.ts. The Next.js runtime has direct
// Postgres access via csOrchestrator() / csApi() / csDelivery(), so
// there's no need for a KV detour — a single indexed SELECT is
// cheaper than the CF API round-trip back to KV would be, and the
// result is immediately correct.
//
// Callers that want the KV-backed view (e.g. a route that deliberately
// exercises the same path the Worker uses) can call
// fetchStorageModeBundleFromKv() — added in Sprint 1.2 when the first
// such caller appears.

import type postgres from 'postgres'

type Pg = ReturnType<typeof postgres>

export type StorageMode = 'standard' | 'insulated' | 'zero_storage'

export function isStorageMode(value: unknown): value is StorageMode {
  return value === 'standard' || value === 'insulated' || value === 'zero_storage'
}

/**
 * Resolves the storage_mode for an org. Uses public.get_storage_mode,
 * which is STABLE and grant-enabled for cs_api / cs_orchestrator /
 * cs_delivery / cs_admin. Returns 'standard' for unknown orgs — same
 * bias as the Worker resolver; callers branching on zero_storage
 * must not rely on "unknown" being pessimistically treated as
 * zero_storage, because the runtime invariant is enforced on the
 * WRITE side.
 */
export async function getStorageMode(
  pg: Pg,
  orgId: string,
): Promise<StorageMode> {
  const rows = (await pg`
    select public.get_storage_mode(${orgId}::uuid) as mode
  `) as unknown as Array<{ mode: string | null }>

  const mode = rows[0]?.mode
  return isStorageMode(mode) ? mode : 'standard'
}

// A batch variant (getStorageModes(orgIds[])) was considered for
// Sprint 1.1 but dropped — no caller needs it yet, and postgres.js's
// in-list syntax for dynamic values is codebase-unprecedented. Add it
// when the first batch caller appears (likely Sprint 3.1's
// refresh-zero-storage-index cron).
