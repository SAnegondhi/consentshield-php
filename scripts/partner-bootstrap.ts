/**
 * ADR-1014 Sprint 5.1 — Partner bootstrap script.
 *
 * Interactive CLI that walks a third-party reviewer (audit firm, BFSI
 * prospect, enterprise evaluator) through provisioning a reproducible copy
 * of the ConsentShield E2E harness against THEIR OWN Supabase project.
 *
 * Wraps `scripts/e2e-bootstrap.ts` — the partner-facing flow is a thin
 * interactive prompter around the same fixture seeder used by our own CI.
 * Partner enters their credentials; we spawn the existing bootstrap with
 * env overrides, then rename `.env.e2e` → `.env.partner` so the harness
 * picks it up under `PLAYWRIGHT_PARTNER=1`.
 *
 * 30-minute wall-clock target from first invocation to `test:e2e:partner`
 * producing its first evidence archive. Typical budget:
 *   - Prompts                               ~2 min
 *   - Supabase migrations (assumes done)     0 min
 *   - Bootstrap (3 verticals × 11 rows)    ~10 s
 *   - `bun install`                         ~1 min
 *   - `install:browsers`                    ~3 min
 *   - First `test:e2e:partner` chromium     ~5 min
 *   - Evidence verify                       ~5 s
 * Total:                                    ~12 min; cushion to 30.
 *
 * Usage:
 *   bunx tsx scripts/partner-bootstrap.ts           # interactive
 *   bunx tsx scripts/partner-bootstrap.ts --force   # skip "file exists" prompt
 *   bunx tsx scripts/partner-bootstrap.ts --help
 *
 * Idempotent: re-running against the same Supabase project reuses fixtures
 * unless `--force` is passed (same semantic as the underlying bootstrap).
 *
 * Never prints the service-role key back. Never writes it outside
 * `.env.partner` (mode 0600, gitignored).
 */

import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import * as readline from 'node:readline'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = resolve(HERE, '..')
const ENV_E2E = resolve(REPO_ROOT, '.env.e2e')
const ENV_PARTNER = resolve(REPO_ROOT, '.env.partner')

const argv = process.argv.slice(2)
if (argv.includes('--help') || argv.includes('-h')) {
  printHelp()
  process.exit(0)
}
const FORCE = argv.includes('--force')

// ─── Prompts ─────────────────────────────────────────────────────────────

function promptVisible(question: string): Promise<string> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: true
  })
  return new Promise((resolveAnswer) => {
    rl.question(question, (answer) => {
      rl.close()
      resolveAnswer(answer.trim())
    })
  })
}

function promptSecret(question: string): Promise<string> {
  process.stdout.write(question)
  return new Promise((resolveAnswer) => {
    const stdin = process.stdin
    let captured = ''

    const onData = (chunk: Buffer): void => {
      const str = chunk.toString('utf8')
      for (const char of str) {
        if (char === '\n' || char === '\r' || char === '') {
          stdin.removeListener('data', onData)
          if (stdin.isTTY) stdin.setRawMode(false)
          stdin.pause()
          process.stdout.write('\n')
          resolveAnswer(captured.trim())
          return
        }
        if (char === '') {
          // Ctrl-C
          if (stdin.isTTY) stdin.setRawMode(false)
          process.stdout.write('\n')
          process.exit(130)
        }
        if (char === '' || char === '\b') {
          // Backspace
          if (captured.length > 0) {
            captured = captured.slice(0, -1)
            process.stdout.write('\b \b')
          }
          continue
        }
        captured += char
        process.stdout.write('*')
      }
    }

    if (stdin.isTTY) stdin.setRawMode(true)
    stdin.resume()
    stdin.on('data', onData)
  })
}

async function promptYesNo(question: string, defaultYes: boolean): Promise<boolean> {
  const hint = defaultYes ? '[Y/n]' : '[y/N]'
  const answer = (await promptVisible(`${question} ${hint} `)).toLowerCase()
  if (answer === '') return defaultYes
  return answer.startsWith('y')
}

// ─── Validation ──────────────────────────────────────────────────────────

function looksLikeSupabaseUrl(url: string): boolean {
  try {
    const parsed = new URL(url)
    return (
      parsed.protocol === 'https:' &&
      (parsed.hostname.endsWith('.supabase.co') ||
        parsed.hostname.endsWith('.supabase.in') ||
        parsed.hostname.endsWith('.supabase.net'))
    )
  } catch {
    return false
  }
}

