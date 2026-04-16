import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createClient, SupabaseClient } from '@supabase/supabase-js'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  throw new Error('Missing Supabase env vars for SLA tests.')
}

let admin: SupabaseClient
let orgId: string
const seededIds: string[] = []

beforeAll(async () => {
  admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY)
  const { data, error } = await admin
    .from('organisations')
    .insert({ name: `SLA Test Org ${Date.now()}` })
    .select('id')
    .single()
  if (error) throw new Error(`createOrg failed: ${error.message}`)
  orgId = data!.id
}, 30000)

afterAll(async () => {
  if (orgId) await admin.from('organisations').delete().eq('id', orgId)
}, 30000)

async function insertWithCreatedAt(createdAtIso: string) {
  const { data, error } = await admin
    .from('rights_requests')
    .insert({
      org_id: orgId,
      request_type: 'access',
      requestor_name: 'SLA Test',
      requestor_email: 'sla-test@example.com',
      created_at: createdAtIso,
    })
    .select('id, created_at, sla_deadline')
    .single()
  if (error) throw new Error(`insert failed: ${error.message}`)
  seededIds.push(data!.id)
  return data as { id: string; created_at: string; sla_deadline: string }
}

function addThirtyDaysMs(iso: string): number {
  const d = new Date(iso)
  d.setUTCDate(d.getUTCDate() + 30)
  return d.getTime()
}

function epoch(ts: string): number {
  return new Date(ts).getTime()
}

describe('set_rights_request_sla trigger — boundary dates', () => {
  it('mid-year: 2026-06-15 + 30d = 2026-07-15', async () => {
    const row = await insertWithCreatedAt('2026-06-15T00:00:00Z')
    expect(epoch(row.sla_deadline)).toBe(epoch('2026-07-15T00:00:00Z'))
  })

  it('year-crossing: 2026-12-10 + 30d = 2027-01-09', async () => {
    const row = await insertWithCreatedAt('2026-12-10T00:00:00Z')
    expect(epoch(row.sla_deadline)).toBe(epoch('2027-01-09T00:00:00Z'))
  })

  it('leap-year Feb: 2028-02-01 + 30d = 2028-03-02 (Feb has 29 days)', async () => {
    const row = await insertWithCreatedAt('2028-02-01T00:00:00Z')
    expect(epoch(row.sla_deadline)).toBe(epoch('2028-03-02T00:00:00Z'))
  })

  it('non-leap Feb: 2027-02-01 + 30d = 2027-03-03 (Feb has 28 days)', async () => {
    const row = await insertWithCreatedAt('2027-02-01T00:00:00Z')
    expect(epoch(row.sla_deadline)).toBe(epoch('2027-03-03T00:00:00Z'))
  })

  it('IST-anchored offset: 2026-04-16T15:30:00+05:30 + 30d', async () => {
    const row = await insertWithCreatedAt('2026-04-16T15:30:00+05:30')
    // Driver round-trips to UTC. Trigger adds 30 calendar days in UTC.
    expect(epoch(row.created_at)).toBe(epoch('2026-04-16T10:00:00Z'))
    expect(epoch(row.sla_deadline)).toBe(epoch('2026-05-16T10:00:00Z'))
  })

  it('month-boundary overflow: 2026-10-31 + 30d = 2026-11-30', async () => {
    const row = await insertWithCreatedAt('2026-10-31T12:00:00Z')
    expect(epoch(row.sla_deadline)).toBe(epoch('2026-11-30T12:00:00Z'))
  })
})

describe('set_rights_request_sla trigger — property sweep', () => {
  it('asserts +30 calendar days for 20 random dates across 2026–2030', async () => {
    const rng = (() => {
      let s = 0x12345678
      return () => {
        s = (s * 1103515245 + 12345) & 0x7fffffff
        return s / 0x80000000
      }
    })()

    const mismatches: string[] = []

    for (let i = 0; i < 20; i++) {
      const year = 2026 + Math.floor(rng() * 5)
      const month = 1 + Math.floor(rng() * 12)
      const day = 1 + Math.floor(rng() * 28)
      const hour = Math.floor(rng() * 24)
      const min = Math.floor(rng() * 60)
      const createdAt = new Date(Date.UTC(year, month - 1, day, hour, min, 0)).toISOString()
      const expectedMs = addThirtyDaysMs(createdAt)

      const row = await insertWithCreatedAt(createdAt)
      const gotMs = epoch(row.sla_deadline)
      if (gotMs !== expectedMs) {
        mismatches.push(
          `${createdAt} → expected ${new Date(expectedMs).toISOString()}, got ${row.sla_deadline}`,
        )
      }
    }

    expect(mismatches, mismatches.join('\n')).toHaveLength(0)
  }, 120000)
})
