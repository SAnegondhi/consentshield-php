#!/usr/bin/env bunx tsx
// ADR-0026 Sprint 4.1 — cross-import guard: app/ must not reference admin/.
//
// Walks app/src/ recursively. For each import, resolves the target path
// against the importing file and flags any import that lands inside the
// admin/ workspace, or that names an admin-only scoped package
// (@consentshield/admin-*).
//
// Shared packages (@consentshield/compliance, @consentshield/encryption,
// @consentshield/shared-types) are allowed — they are consumed by both
// apps by design. Path segments like app/(operator)/ inside the admin
// Next.js route groups are correctly ignored because resolution is done
// relative to the importing file's directory, not by regex alone.
//
// Exit codes:
//   0 — no cross-imports found
//   1 — at least one cross-import found
//   2 — usage / IO error

import { readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, resolve, relative } from 'node:path'

const REPO_ROOT = resolve(__dirname, '..')
const APP_SRC = resolve(REPO_ROOT, 'app/src')
const FORBIDDEN_DIR = resolve(REPO_ROOT, 'admin') + '/'

const IMPORT_RE = /(?:from\s+|import\s*\(\s*)['"]([^'"]+)['"]/g
const ADMIN_PACKAGE_RE = /^@consentshield\/admin[\w-]*/

interface Offence {
  file: string
  line: number
  match: string
  reason: string
}

function walk(dir: string, out: string[]): void {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    const st = statSync(full)
    if (st.isDirectory()) {
      if (entry === 'node_modules' || entry === '.next' || entry.startsWith('.')) continue
      walk(full, out)
    } else if (/\.(ts|tsx|js|jsx|mjs|cjs)$/.test(entry)) {
      out.push(full)
    }
  }
}

function classify(spec: string, fileDir: string): { reason: string } | null {
  if (spec.startsWith('./') || spec.startsWith('../')) {
    const resolved = resolve(fileDir, spec) + '/'
    if (resolved.startsWith(FORBIDDEN_DIR)) return { reason: 'relative import resolves into admin/' }
    return null
  }
  if (ADMIN_PACKAGE_RE.test(spec)) return { reason: 'admin-only scoped package' }
  return null
}

function main(): void {
  const files: string[] = []
  try {
    walk(APP_SRC, files)
  } catch (err) {
    console.error(`Could not scan ${APP_SRC}:`, err)
    process.exit(2)
  }

  const offences: Offence[] = []

  for (const file of files) {
    const fileDir = dirname(file)
    const content = readFileSync(file, 'utf8')
    const lines = content.split('\n')
    lines.forEach((line, idx) => {
      IMPORT_RE.lastIndex = 0
      let m: RegExpExecArray | null
      while ((m = IMPORT_RE.exec(line)) !== null) {
        const verdict = classify(m[1], fileDir)
        if (verdict) {
          offences.push({
            file: relative(REPO_ROOT, file),
            line: idx + 1,
            match: line.trim(),
            reason: verdict.reason,
          })
        }
      }
    })
  }

  if (offences.length === 0) {
    console.log(`OK — ${files.length} files scanned under app/src; no admin imports.`)
    process.exit(0)
  }

  console.error(`FAIL — ${offences.length} admin import(s) found in app/src:\n`)
  for (const o of offences) {
    console.error(`  ${o.file}:${o.line}  [${o.reason}]`)
    console.error(`    ${o.match}`)
  }
  console.error(
    `\nThe customer app (app/src) must not depend on admin code.\n` +
      `Admin-only logic lives in admin/src/ or in a dedicated @consentshield/admin-* package.`,
  )
  process.exit(1)
}

main()