function looksLikeSupabaseKey(key: string): boolean {
  // Supabase service-role + anon keys are JWTs today (eyJ... three dot-separated
  // base64url sections) and will be sb_secret_ / sb_publishable_ tokens post-rotation.
  return (
    /^eyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(key) ||
    /^sb_(secret|publishable)_[A-Za-z0-9_]+$/.test(key)
  )
}

// ─── Main ────────────────────────────────────────────────────────────────

interface PartnerInput {
  supabaseUrl: string
  serviceRoleKey: string
  anonKey: string
  cloudflareAccountId: string | null
}

async function gatherInputs(): Promise<PartnerInput> {
  console.log()
  console.log('Partner input — 4 values (all from YOUR accounts, never shared with ConsentShield):')
  console.log('  1. Supabase project URL     e.g. https://abcdef.supabase.co')
  console.log('  2. Service-role key         (secret — hidden input)')
  console.log('  3. Anon key                 (visible input)')
  console.log('  4. Cloudflare account ID    (optional — needed only for Worker-path tests)')
  console.log()

  let supabaseUrl = ''
  while (!looksLikeSupabaseUrl(supabaseUrl)) {
    supabaseUrl = await promptVisible('Supabase project URL: ')
    if (!looksLikeSupabaseUrl(supabaseUrl)) {
      console.log('  ↳ Does not look like a Supabase URL (expected https://<project>.supabase.co). Try again.')
    }
  }

  let serviceRoleKey = ''
  while (!looksLikeSupabaseKey(serviceRoleKey)) {
    serviceRoleKey = await promptSecret('Service-role key (hidden): ')
    if (!looksLikeSupabaseKey(serviceRoleKey)) {
      console.log('  ↳ Does not look like a Supabase key (expected JWT or sb_secret_*). Try again.')
    }
  }

  let anonKey = ''
  while (!looksLikeSupabaseKey(anonKey)) {
    anonKey = await promptVisible('Anon key: ')
    if (!looksLikeSupabaseKey(anonKey)) {
      console.log('  ↳ Does not look like a Supabase key. Try again.')
    }
  }

  const rawCf = await promptVisible('Cloudflare account ID (press Enter to skip): ')
  const cloudflareAccountId = rawCf.length > 0 ? rawCf : null

  return { supabaseUrl, serviceRoleKey, anonKey, cloudflareAccountId }
}

function runUnderlyingBootstrap(input: PartnerInput, force: boolean): void {
  const args = ['tsx', resolve(REPO_ROOT, 'scripts/e2e-bootstrap.ts')]
  if (force) args.push('--force')

  console.log()
  console.log(`Invoking scripts/e2e-bootstrap.ts${force ? ' --force' : ''} against ${input.supabaseUrl}…`)
  console.log()

  const result = spawnSync('bunx', args, {
    cwd: REPO_ROOT,
    stdio: 'inherit',
    env: {
      ...process.env,
      NEXT_PUBLIC_SUPABASE_URL: input.supabaseUrl,
      NEXT_PUBLIC_SUPABASE_ANON_KEY: input.anonKey,
      SUPABASE_SERVICE_ROLE_KEY: input.serviceRoleKey
    }
  })

  if (result.status !== 0) {
    console.error()
    console.error('❌ Underlying bootstrap failed. See the output above for the specific error.')
    console.error('   Common causes:')
    console.error('   - Supabase project has not been migrated: run `bunx supabase db push` against your project first.')
    console.error('   - Service-role key is revoked or does not match the URL.')
    console.error('   - Network reachability to the Supabase host.')
    process.exit(result.status ?? 1)
  }
}

