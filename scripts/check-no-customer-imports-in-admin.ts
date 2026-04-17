#!/usr/bin/env bunx tsx
// ADR-0026 Sprint 4.1 — cross-import guard: admin/ must not reference app/.
//
// Walks admin/src/ recursively. For each import, resolves the target
// path against the importing file and flags any import that lands
// inside the app/ workspace.
//
// Proper path resolution is used (not regex) so that admin's own
// Next.js route groups like app/(operator)/ do not false-positive.
//
// Shared packages (@consentshield/compliance, @consentshield/encryption,
// @consentshield/shared-types) are allowed — they are consumed by both
// apps by design.
//
// Exit codes:
//   0 — no cross-imports found
//   1 — at least one cross-import found
//   2 — usage / IO error

import { readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, resolve, relative } from 'node:path'

const REPO_ROOT = resolve(__dirname, '..')
const ADMIN_SRC = resolve(REPO_ROOT, 'admin/src')
const FORBIDDEN_DIR = resolve(REPO_ROOT, 'app') + '/'

const IMPORT_RE = /(?:from\s+|import\s*\(\s*)['"]([^'"]+)['"]/g

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
    if (resolved.startsWith(FORBIDDEN_DIR)) return { reason: 'relative import resolves into app/' }
  }
  return null
}

function main(): void {
  const files: string[] = []
  try {
    walk(ADMIN_SRC, files)
  } catch (err) {
    console.error(`Could not scan ${ADMIN_SRC}:`, err)
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
    console.log(`OK — ${files.length} files scanned under admin/src; no customer imports.`)
    process.exit(0)
  }

  console.error(`FAIL — ${offences.length} customer import(s) found in admin/src:\n`)
  for (const o of offences) {
    console.error(`  ${o.file}:${o.line}  [${o.reason}]`)
    console.error(`    ${o.match}`)
  }
  console.error(
    `\nThe admin app (admin/src) must not depend on customer-app code.\n` +
      `Shared logic belongs in packages/{compliance,encryption,shared-types}.`,
  )
  process.exit(1)
}

main()
