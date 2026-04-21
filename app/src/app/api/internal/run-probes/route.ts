import { NextResponse } from 'next/server'
import type postgres from 'postgres'
import { Sandbox } from '@vercel/sandbox'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'
import { csOrchestrator } from '@/lib/api/cs-orchestrator-client'
import {
  computeViolations,
  matchSignatures,
  overallStatus,
  type Signature,
} from '@/lib/probes/signature-match'

// ADR-0041 — probe orchestrator on Vercel Functions.
// Called by pg_cron (bearer-authenticated via PROBE_CRON_SECRET). For each
// active probe due a run, creates an ephemeral Vercel Sandbox, copies in
// sandbox-scripts/**, runs Playwright scenario, collects stdout JSON,
// runs signature matching locally, and writes consent_probe_runs row.
//
// ADR-1013 Sprint 2.2 — migrated off Supabase REST + HS256 JWT onto
// the cs_orchestrator direct-Postgres pool (postgres.js). Last Next.js
// surface to leave the CS_ORCHESTRATOR_ROLE_KEY path; with this commit
// the Next.js runtime is fully off HS256.

type Sql = ReturnType<typeof postgres>

const PROBE_CRON_SECRET = process.env.PROBE_CRON_SECRET ?? ''
const VERCEL_TEAM = process.env.VERCEL_TEAM_ID
const VERCEL_PROJECT = process.env.VERCEL_PROJECT_ID
const SANDBOX_TIMEOUT_MS = 120_000

interface Probe {
  id: string
  org_id: string
  property_id: string
  probe_type: string
  consent_state: Record<string, boolean>
  schedule: string
  is_active: boolean
}

interface SignatureRow {
  service_slug: string
  category: string
  is_functional: boolean
  detection_rules: unknown
}

export async function POST(request: Request) {
  const auth = request.headers.get('authorization') ?? ''
  if (!PROBE_CRON_SECRET || !auth.startsWith('Bearer ')) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }
  const token = auth.slice('Bearer '.length).trim()
  if (token !== PROBE_CRON_SECRET) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const sql = csOrchestrator()

  let probes: Probe[]
  try {
    probes = await sql<Probe[]>`
      select id, org_id, property_id, probe_type, consent_state,
             schedule, is_active
        from public.consent_probes
       where is_active = true
         and (next_run_at is null or next_run_at <= now())
       limit 20
    `
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'probe_fetch_failed' },
      { status: 500 },
    )
  }

  if (probes.length === 0) {
    return NextResponse.json({ status: 'no_probes_due' }, { status: 200 })
  }

  let sigRows: SignatureRow[]
  try {
    sigRows = await sql<SignatureRow[]>`
      select service_slug, category, is_functional, detection_rules
        from public.tracker_signatures
       where is_active = true
    `
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'signature_fetch_failed' },
      { status: 500 },
    )
  }
  const signatures = sigRows as unknown as Signature[]

  const results: Array<{
    probe_id: string
    status: string
    violations?: number
    error?: string
  }> = []

  for (const probe of probes) {
    try {
      const r = await runProbe(sql, probe, signatures)
      results.push(r)
    } catch (e) {
      results.push({
        probe_id: probe.id,
        status: 'failed',
        error: e instanceof Error ? e.message : 'unknown',
      })
    }
  }

  return NextResponse.json(
    { processed: probes.length, results },
    { status: 200 },
  )
}