function finalizeEnvPartner(input: PartnerInput): void {
  if (!existsSync(ENV_E2E)) {
    console.error(`❌ Expected ${ENV_E2E} to exist after bootstrap. Not renaming.`)
    process.exit(1)
  }

  const original = readFileSync(ENV_E2E, 'utf8')
  const body = original.replace(/^# \.env\.e2e — seeded by scripts\/e2e-bootstrap\.ts\n/, '')
  const header: string[] = [
    '# .env.partner — seeded by scripts/partner-bootstrap.ts (ADR-1014 Sprint 5.1)',
    `# Generated: ${new Date().toISOString()}`,
    `# Supabase project: ${input.supabaseUrl}`,
    '# DO NOT COMMIT. Gitignored. Mode 0600.',
    '# Consumed by `bun run test:e2e:partner` (PLAYWRIGHT_PARTNER=1).',
    ''
  ]
  let merged = header.join('\n') + body
  if (input.cloudflareAccountId) {
    merged += `\n# ─── Cloudflare (for Worker-path tests) ───\n`
    merged += `CLOUDFLARE_ACCOUNT_ID=${input.cloudflareAccountId}\n`
  }

  writeFileSync(ENV_PARTNER, merged, { mode: 0o600 })
  try {
    unlinkSync(ENV_E2E)
  } catch {
    // Non-fatal; partner can delete the intermediate file manually.
  }

  console.log(`✓ Wrote ${ENV_PARTNER} (mode 0600). Removed intermediate .env.e2e.`)
}

function printNextSteps(input: PartnerInput): void {
  console.log()
  console.log('Next steps (in order):')
  console.log()
  console.log('  1. Install deps + browsers:')
  console.log('       bun install')
  console.log('       cd tests/e2e && bun run install:browsers && cd ../..')
  console.log()
  console.log('  2. Run the partner suite (reads .env.partner):')
  console.log('       bun run test:e2e:partner')
  console.log()
  console.log('  3. Verify the sealed evidence archive:')
  console.log('       bunx tsx scripts/e2e-verify-evidence.ts tests/e2e/evidence/<commit>/<runId>')
  console.log()
  if (input.cloudflareAccountId) {
    console.log('  Worker-path tests (optional):')
    console.log(`       Your Cloudflare account ID is recorded as CLOUDFLARE_ACCOUNT_ID.`)
    console.log('       Follow tests/e2e/README.md "Running pipeline tests against the Worker".')
    console.log('       Pipeline tests skip cleanly if WORKER_URL is not set.')
    console.log()
  }
  console.log('  If anything looks off, compare against the reference run published at:')
  console.log('       https://testing.consentshield.in  (Sprint 5.3 — upcoming)')
  console.log()
  console.log('  To start fresh at any time:')
  console.log('       bunx tsx scripts/partner-bootstrap.ts --force')
  console.log()
}

async function main(): Promise<void> {
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
  console.log('  ConsentShield — partner reproduction bootstrap (ADR-1014 Sprint 5.1)')
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
  console.log()
  console.log('This script seeds three vertical-specific test fixtures (ecommerce, healthcare,')
  console.log('BFSI) into YOUR Supabase test project so you can run the E2E suite against')
  console.log('state you control. ConsentShield never receives your credentials — they stay on')
  console.log('this machine, in a gitignored mode-0600 .env.partner file.')
  console.log()
  console.log('Prerequisites:')
  console.log('  - A Supabase project you can wipe (NOT a production project).')
  console.log('  - Schema migrations applied: `bunx supabase db push` against that project.')
  console.log('  - Bun installed (https://bun.sh).')
  console.log()

  if (existsSync(ENV_PARTNER) && !FORCE) {
    console.log(`⚠️  ${ENV_PARTNER} already exists.`)
    const rebuild = await promptYesNo('Rebuild from scratch (--force)? This wipes fixtures in your Supabase project.', false)
    if (!rebuild) {
      console.log('Aborted. Existing .env.partner preserved.')
      process.exit(0)
    }
  }

  const effectiveForce = FORCE || existsSync(ENV_PARTNER)

  const input = await gatherInputs()

  console.log()
  const confirmed = await promptYesNo(
    `Confirm: bootstrap against ${input.supabaseUrl}${effectiveForce ? ' (will wipe existing fixtures)' : ''}?`,
    true
  )
  if (!confirmed) {
    console.log('Aborted.')
    process.exit(0)
  }

  runUnderlyingBootstrap(input, effectiveForce)
  finalizeEnvPartner(input)
  printNextSteps(input)
}

function printHelp(): void {
  console.log(
    [
      'partner-bootstrap.ts — ADR-1014 Sprint 5.1',
      '',
      'Interactive bootstrap for a third-party reviewer to reproduce the E2E suite',
      'against their own Supabase project. Wraps scripts/e2e-bootstrap.ts.',
      '',
      'Usage:',
      '  bunx tsx scripts/partner-bootstrap.ts           # interactive',
      '  bunx tsx scripts/partner-bootstrap.ts --force   # skip "file exists" prompt',
      '  bunx tsx scripts/partner-bootstrap.ts --help',
      '',
      'Outputs:',
      '  .env.partner  — mode 0600, gitignored. Consumed by `bun run test:e2e:partner`.',
      '',
      'Prerequisites on the partner machine:',
      '  - Partner-owned Supabase project (not production).',
      '  - Schema migrations applied: `bunx supabase db push`.',
      '  - Bun installed (https://bun.sh).'
    ].join('\n')
  )
}

main().catch((err) => {
  console.error('\npartner-bootstrap failed:', err)
  process.exit(1)
})
