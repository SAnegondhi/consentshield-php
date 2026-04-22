import { createHash } from 'node:crypto'
import { execSync } from 'node:child_process'
import { existsSync, mkdirSync, writeFileSync, readFileSync, cpSync, readdirSync, statSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { traceId } from './trace-id'

const HERE = dirname(fileURLToPath(import.meta.url))
const WORKSPACE_ROOT = resolve(HERE, '..')
const EVIDENCE_ROOT = resolve(WORKSPACE_ROOT, 'evidence')

// ─── Manifest types ─────────────────────────────────────────────────────

export interface ManifestSummary {
  total: number
  passed: number
  failed: number
  skipped: number
  flaky: number
}

export interface ManifestTestResult {
  file: string
  title: string
  project: string
  status: 'passed' | 'failed' | 'timedOut' | 'skipped' | 'interrupted' | 'flaky'
  duration_ms: number
  retries: number
  error_message?: string
  trace_ids: string[]
}

export interface Manifest {
  schema_version: '1.0'
  adr_ref: 'ADR-1014'
  run_id: string
  commit_sha: string
  commit_short: string
  branch: string | null
  started_at: string
  ended_at: string
  duration_ms: number
  node_version: string
  os: string
  playwright_projects: string[]
  tests: ManifestTestResult[]
  summary: ManifestSummary
  attachments: AttachmentManifest[]
}

export interface AttachmentManifest {
  path: string
  size: number
  sha256: string
}

// ─── Git helpers ─────────────────────────────────────────────────────────

function gitShow(args: string): string | null {
  try {
    return execSync(`git ${args}`, {
      cwd: resolve(WORKSPACE_ROOT, '..', '..'),
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore']
    }).trim()
  } catch {
    return null
  }
}

// ─── Run lifecycle ───────────────────────────────────────────────────────

export interface RunHandle {
  runId: string
  runDir: string
  attachmentsDir: string
  commitShort: string
  manifest: Partial<Manifest>
  startedAt: Date
}

export function startRun(): RunHandle {
  const startedAt = new Date()
  const commitSha = gitShow('rev-parse HEAD') ?? 'unknown'
  const commitShort = commitSha === 'unknown' ? 'unknown' : commitSha.slice(0, 12)
  const branch = gitShow('rev-parse --abbrev-ref HEAD')

  const runId = traceId('run')
  // evidence/<commitShort>/<runId>/
  const runDir = join(EVIDENCE_ROOT, commitShort, runId)
  const attachmentsDir = join(runDir, 'attachments')
  mkdirSync(attachmentsDir, { recursive: true })

  const partial: Partial<Manifest> = {
    schema_version: '1.0',
    adr_ref: 'ADR-1014',
    run_id: runId,
    commit_sha: commitSha,
    commit_short: commitShort,
    branch,
    started_at: startedAt.toISOString(),
    node_version: process.version,
    os: `${process.platform} ${process.arch}`,
    tests: [],
    summary: { total: 0, passed: 0, failed: 0, skipped: 0, flaky: 0 }
  }

  return {
    runId,
    runDir,
    attachmentsDir,
    commitShort,
    manifest: partial,
    startedAt
  }
}

/** Write a single in-memory attachment to the run's attachments/ folder. */
export function addAttachment(
  handle: RunHandle,
  relPath: string,
  body: string | Uint8Array
): void {
  const dest = join(handle.attachmentsDir, relPath)
  mkdirSync(dirname(dest), { recursive: true })
  writeFileSync(dest, body)
}

/** Copy a directory (e.g., playwright-report/) into the run's attachments/. */
export function copyDirAttachment(
  handle: RunHandle,
  srcDir: string,
  relPath: string
): void {
  if (!existsSync(srcDir)) return
  const dest = join(handle.attachmentsDir, relPath)
  cpSync(srcDir, dest, { recursive: true })
}

export function recordTest(handle: RunHandle, test: ManifestTestResult): void {
  handle.manifest.tests!.push(test)
  const bucket = bucketFor(test.status)
  const summary = handle.manifest.summary!
  summary[bucket] = (summary[bucket] ?? 0) + 1
  summary.total++
}

function bucketFor(
  status: ManifestTestResult['status']
): keyof Omit<ManifestSummary, 'total'> {
  // timedOut + interrupted roll up into failed for the summary; full detail
  // stays on the per-test record.
  switch (status) {
    case 'flaky':
      return 'flaky'
    case 'skipped':
      return 'skipped'
    case 'passed':
      return 'passed'
    default:
      return 'failed'
  }
}

export function finalize(
  handle: RunHandle,
  opts: { playwrightProjects: string[] } = { playwrightProjects: [] }
): { manifestPath: string; sealPath: string; seal: string } {
  const endedAt = new Date()
  handle.manifest.ended_at = endedAt.toISOString()
  handle.manifest.duration_ms = endedAt.getTime() - handle.startedAt.getTime()
  handle.manifest.playwright_projects = opts.playwrightProjects

  // First pass: walk all attachment files (attachments/ tree), record sizes + hashes.
  const attachmentEntries: AttachmentManifest[] = []
  if (existsSync(handle.attachmentsDir)) {
    walk(handle.attachmentsDir).forEach((absPath) => {
      const rel = 'attachments/' + relative(handle.attachmentsDir, absPath)
      const body = readFileSync(absPath)
      attachmentEntries.push({
        path: rel,
        size: body.byteLength,
        sha256: sha256(body)
      })
    })
  }
  attachmentEntries.sort((a, b) => a.path.localeCompare(b.path))
  handle.manifest.attachments = attachmentEntries

  const manifestPath = join(handle.runDir, 'manifest.json')
  const manifestJson = JSON.stringify(handle.manifest, null, 2) + '\n'
  writeFileSync(manifestPath, manifestJson)

  // Seal: walk every file in runDir EXCEPT seal.txt itself. Produce a
  // deterministic line-based ledger (sorted by relative path) of
  // `<sha256>  <relpath>` entries, then SHA-256 that ledger.
  const ledgerLines: string[] = []
  walk(handle.runDir).forEach((absPath) => {
    const rel = relative(handle.runDir, absPath)
    if (rel === 'seal.txt') return
    const h = sha256(readFileSync(absPath))
    ledgerLines.push(`${h}  ${rel.replace(/\\/g, '/')}`)
  })
  ledgerLines.sort()
  const ledger = ledgerLines.join('\n') + '\n'
  const seal = sha256(Buffer.from(ledger, 'utf8'))
  const sealPath = join(handle.runDir, 'seal.txt')
  writeFileSync(
    sealPath,
    [
      '# ConsentShield E2E evidence seal — schema 1.0',
      `# run_id=${handle.runId} commit=${handle.manifest.commit_sha} finalized=${endedAt.toISOString()}`,
      '#',
      `algorithm: sha256`,
      `seal: ${seal}`,
      '',
      '# Ledger (one line per archive file, sorted):',
      ledger.trimEnd(),
      ''
    ].join('\n')
  )

  return { manifestPath, sealPath, seal }
}

// ─── Utilities ───────────────────────────────────────────────────────────

function walk(dir: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry)
    const st = statSync(p)
    if (st.isDirectory()) out.push(...walk(p))
    else out.push(p)
  }
  return out
}

function sha256(body: Buffer | Uint8Array): string {
  return createHash('sha256').update(body).digest('hex')
}
