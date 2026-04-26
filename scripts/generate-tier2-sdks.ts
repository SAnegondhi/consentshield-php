/**
 * ADR-1028 Phase 1 Sprint 1.1 — regenerate the three Tier-2 SDKs
 * (Java + .NET + PHP) from the OpenAPI spec at app/public/openapi.yaml.
 *
 * Source of truth: app/public/openapi.yaml.
 * Targets:        packages/{java,dotnet,php}-client/generated/
 * Tool:           openapitools/openapi-generator-cli@v7.x (Docker; no global Node dep)
 * Configs:        scripts/openapi-config/{java,csharp,php}.json
 *
 * Run:
 *   bunx tsx scripts/generate-tier2-sdks.ts                    # writes
 *   bunx tsx scripts/generate-tier2-sdks.ts --check            # exits 1 on drift
 *   bunx tsx scripts/generate-tier2-sdks.ts --target=java      # one target only
 *
 * The Docker image tag is exact-pinned (Rule 17). Bumping the generator
 * version is an ADR-1028 §Architecture Changes amendment, not a routine
 * lockfile bump — generator output churn is the whole point of pinning.
 *
 * --check semantics: regenerate to a temp dir, compare every file under
 *   packages/{java,dotnet,php}-client/generated/ for byte-for-byte equality
 *   (after stripping known non-deterministic noise: nothing today, because
 *   `hideGenerationTimestamp: true` is set in every config).
 *   Exit 1 on any drift; print the first ten differing files.
 */

import { mkdir, mkdtemp, rm, readdir, readFile, stat } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const here = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = path.resolve(here, '..')
const OPENAPI_SRC = path.join(REPO_ROOT, 'app', 'public', 'openapi.yaml')
const CONFIG_DIR = path.join(REPO_ROOT, 'scripts', 'openapi-config')

const GENERATOR_IMAGE = 'openapitools/openapi-generator-cli:v7.10.0'

interface Target {
  name: 'java' | 'csharp' | 'php'
  generator: string // openapi-generator generator name
  outDir: string // packages/<x>-client/generated
  configFile: string
}

const TARGETS: Target[] = [
  {
    name: 'java',
    generator: 'java',
    outDir: path.join(REPO_ROOT, 'packages', 'java-client', 'generated'),
    configFile: path.join(CONFIG_DIR, 'java.json'),
  },
  {
    name: 'csharp',
    generator: 'csharp',
    outDir: path.join(REPO_ROOT, 'packages', 'dotnet-client', 'generated'),
    configFile: path.join(CONFIG_DIR, 'csharp.json'),
  },
  {
    name: 'php',
    generator: 'php',
    outDir: path.join(REPO_ROOT, 'packages', 'php-client', 'generated'),
    configFile: path.join(CONFIG_DIR, 'php.json'),
  },
]

interface Options {
  check: boolean
  only: Target['name'] | null
}

function parseArgs(argv: string[]): Options {
  const opts: Options = { check: false, only: null }
  for (const a of argv) {
    if (a === '--check') opts.check = true
    else if (a.startsWith('--target=')) {
      const v = a.slice('--target='.length)
      if (v !== 'java' && v !== 'csharp' && v !== 'php') {
        throw new Error(`unknown target: ${v}`)
      }
      opts.only = v
    } else if (a === '--help' || a === '-h') {
      console.log(
        'usage: bunx tsx scripts/generate-tier2-sdks.ts [--check] [--target=java|csharp|php]',
      )
      process.exit(0)
    } else {
      throw new Error(`unknown flag: ${a}`)
    }
  }
  return opts
}

function ensureDockerAvailable(): void {
  const r = spawnSync('docker', ['info'], { stdio: 'pipe' })
  if (r.status !== 0) {
    throw new Error(
      'docker daemon is not reachable. Start Docker Desktop and re-run. ' +
        '(stderr: ' +
        (r.stderr?.toString().trim() ?? 'unknown') +
        ')',
    )
  }
}

function runGenerator(target: Target, outDir: string): void {
  // openapi-generator-cli inside Docker reads from /local/...
  // We mount REPO_ROOT at /local so paths translate cleanly.
  const relSpec = path.relative(REPO_ROOT, OPENAPI_SRC)
  const relConfig = path.relative(REPO_ROOT, target.configFile)
  const relOut = path.relative(REPO_ROOT, outDir)

  const args = [
    'run',
    '--rm',
    '-v',
    `${REPO_ROOT}:/local`,
    GENERATOR_IMAGE,
    'generate',
    '-i',
    `/local/${relSpec}`,
    '-g',
    target.generator,
    '-c',
    `/local/${relConfig}`,
    '-o',
    `/local/${relOut}`,
    '--skip-validate-spec',
  ]

  const r = spawnSync('docker', args, { stdio: 'inherit' })
  if (r.status !== 0) {
    throw new Error(`openapi-generator failed for target=${target.name}`)
  }
}

