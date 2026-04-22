/**
 * ADR-1014 Sprint 1.4 — Partner-facing evidence-seal verifier.
 *
 * Usage:
 *   bunx tsx scripts/e2e-verify-evidence.ts <path-to-run-dir>
 *
 * Recomputes the SHA-256 ledger over every file in the archive (except
 * seal.txt) and compares against the stored seal. Exits:
 *   0 — seal verifies; archive is intact.
 *   1 — verification failed; detailed mismatches printed.
 *   2 — usage or I/O error (archive not found, malformed seal).
 *
 * This is the tool a prospective partner runs after downloading the run
 * archive from `testing.consentshield.in/runs/<sha>/<runId>/` (Sprint 5.3).
 */

import { existsSync, readFileSync, statSync } from 'node:fs'
import { resolve } from 'node:path'
import { verifySeal } from '../tests/e2e/utils/evidence-seal.js'

function main(): number {
  const arg = process.argv[2]
  if (!arg) {
    console.error('usage: bunx tsx scripts/e2e-verify-evidence.ts <run-dir>')
    return 2
  }
  const runDir = resolve(arg)
  if (!existsSync(runDir) || !statSync(runDir).isDirectory()) {
    console.error(`error: not a directory: ${runDir}`)
    return 2
  }

  console.log(`verifying evidence archive: ${runDir}`)
  let verification
  try {
    verification = verifySeal(runDir)
  } catch (err) {
    console.error(`error: ${err instanceof Error ? err.message : String(err)}`)
    return 2
  }

  console.log('')
  console.log(`expected seal: ${verification.expected}`)
  console.log(`actual seal:   ${verification.actual}`)
  console.log(`ledger lines:  ${verification.ledgerLines}`)

  if (verification.ok) {
    console.log('')
    console.log('✓ SEAL VERIFIED — archive is intact. No files added, removed, or modified.')

    const manifestPath = resolve(runDir, 'manifest.json')
    if (existsSync(manifestPath)) {
      const m = JSON.parse(readFileSync(manifestPath, 'utf8'))
      console.log('')
      console.log(`  run_id    : ${m.run_id}`)
      console.log(`  commit    : ${m.commit_sha} (${m.branch ?? 'detached'})`)
      console.log(`  started   : ${m.started_at}`)
      console.log(`  duration  : ${m.duration_ms} ms`)
      console.log(`  projects  : ${(m.playwright_projects ?? []).join(', ')}`)
      const s = m.summary ?? {}
      console.log(
        `  tests     : ${s.total ?? 0} total, ${s.passed ?? 0} passed, ` +
          `${s.failed ?? 0} failed, ${s.skipped ?? 0} skipped, ${s.flaky ?? 0} flaky`
      )
    }
    return 0
  }

  console.log('')
  console.log('✗ SEAL FAILED — archive has been tampered with.')
  console.log('')
  if (verification.mismatches.length === 0) {
    console.log('  (root-hash mismatch with no line-level differences — likely a ledger-format change)')
  } else {
    console.log('  Mismatches:')
    for (const m of verification.mismatches.slice(0, 20)) {
      if (m.stored && m.actual) {
        console.log(`    MODIFIED  ${m.path}`)
        console.log(`      stored : ${m.stored}`)
        console.log(`      actual : ${m.actual}`)
      } else if (m.stored && !m.actual) {
        console.log(`    REMOVED   ${m.path}`)
      } else if (!m.stored && m.actual) {
        console.log(`    ADDED     ${m.path}`)
      }
    }
    if (verification.mismatches.length > 20) {
      console.log(`    ... ${verification.mismatches.length - 20} more`)
    }
  }
  return 1
}

process.exit(main())
