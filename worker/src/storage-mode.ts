import type { Env } from './index'

// ADR-1003 Sprint 1.1 — storage_mode resolver for the Cloudflare Worker.
//
// Reads the {<org_id>: <mode>} bundle from KV key 'storage_modes:v1' and
// answers "which mode is this org?" with an in-instance module cache.
//
// Pattern mirrors admin-config.ts (ADR-0027 Sprint 3.2):
//   · Single bundled KV key — one KV read per instance-warmup serves
//     every distinct org seen thereafter.
//   · Soft fallback to 'standard' on bootstrap / KV miss. Callers MUST
//     treat an unknown-org lookup as 'standard' because getting it
//     wrong the other way would let a zero-storage guarantee slip
//     through if the KV sync is temporarily unavailable — and the
//     runtime invariant is enforced on the WRITE side (Sprint 1.2 / 1.3
//     branches on the resolver's answer). Over time this bias favours
//     "still writing" over "silently buffering in memory," which is
//     the safer regression direction for a partially-configured
//     system.
//   · 60 s instance cache — Sprint 1.3 / Phase 3 invariant tests assert
//     that mode changes propagate within 60 s of the trigger's KV
//     push.
//
// Rule 16 intact: zero npm deps. Only @types side would come from
// Worker runtime globals.

export type StorageMode = 'standard' | 'insulated' | 'zero_storage'

const KV_KEY = 'storage_modes:v1'
const CACHE_TTL_MS = 60_000

interface Cached {
  map: Record<string, string>
  loadedAt: number
}

let _cache: Cached | null = null

export function isStorageMode(value: unknown): value is StorageMode {
  return value === 'standard' || value === 'insulated' || value === 'zero_storage'
}

async function loadBundle(env: Env, now: number): Promise<Cached> {
  if (_cache && now - _cache.loadedAt < CACHE_TTL_MS) {
    return _cache
  }
  const raw = await env.BANNER_KV.get(KV_KEY, 'json')
  const map =
    raw && typeof raw === 'object' && !Array.isArray(raw)
      ? (raw as Record<string, string>)
      : {}
  _cache = { map, loadedAt: now }
  return _cache
}

// For test isolation — resets the module-scope cache between Miniflare
// runs. Not part of the runtime API surface.
export function __resetStorageModeCacheForTests(): void {
  _cache = null
}

/**
 * Returns the storage_mode for an org. Defaults to 'standard' when
 * the org is missing from the bundle OR the bundle itself hasn't
 * loaded yet (bootstrap, KV transient, dev without the sync cron).
 */
export async function getStorageMode(
  env: Env,
  orgId: string,
  deps: { now?: () => number } = {},
): Promise<StorageMode> {
  const now = (deps.now ?? (() => Date.now()))()
  const bundle = await loadBundle(env, now)
  const value = bundle.map[orgId]
  return isStorageMode(value) ? value : 'standard'
}

/**
 * Fast-path "is this org zero-storage?" — same lookup, narrow boolean
 * answer, used by the Sprint 1.2 Worker write-path branches.
 */
export async function isZeroStorage(
  env: Env,
  orgId: string,
  deps: { now?: () => number } = {},
): Promise<boolean> {
  return (await getStorageMode(env, orgId, deps)) === 'zero_storage'
}

/** Exposed for admin-probe tooling; NOT for hot-path callers. */
export function storageModeCacheTtlMs(): number {
  return CACHE_TTL_MS
}
