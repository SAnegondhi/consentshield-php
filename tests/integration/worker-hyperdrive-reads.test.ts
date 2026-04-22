import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { getServiceClient } from '../rls/helpers'

// ADR-1010 Phase 3 Sprint 3.1 — integration test for the Hyperdrive
// read path. Runs postgres.js directly against the dev Supabase pooler
// as `cs_worker`, exercising the same SQL the Worker issues in prod.
//
// This test is skip-on-missing-env. When SUPABASE_CS_WORKER_DATABASE_URL
// is not set (CI without the secret, hosted runners, etc.) the suite
// is skipped so the rest of the integration run stays green.
//
// Miniflare-side tests (app/tests/worker/) still cover the REST
// fallback branch — env.HYPERDRIVE is absent there. Together the two
// layers give us: the shape of the SQL (proved here), the integration
// with the handler logic (proved in Miniflare).

const CS_WORKER_DSN = process.env.SUPABASE_CS_WORKER_DATABASE_URL

// Dynamic import so the skip-on-missing-env pattern doesn't fail the
// test file at load time.
const ipostgres = async () => (await import('postgres')).default

const admin = getServiceClient()

const fixtureSuffix = `hdp-${Date.now()}`
let orgId: string
let propertyId: string
let bannerId: string
let accountId: string

const skipSuite = !CS_WORKER_DSN ? describe.skip : describe

beforeAll(async () => {
  if (!CS_WORKER_DSN) return

  const { data: account } = await admin
    .from('accounts')
    .insert({ name: `Hyperdrive fixture ${fixtureSuffix}`, plan_code: 'trial_starter', status: 'trial' })
    .select('id')
    .single()
  accountId = (account as { id: string }).id

  const { data: org } = await admin
    .from('organisations')
    .insert({ name: `Hyperdrive fixture ${fixtureSuffix}`, account_id: accountId })
    .select('id')
    .single()
  orgId = (org as { id: string }).id

  const { data: prop } = await admin
    .from('web_properties')
    .insert({
      org_id: orgId,
      name: 'hyperdrive fixture',
      url: `https://hd-${fixtureSuffix}.test`,
      allowed_origins: [`https://hd-${fixtureSuffix}.test`],
      event_signing_secret: `test_secret_${fixtureSuffix}`,
    })
    .select('id')
    .single()
  propertyId = (prop as { id: string }).id

  const { data: banner } = await admin
    .from('consent_banners')
    .insert({
      org_id: orgId,
      property_id: propertyId,
      version: 1,
      is_active: true,
      headline: 'HD test',
      body_copy: 'HD test',
      purposes: [],
    })
    .select('id')
    .single()
  bannerId = (banner as { id: string }).id
})

afterAll(async () => {
  if (!CS_WORKER_DSN) return
  if (orgId) await admin.from('organisations').delete().eq('id', orgId)
  if (accountId) await admin.from('accounts').delete().eq('id', accountId)
})

skipSuite('ADR-1010 P3 S3.1 — cs_worker Hyperdrive read path (postgres.js)', () => {
  it('SELECTs web_properties allowed_origins + event_signing_secret', async () => {
    const postgres = await ipostgres()
    const sql = postgres(CS_WORKER_DSN!, { prepare: false, connect_timeout: 10, idle_timeout: 5 })
    try {
      const rows = await sql<Array<{ allowed_origins: string[]; event_signing_secret: string }>>`
        select allowed_origins, event_signing_secret
          from public.web_properties
         where id = ${propertyId}
         limit 1
      `
      expect(rows).toHaveLength(1)
      expect(rows[0].allowed_origins).toContain(`https://hd-${fixtureSuffix}.test`)
      expect(rows[0].event_signing_secret).toBe(`test_secret_${fixtureSuffix}`)
    } finally {
      await sql.end({ timeout: 1 })
    }
  })

  it('SELECTs consent_banners for the active record', async () => {
    const postgres = await ipostgres()
    const sql = postgres(CS_WORKER_DSN!, { prepare: false, connect_timeout: 10, idle_timeout: 5 })
    try {
      const rows = await sql<Array<{ id: string; is_active: boolean }>>`
        select id, is_active
          from public.consent_banners
         where property_id = ${propertyId}
           and is_active = true
         order by version desc
         limit 1
      `
      expect(rows).toHaveLength(1)
      expect(rows[0].id).toBe(bannerId)
    } finally {
      await sql.end({ timeout: 1 })
    }
  })

  it('SELECTs tracker_signatures (non-empty seed)', async () => {
    const postgres = await ipostgres()
    const sql = postgres(CS_WORKER_DSN!, { prepare: false, connect_timeout: 10, idle_timeout: 5 })
    try {
      const rows = await sql<Array<{ service_slug: string }>>`
        select service_slug from public.tracker_signatures limit 5
      `
      // The seed ships with multiple rows; we don't pin a specific count,
      // just that reads succeed and return the expected shape.
      expect(Array.isArray(rows)).toBe(true)
      for (const r of rows) expect(typeof r.service_slug).toBe('string')
    } finally {
      await sql.end({ timeout: 1 })
    }
  })

  it('UPDATEs web_properties.snippet_last_seen_at (cs_worker has grant on this column only)', async () => {
    const postgres = await ipostgres()
    const sql = postgres(CS_WORKER_DSN!, { prepare: false, connect_timeout: 10, idle_timeout: 5 })
    try {
      await sql`
        update public.web_properties
           set snippet_last_seen_at = now()
         where id = ${propertyId}
      `
      // Re-read via service client to verify the update landed.
      const { data } = await admin
        .from('web_properties')
        .select('snippet_last_seen_at')
        .eq('id', propertyId)
        .single()
      expect((data as { snippet_last_seen_at: string | null }).snippet_last_seen_at).not.toBeNull()
    } finally {
      await sql.end({ timeout: 1 })
    }
  })

  it('UPDATEs to other columns on web_properties are DENIED for cs_worker', async () => {
    const postgres = await ipostgres()
    const sql = postgres(CS_WORKER_DSN!, { prepare: false, connect_timeout: 10, idle_timeout: 5 })
    try {
      await expect(
        sql`update public.web_properties set name = 'mutated' where id = ${propertyId}`,
      ).rejects.toMatchObject({ code: '42501' })
    } finally {
      await sql.end({ timeout: 1 })
    }
  })
})