async function runProbe(
  sql: Sql,
  probe: Probe,
  signatures: Signature[],
): Promise<{ probe_id: string; status: string; violations: number }> {
  const propertyRows = await sql<Array<{ url: string | null }>>`
    select url
      from public.web_properties
     where id = ${probe.property_id}
     limit 1
  `
  const propertyUrl = propertyRows[0]?.url
  if (!propertyUrl) {
    throw new Error('property_not_found_or_no_url')
  }

  const config = {
    url: propertyUrl,
    consent_cookie_name: 'cs_consent',
    consent_state: probe.consent_state ?? {},
    wait_ms: 3000,
  }

  // Create the sandbox.
  const sandbox = await Sandbox.create({
    runtime: 'node24',
    timeout: SANDBOX_TIMEOUT_MS,
    teamId: VERCEL_TEAM,
    projectId: VERCEL_PROJECT,
  })

  try {
    // Copy sandbox-scripts/* in.
    const scriptsDir = path.join(process.cwd(), 'sandbox-scripts')
    await copyDirectoryToSandbox(sandbox, scriptsDir, '/work')

    // Install deps inside the sandbox.
    const install = await sandbox.runCommand({
      cmd: 'sh',
      args: ['-c', 'cd /work && npm install --omit=dev && npx playwright install chromium'],
    })
    if (install.exitCode !== 0) {
      const err = await install.stderr()
      throw new Error(`sandbox install failed: ${err.slice(0, 400)}`)
    }

    // Write probe config to /tmp/probe-input.json.
    await sandbox.writeFiles([
      { path: '/tmp/probe-input.json', content: Buffer.from(JSON.stringify(config)) },
    ])

    const runResult = await sandbox.runCommand({
      cmd: 'sh',
      args: ['-c', 'cd /work && node probe-runner.mjs'],
    })
    if (runResult.exitCode !== 0) {
      const err = await runResult.stderr()
      throw new Error(`sandbox probe failed: ${err.slice(0, 400)}`)
    }

    const raw = (await runResult.stdout()).trim()
    let parsed: {
      url: string
      status: number | null
      page_load_ms: number
      title: string | null
      user_agent: string
      consent_state: Record<string, boolean>
      network_urls: string[]
      script_srcs: string[]
      iframe_srcs: string[]
      img_srcs: string[]
      cookies: Array<{ name: string; domain: string; path: string }>
    }
    try {
      parsed = JSON.parse(raw)
    } catch {
      throw new Error(`sandbox stdout not JSON: ${raw.slice(0, 200)}`)
    }

    const allUrls = [
      ...parsed.network_urls,
      ...parsed.script_srcs,
      ...parsed.iframe_srcs,
      ...parsed.img_srcs,
    ]
    const detections = matchSignatures(allUrls, signatures)
    const violations = computeViolations(detections, parsed.consent_state ?? {})
    const status = overallStatus(violations)

    const result = {
      browser_version: parsed.user_agent,
      user_agent: parsed.user_agent,
      page_load_ms: parsed.page_load_ms,
      title: parsed.title,
      http_status: parsed.status,
      detected_trackers: detections.map((d) => ({
        service_slug: d.slug,
        category: d.category,
        is_functional: d.functional,
        url: d.url,
        matched_pattern: d.matched_pattern,
      })),
      violations,
      overall_status: status,
    }

    const nowIso = new Date().toISOString()
    const consentStateJson = JSON.stringify(probe.consent_state ?? {})
    const resultJson = JSON.stringify(result)
    await sql`
      insert into public.consent_probe_runs (
        org_id, probe_id, property_id, run_at, consent_state,
        overall_status, result
      ) values (
        ${probe.org_id},
        ${probe.id},
        ${probe.property_id},
        ${nowIso},
        ${consentStateJson}::jsonb,
        ${status},
        ${resultJson}::jsonb
      )
    `

    const nextRun = computeNextRun(probe.schedule).toISOString()
    const lastResultJson = JSON.stringify({
      overall_status: status,
      violations: violations.length,
    })
    await sql`
      update public.consent_probes
         set last_run_at  = ${nowIso},
             last_result  = ${lastResultJson}::jsonb,
             next_run_at  = ${nextRun}
       where id = ${probe.id}
    `

    return { probe_id: probe.id, status, violations: violations.length }
  } finally {
    try {
      await sandbox.stop()
    } catch {
      // best-effort
    }
  }
}

async function copyDirectoryToSandbox(
  sandbox: Sandbox,
  localDir: string,
  remoteDir: string,
): Promise<void> {
  for (const entry of readdirSync(localDir)) {
    const localPath = path.join(localDir, entry)
    const remotePath = `${remoteDir}/${entry}`
    const s = statSync(localPath)
    if (s.isDirectory()) {
      await sandbox.runCommand({ cmd: 'mkdir', args: ['-p', remotePath] })
      await copyDirectoryToSandbox(sandbox, localPath, remotePath)
    } else {
      const content = readFileSync(localPath)
      await sandbox.writeFiles([{ path: remotePath, content }])
    }
  }
}

function computeNextRun(schedule: string): Date {
  const now = Date.now()
  switch (schedule) {
    case 'hourly':
      return new Date(now + 60 * 60 * 1000)
    case 'daily':
      return new Date(now + 24 * 60 * 60 * 1000)
    case 'weekly':
    default:
      return new Date(now + 7 * 24 * 60 * 60 * 1000)
  }
}
