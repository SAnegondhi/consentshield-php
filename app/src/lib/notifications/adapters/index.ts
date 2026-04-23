// ADR-1005 Sprint 6.2 + 6.3 — adapter barrel.
//
// Importing this module registers the five production adapters with the
// singleton registry. Callers do:
//
//   import '@/lib/notifications/adapters'
//   // registry now has slack / teams / discord / pagerduty / custom_webhook
//
// Tests that swap in the mock adapter should import from './mock'
// directly and call `registerAdapter(createMockAdapter())` + use
// `resetRegistry()` to tear down afterwards.

import { createCustomWebhookAdapter } from './custom-webhook'
import { createDiscordAdapter } from './discord'
import { createPagerDutyAdapter } from './pagerduty'
import { registerAdapter } from './registry'
import { createSlackAdapter } from './slack'
import { createTeamsAdapter } from './teams'

registerAdapter(createSlackAdapter())
registerAdapter(createTeamsAdapter())
registerAdapter(createDiscordAdapter())
registerAdapter(createPagerDutyAdapter())
registerAdapter(createCustomWebhookAdapter())

export { createSlackAdapter, buildSlackPayload } from './slack'
export { createTeamsAdapter, buildTeamsPayload } from './teams'
export { createDiscordAdapter, buildDiscordPayload } from './discord'
export { createPagerDutyAdapter, buildPagerDutyPayload } from './pagerduty'
export {
  createCustomWebhookAdapter,
  buildCustomWebhookPayload,
} from './custom-webhook'
