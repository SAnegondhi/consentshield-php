// ADR-1005 Sprint 6.1 — adapter registry.
//
// Maps channel_type → adapter instance. Adapters register at module load
// (side-effect import from the barrel file that ships real adapters).
// The registry is a mutable singleton; tests use `registerAdapter` /
// `unregisterAdapter` to swap the mock in.
//
// Real adapters (Slack/Teams/Discord/PagerDuty/custom_webhook) land in
// Sprints 6.2 + 6.3 and will register themselves via this module.

import type { ChannelType, NotificationAdapter } from './types'
import { UnknownAdapterError } from './types'

const registry = new Map<ChannelType, NotificationAdapter>()

export function registerAdapter(adapter: NotificationAdapter): void {
  registry.set(adapter.type, adapter)
}

export function unregisterAdapter(type: ChannelType): void {
  registry.delete(type)
}

export function getAdapter(type: ChannelType): NotificationAdapter {
  const adapter = registry.get(type)
  if (!adapter) throw new UnknownAdapterError(type)
  return adapter
}

export function registeredTypes(): ChannelType[] {
  return Array.from(registry.keys())
}

/**
 * Reset the registry to empty. Tests use this to guarantee isolation.
 * In production this is never called — the module state is built once
 * on boot and read from then on.
 */
export function resetRegistry(): void {
  registry.clear()
}
