// ADR-1025 Phase 2 Sprint 2.1 end-to-end verification.
//
// Proves the full orchestration path:
//   seed org → provisionStorageForOrg (fresh) → DB row + is_verified=true
//     → provisionStorageForOrg (re-run) → already_provisioned short-circuit
//
// Bypasses the Next.js HTTP route on purpose — calls the orchestrator
// directly with csOrchestrator(). The HTTP layer is thin (bearer auth +
// JSON marshalling); 9 mocked unit tests cover it. This script's value
// is exercising the full pipeline against the REAL CF account + REAL
// Supabase DB in one shot.
//
// Run:
//   bunx tsx scripts/verify-adr-1025-sprint-21.ts
//
// Env required (loaded from .env.local):
//   SUPABASE_CS_ORCHESTRATOR_DATABASE_URL
//   CLOUDFLARE_ACCOUNT_ID
//   CLOUDFLARE_ACCOUNT_API_TOKEN
//   CLOUDFLARE_API_TOKEN
//   STORAGE_NAME_SALT
//   MASTER_ENCRYPTION_KEY
//
// Idempotency: uses a fixed fixture org_id. Re-runs reuse the same
// bucket; each run deletes the stale export_configurations row at
// start so the first provision call always hits the fresh path.

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import postgres from 'postgres'
import { createClient } from '@supabase/supabase-js'

// ── Step 0: load .env.local into process.env ───────────────────────────
function loadEnv(path: string): void {
  try {
    const raw = readFileSync(path, 'utf8')
    for (const line of raw.split(/\r?\n/)) {
      if (!line || line.startsWith('#')) continue
      const m = /^([A-Z0-9_]+)=(.*)$/.exec(line)
      if (!m) continue
      const [, k, v] = m
      const val = v.replace(/^"|"$/g, '')
      if (!process.env[k]) process.env[k] = val
    }
  } catch (err) {
    console.error(`[skip] could not read ${path}: ${(err as Error).message}`)
  }
}
loadEnv(resolve(process.cwd(), '.env.local'))
loadEnv(resolve(process.cwd(), 'app/.env.local'))

// ── Imports after env load (safe because requireEnv is call-time) ──────
import { provisionStorageForOrg } from '../app/src/lib/storage/provision-org'
import { deriveBucketName } from '../app/src/lib/storage/cf-provision'

// Fixture IDs — deterministic so reruns are idempotent. Valid UUIDs with
// embedded sprint reference.
const FIXTURE_ACCOUNT_ID = 'adf10251-0000-4000-8000-e2e0252100aa'
const FIXTURE_ORG_ID = 'adf10251-0000-4000-8000-e2e025210000'
const FIXTURE_ACCOUNT_NAME = 'ADR-1025 Sprint 2.1 test account'
const FIXTURE_ORG_NAME = 'ADR-1025 Sprint 2.1 E2E verification'

function section(title: string): void {
  console.log('\n━━━ ' + title + ' ━━━')
}

