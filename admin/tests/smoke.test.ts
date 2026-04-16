import { describe, it, expect } from 'vitest'

// Smoke test — proves `bun --filter @consentshield/admin run test` finds
// and executes a test. Real admin test suites ship from ADR-0028 onwards.
describe('admin scaffold smoke', () => {
  it('is reachable from the admin workspace', () => {
    expect(true).toBe(true)
  })
})
