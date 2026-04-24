// ADR-1019 Sprint 2.1 — object-key layout tests.

import { describe, expect, it } from 'vitest'
import { objectKeyFor } from '@/lib/delivery/object-key'

const ROW_ID = '11111111-2222-4333-8444-555555555555'

describe('objectKeyFor', () => {
  it('lays out <prefix><event_type>/<YYYY>/<MM>/<DD>/<id>.json', () => {
    expect(
      objectKeyFor('org-acme/', {
        id: ROW_ID,
        event_type: 'consent_event',
        created_at: new Date('2026-04-24T18:05:32.123Z'),
      }),
    ).toBe(`org-acme/consent_event/2026/04/24/${ROW_ID}.json`)
  })

  it('handles empty path_prefix (bucket-rooted)', () => {
    expect(
      objectKeyFor('', {
        id: ROW_ID,
        event_type: 'audit_log_entry',
        created_at: new Date('2026-01-02T03:04:05.000Z'),
      }),
    ).toBe(`audit_log_entry/2026/01/02/${ROW_ID}.json`)
  })

  it('handles null/undefined path_prefix as empty', () => {
    const d = new Date('2026-12-31T23:59:59.999Z')
    expect(objectKeyFor(null, { id: ROW_ID, event_type: 'x', created_at: d })).toBe(
      `x/2026/12/31/${ROW_ID}.json`,
    )
    expect(
      objectKeyFor(undefined, { id: ROW_ID, event_type: 'x', created_at: d }),
    ).toBe(`x/2026/12/31/${ROW_ID}.json`)
  })

  it('uses UTC, not local time, for date partition', () => {
    // This UTC date is 23:30 UTC on 2026-04-24 — local times east of UTC
    // would push it into the next day. Partition must use UTC.
    const d = new Date('2026-04-24T23:30:00.000Z')
    expect(
      objectKeyFor('', { id: ROW_ID, event_type: 'e', created_at: d }),
    ).toBe(`e/2026/04/24/${ROW_ID}.json`)
  })

  it('zero-pads month + day', () => {
    expect(
      objectKeyFor('', {
        id: ROW_ID,
        event_type: 'e',
        created_at: new Date('2026-03-07T00:00:00.000Z'),
      }),
    ).toBe(`e/2026/03/07/${ROW_ID}.json`)
  })

  it('accepts a string created_at', () => {
    expect(
      objectKeyFor('', {
        id: ROW_ID,
        event_type: 'e',
        created_at: '2026-04-24T00:00:00.000Z',
      }),
    ).toBe(`e/2026/04/24/${ROW_ID}.json`)
  })

  it('throws on an invalid created_at', () => {
    expect(() =>
      objectKeyFor('', {
        id: ROW_ID,
        event_type: 'e',
        created_at: 'not-a-date',
      }),
    ).toThrow(/invalid created_at/)
  })
})