async function main(): Promise<void> {
  const t0 = Date.now()
  const connectionString = process.env.SUPABASE_CS_ORCHESTRATOR_DATABASE_URL
  if (!connectionString) {
    throw new Error('SUPABASE_CS_ORCHESTRATOR_DATABASE_URL not set')
  }
  const pg = postgres(connectionString, {
    prepare: false,
    max: 3,
    idle_timeout: 10,
    connect_timeout: 10,
    ssl: 'require',
    transform: { undefined: null },
  })

  // Seed org via service-role Supabase client (cs_orchestrator doesn't have
  // INSERT on public.organisations — that's correct for prod). The provision
  // call itself still runs as cs_orchestrator.
  const supabaseUrl = process.env.SUPABASE_PROJECT_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!supabaseUrl || !serviceKey) {
    throw new Error('SUPABASE_PROJECT_URL + SUPABASE_SECRET_KEY required for test seed')
  }
  const admin = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  try {
    section('Step 1 — seed fixture account + org + reset export_configurations')
    const { error: acctErr } = await admin
      .from('accounts')
      .upsert(
        {
          id: FIXTURE_ACCOUNT_ID,
          name: FIXTURE_ACCOUNT_NAME,
          plan_code: 'trial_starter',
          status: 'trial',
        },
        { onConflict: 'id' },
      )
    if (acctErr) throw new Error(`account seed failed: ${acctErr.message}`)
    const { error: seedErr } = await admin
      .from('organisations')
      .upsert(
        { id: FIXTURE_ORG_ID, account_id: FIXTURE_ACCOUNT_ID, name: FIXTURE_ORG_NAME },
        { onConflict: 'id' },
      )
    if (seedErr) throw new Error(`org seed failed: ${seedErr.message}`)
    const { error: delErr, count } = await admin
      .from('export_configurations')
      .delete({ count: 'exact' })
      .eq('org_id', FIXTURE_ORG_ID)
    if (delErr) throw new Error(`stale row delete failed: ${delErr.message}`)
    console.log(`  org seeded, stale export_config rows deleted: ${count ?? 0}`)
    const expectedBucket = deriveBucketName(FIXTURE_ORG_ID)
    console.log(`  expected bucket: ${expectedBucket}`)

    section('Step 2 — first provision (should create bucket + token + verify + upsert)')
    const first = await provisionStorageForOrg(pg, FIXTURE_ORG_ID)
    console.log(`  status:     ${first.status}`)
    console.log(`  configId:   ${first.configId}`)
    console.log(`  bucketName: ${first.bucketName}`)
    console.log(`  probe.ok:   ${first.probe?.ok}`)
    console.log(`  probe.ms:   ${first.probe?.durationMs}`)
    if (first.status !== 'provisioned') {
      throw new Error(`expected 'provisioned', got '${first.status}'`)
    }
    if (first.bucketName !== expectedBucket) {
      throw new Error(
        `bucket name mismatch: expected ${expectedBucket}, got ${first.bucketName}`,
      )
    }

    section('Step 3 — verify DB state (export_configurations row)')
    const rows = await pg<
      Array<{
        id: string
        org_id: string
        storage_provider: string
        bucket_name: string
        region: string | null
        is_verified: boolean
        has_credential: boolean
      }>
    >`
      select id, org_id, storage_provider, bucket_name, region, is_verified,
             (write_credential_enc is not null and octet_length(write_credential_enc) > 0) as has_credential
        from public.export_configurations
       where org_id = ${FIXTURE_ORG_ID}
    `
    if (rows.length !== 1) {
      throw new Error(`expected 1 export_configurations row, got ${rows.length}`)
    }
    const row = rows[0]
    console.log(`  storage_provider: ${row.storage_provider}`)
    console.log(`  bucket_name:      ${row.bucket_name}`)
    console.log(`  region:           ${row.region}`)
    console.log(`  is_verified:      ${row.is_verified}`)
    console.log(`  has_credential:   ${row.has_credential}`)
    if (row.storage_provider !== 'cs_managed_r2') {
      throw new Error(`expected storage_provider='cs_managed_r2', got '${row.storage_provider}'`)
    }
    if (row.bucket_name !== expectedBucket) {
      throw new Error(`DB bucket_name mismatch: expected ${expectedBucket}, got ${row.bucket_name}`)
    }
    if (!row.is_verified) {
      throw new Error('expected is_verified=true')
    }
    if (!row.has_credential) {
      throw new Error('expected non-empty write_credential_enc')
    }

    section('Step 4 — second provision (should short-circuit to already_provisioned)')
    const second = await provisionStorageForOrg(pg, FIXTURE_ORG_ID)
    console.log(`  status:     ${second.status}`)
    console.log(`  configId:   ${second.configId}`)
    if (second.status !== 'already_provisioned') {
      throw new Error(`expected 'already_provisioned', got '${second.status}'`)
    }
    if (second.configId !== first.configId) {
      throw new Error('config_id changed between runs — not idempotent!')
    }

    section(`done — ${Date.now() - t0} ms`)
    console.log('  all 4 steps passed')
    console.log()
    console.log('  Note: the bucket + provisioned token remain in CF for idempotent reruns.')
    console.log(`  To fully tear down, delete bucket ${expectedBucket} + any tokens matching`)
    console.log(`  "cs-bucket-${expectedBucket}" via the CF dashboard.`)
  } finally {
    await pg.end()
  }
}

main().catch((err) => {
  console.error('\n✗ verification failed:', err)
  process.exit(1)
})