async function listFilesRecursive(root: string): Promise<string[]> {
  const out: string[] = []
  async function walk(dir: string): Promise<void> {
    let entries: { name: string; isDir: boolean; isFile: boolean }[]
    try {
      const raw = await readdir(dir, { withFileTypes: true })
      entries = raw.map((e) => ({
        name: e.name,
        isDir: e.isDirectory(),
        isFile: e.isFile(),
      }))
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return
      throw err
    }
    for (const e of entries) {
      const p = path.join(dir, e.name)
      if (e.isDir) await walk(p)
      else if (e.isFile) out.push(p)
    }
  }
  await walk(root)
  return out
}

async function diffTrees(
  expected: string,
  actual: string,
): Promise<{ path: string; reason: 'missing' | 'extra' | 'changed' }[]> {
  const drift: { path: string; reason: 'missing' | 'extra' | 'changed' }[] = []

  const expectedFiles = await listFilesRecursive(expected)
  const actualFiles = await listFilesRecursive(actual)

  const expectedRel = new Set(expectedFiles.map((f) => path.relative(expected, f)))
  const actualRel = new Set(actualFiles.map((f) => path.relative(actual, f)))

  for (const rel of expectedRel) {
    if (!actualRel.has(rel)) drift.push({ path: rel, reason: 'extra' })
  }
  for (const rel of actualRel) {
    if (!expectedRel.has(rel)) drift.push({ path: rel, reason: 'missing' })
  }
  for (const rel of actualRel) {
    if (!expectedRel.has(rel)) continue
    const a = await readFile(path.join(expected, rel))
    const b = await readFile(path.join(actual, rel))
    if (!a.equals(b)) drift.push({ path: rel, reason: 'changed' })
  }

  return drift
}

async function generateAll(opts: Options): Promise<void> {
  ensureDockerAvailable()
  const stExpected = await stat(OPENAPI_SRC).catch(() => null)
  if (!stExpected) {
    throw new Error(`OpenAPI spec missing at ${OPENAPI_SRC}`)
  }

  const targets = opts.only ? TARGETS.filter((t) => t.name === opts.only) : TARGETS

  if (!opts.check) {
    for (const t of targets) {
      console.log(`[generate-tier2-sdks] regenerating ${t.name} → ${path.relative(REPO_ROOT, t.outDir)}`)
      await rm(t.outDir, { recursive: true, force: true })
      await mkdir(t.outDir, { recursive: true })
      runGenerator(t, t.outDir)
    }
    console.log('[generate-tier2-sdks] OK')
    return
  }

  // --check: regenerate to a tempdir per target, diff against the committed tree.
  // The tempdir MUST live under REPO_ROOT — Docker mounts only ${REPO_ROOT}:/local,
  // so writes outside REPO_ROOT land in container-only space and the diff sees an
  // empty regen vs the committed tree.
  const scratchRoot = path.join(REPO_ROOT, '.tmp-tier2-check')
  await rm(scratchRoot, { recursive: true, force: true })
  await mkdir(scratchRoot, { recursive: true })
  const tmpRoot = await mkdtemp(path.join(scratchRoot, 'run-'))
  let totalDrift = 0
  try {
    for (const t of targets) {
      const tmpOut = path.join(tmpRoot, t.name)
      await mkdir(tmpOut, { recursive: true })
      runGenerator(t, tmpOut)
      const drift = await diffTrees(t.outDir, tmpOut)
      if (drift.length > 0) {
        totalDrift += drift.length
        console.error(
          `\n[generate-tier2-sdks] DRIFT in ${t.name}: ${drift.length} files differ from a fresh regeneration.`,
        )
        for (const d of drift.slice(0, 10)) {
          console.error(`  ${d.reason.padEnd(8)} ${d.path}`)
        }
        if (drift.length > 10) {
          console.error(`  ... and ${drift.length - 10} more`)
        }
      } else {
        console.log(`[generate-tier2-sdks] ${t.name}: in sync`)
      }
    }
  } finally {
    await rm(scratchRoot, { recursive: true, force: true })
  }

  if (totalDrift > 0) {
    console.error(
      '\n[generate-tier2-sdks] To fix: run `bunx tsx scripts/generate-tier2-sdks.ts` and commit the result.',
    )
    process.exit(1)
  }
  console.log('[generate-tier2-sdks] all targets in sync')
}

const opts = parseArgs(process.argv.slice(2))
generateAll(opts).catch((err) => {
  console.error(`[generate-tier2-sdks] ${err instanceof Error ? err.message : String(err)}`)
  process.exit(1)
})
