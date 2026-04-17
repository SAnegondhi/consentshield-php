import type { Env } from './index'

// Typed accessors over the admin config snapshot materialised to KV by
// the sync-admin-config-to-kv Edge Function (ADR-0027 Sprint 3.2).
//
// The Worker reads a single KV key (admin:config:v1) that contains the
// whole snapshot — kill switches, active tracker signatures, published
// sectoral templates. A short-lived cache on the Worker side smooths
// out the 2-minute sync cadence.
//
// If the KV key is missing (bootstrap, sync function down, dev env
// without Cloudflare credentials), the helpers degrade gracefully: all
// kill switches read as disengaged and activeTrackerSignatures returns
// an empty array. Callers combine this with static fallbacks.

const ADMIN_CONFIG_KEY = 'admin:config:v1'
const CACHE_TTL_SECONDS = 120 // matches cron cadence

export interface AdminTrackerSignature {
  signature_code: string
  display_name: string
  vendor: string
  signature_type: 'script_src' | 'resource_url' | 'cookie_name' | 'localstorage_key' | 'dom_attribute'
  pattern: string
  category: 'analytics' | 'marketing' | 'functional' | 'social' | 'advertising' | 'other'
  severity: 'info' | 'warn' | 'critical'
}

export interface AdminPurposeDef {
  purpose_code?: string
  display_name?: string
  code?: string
  display?: string
  [key: string]: unknown
}

export interface AdminSectoralTemplate {
  template_code: string
  display_name: string
  sector: string
  version: number
  purpose_definitions: AdminPurposeDef[]
}

export interface AdminConfigSnapshot {
  kill_switches: Record<string, boolean>
  active_tracker_signatures: AdminTrackerSignature[]
  published_sectoral_templates: AdminSectoralTemplate[]
  suspended_org_ids: string[]
  blocked_ips: string[]
  refreshed_at: string
}

const EMPTY_SNAPSHOT: AdminConfigSnapshot = {
  kill_switches: {},
  active_tracker_signatures: [],
  published_sectoral_templates: [],
  suspended_org_ids: [],
  blocked_ips: [],
  refreshed_at: '1970-01-01T00:00:00Z',
}

export async function getAdminConfig(env: Env): Promise<AdminConfigSnapshot> {
  // KV put by the Edge Function stored a stringified JSON blob. Read as
  // 'json' so we don't re-parse on every call.
  const raw = await env.BANNER_KV.get(ADMIN_CONFIG_KEY, 'json')
  if (raw) {
    // Defensive: older snapshots (pre ADR-0033 Sprint 2.3) had no
    // blocked_ips key. Default to an empty array rather than undefined
    // so downstream checks can iterate without null guards.
    const snap = raw as Partial<AdminConfigSnapshot>
    return {
      kill_switches: snap.kill_switches ?? {},
      active_tracker_signatures: snap.active_tracker_signatures ?? [],
      published_sectoral_templates: snap.published_sectoral_templates ?? [],
      suspended_org_ids: snap.suspended_org_ids ?? [],
      blocked_ips: snap.blocked_ips ?? [],
      refreshed_at: snap.refreshed_at ?? '1970-01-01T00:00:00Z',
    }
  }
  return EMPTY_SNAPSHOT
}

export function isKillSwitchEngaged(
  config: AdminConfigSnapshot,
  switchKey: 'banner_delivery' | 'depa_processing' | 'deletion_dispatch' | 'rights_request_intake',
): boolean {
  return config.kill_switches[switchKey] === true
}

export function isOrgSuspended(
  config: AdminConfigSnapshot,
  orgId: string,
): boolean {
  if (!config.suspended_org_ids || config.suspended_org_ids.length === 0) return false
  return config.suspended_org_ids.includes(orgId)
}

export function adminConfigTtlSeconds(): number {
  return CACHE_TTL_SECONDS
}

// Convert an admin catalogue row into the legacy TrackerSignature shape
// that signatures.ts + banner.ts already consume. The legacy shape
// expects {service_slug, service_name, category, detection_rules[],
// is_functional}. The admin catalogue is one row per detection rule, so
// we group by signature_code and project back to the expected shape.
//
// `is_functional` is derived from category: the customer-side legacy
// seed flagged payment + auth + support chat trackers as functional.
// The admin catalogue uses the 'functional' category for the same set,
// so the conversion is a simple equality check.
export interface LegacyTrackerSignature {
  service_name: string
  service_slug: string
  category: string
  detection_rules: Array<{
    type: 'script_src' | 'resource_url' | 'cookie_name' | 'global_var'
    pattern: string
    confidence: number
  }>
  is_functional: boolean
}

export function toLegacySignatures(
  adminSignatures: AdminTrackerSignature[],
): LegacyTrackerSignature[] {
  const bySlug = new Map<string, LegacyTrackerSignature>()
  for (const sig of adminSignatures) {
    const existing = bySlug.get(sig.signature_code)
    const ruleType =
      sig.signature_type === 'script_src' || sig.signature_type === 'resource_url'
        ? sig.signature_type
        : sig.signature_type === 'cookie_name'
          ? 'cookie_name'
          : 'global_var'
    const rule = {
      type: ruleType as LegacyTrackerSignature['detection_rules'][number]['type'],
      pattern: sig.pattern,
      confidence: sig.severity === 'critical' ? 0.98 : 0.95,
    }
    if (existing) {
      existing.detection_rules.push(rule)
    } else {
      bySlug.set(sig.signature_code, {
        service_name: sig.display_name,
        service_slug: sig.signature_code,
        category: sig.category,
        detection_rules: [rule],
        is_functional: sig.category === 'functional',
      })
    }
  }
  return Array.from(bySlug.values())
}
