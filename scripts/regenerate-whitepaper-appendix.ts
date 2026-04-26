/**
 * ADR-1006 Phase 3 Sprint 3.1 — regenerate Appendix A of the v2 whitepaper
 * from the OpenAPI spec.
 *
 * Source of truth: app/public/openapi.yaml.
 * Target: docs/design/ConsentShield-Customer-Integration-Whitepaper-v2.md,
 * the table titled "Compliance API (API key authentication — Pro and
 * Enterprise tiers)" inside `## Appendix A — Complete API Surface Summary`.
 *
 * Run:
 *   bunx tsx scripts/regenerate-whitepaper-appendix.ts            # writes
 *   bunx tsx scripts/regenerate-whitepaper-appendix.ts --check    # exits 1 on drift
 *
 * The hand-rolled YAML parser is deliberately scoped to the OpenAPI shape
 * we know — paths are 2-space-indented top-level keys under `paths:`,
 * methods are 4-space-indented, `security` and `tags` are 6-space-
 * indented lists. Adding a full YAML dep for one read isn't worth it.
 */

import { readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const here = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = path.resolve(here, '..')
const OPENAPI_SRC = path.join(REPO_ROOT, 'app', 'public', 'openapi.yaml')
const WHITEPAPER = path.join(
  REPO_ROOT,
  'docs',
  'design',
  'ConsentShield-Customer-Integration-Whitepaper-v2.md',
)

const MARKER_BEGIN = '<!-- BEGIN AUTO-GENERATED APPENDIX-A-COMPLIANCE-API -->'
const MARKER_END = '<!-- END AUTO-GENERATED APPENDIX-A-COMPLIANCE-API -->'

interface Operation {
  path: string // openapi-relative, e.g. "/consent/verify"
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
  summary: string
  tag: string
  scopes: string[] // [] when only bare bearerAuth is required
}

const HTTP_METHODS = ['get', 'post', 'put', 'patch', 'delete'] as const

function parseOperations(yaml: string): Operation[] {
  const lines = yaml.split('\n')
  const ops: Operation[] = []

  // Locate `paths:` line; everything else is processed relative to it.
  const pathsLineIdx = lines.findIndex((l) => l.trimEnd() === 'paths:')
  if (pathsLineIdx === -1) throw new Error('regenerate-appendix: paths: not found')

  let currentPath: string | null = null
  let currentMethod: Operation['method'] | null = null
  let currentSummary = ''
  let currentTag = ''
  let currentScopes: string[] = []
  let inSecurity = false

  const flush = (): void => {
    if (currentPath && currentMethod) {
      ops.push({
        path: currentPath,
        method: currentMethod,
        summary: currentSummary,
        tag: currentTag,
        scopes: currentScopes,
      })
    }
    currentMethod = null
    currentSummary = ''
    currentTag = ''
    currentScopes = []
    inSecurity = false
  }

  for (let i = pathsLineIdx + 1; i < lines.length; i++) {
    const line = lines[i]
    if (line === undefined) break

    // Top-level non-paths section reached → done.
    if (/^[a-z]/.test(line)) break

    // 2-space-indented `  /...:` → new path.
    const pathMatch = line.match(/^ {2}(\/[^:]+):\s*$/)
    if (pathMatch) {
      flush()
      currentPath = pathMatch[1]!
      currentMethod = null
      continue
    }

    // 4-space-indented `    get:` etc. → new operation under current path.
    const methodMatch = line.match(/^ {4}(get|post|put|patch|delete):\s*$/)
    if (methodMatch && currentPath) {
      flush()
      currentMethod = methodMatch[1]!.toUpperCase() as Operation['method']
      continue
    }

    if (!currentMethod) continue

    // 6-space-indented operation fields.
    const summaryMatch = line.match(/^ {6}summary:\s*(.+?)\s*$/)
    if (summaryMatch) {
      currentSummary = stripQuotes(summaryMatch[1]!)
      continue
    }

    const tagsInlineMatch = line.match(/^ {6}tags:\s*\[\s*([^\]]+?)\s*\]/)
    if (tagsInlineMatch) {
      const first = tagsInlineMatch[1]!.split(',')[0]!.trim()
      currentTag = stripQuotes(first)
      continue
    }

    if (line.match(/^ {6}security:\s*$/)) {
      inSecurity = true
      continue
    }

    if (inSecurity) {
      const scopeMatch = line.match(/^ {8}- bearerAuth:\s*\[\s*([^\]]*)\s*\]/)
      if (scopeMatch) {
        currentScopes = scopeMatch[1]!
          .split(',')
          .map((s) => stripQuotes(s.trim()))
          .filter(Boolean)
        inSecurity = false
        continue
      }
      // The security block ended without a bearerAuth line.
      if (line.match(/^ {0,6}\S/)) inSecurity = false
    }
  }

  flush()
  return ops
}

function stripQuotes(s: string): string {
  return s.replace(/^['"]|['"]$/g, '')
}

const TAG_ORDER = [
  'Utility',
  'Consent',
  'Deletion',
  'Rights',
  'Audit',
  'Account',
  'Property',
  'Score',
  'Security',
  'Connectors',
] as const

function tagRank(tag: string): number {
  const idx = (TAG_ORDER as readonly string[]).indexOf(tag)
  return idx === -1 ? TAG_ORDER.length : idx
}

function renderTable(ops: Operation[]): string {
  const sorted = [...ops].sort((a, b) => {
    const tagDiff = tagRank(a.tag) - tagRank(b.tag)
    if (tagDiff !== 0) return tagDiff
    if (a.path !== b.path) return a.path.localeCompare(b.path)
    return a.method.localeCompare(b.method)
  })

  const lines: string[] = []
  lines.push('| Route | Method | Tag | Scope |')
  lines.push('|---|---|---|---|')
  for (const op of sorted) {
    const route = `\`/v1${op.path}\``
    const scope = op.scopes.length === 0 ? '_(any valid key)_' : op.scopes.map((s) => `\`${s}\``).join(', ')
    lines.push(`| ${route} | ${op.method} | ${op.tag} | ${scope} |`)
  }
  return lines.join('\n')
}

function generateBlock(ops: Operation[]): string {
  const ts = new Date().toISOString().slice(0, 10)
  return [
    MARKER_BEGIN,
    `<!-- Generated ${ts} by scripts/regenerate-whitepaper-appendix.ts from app/public/openapi.yaml -->`,
    '<!-- Do not hand-edit this section; the next regeneration will overwrite it. -->',
    '',
    renderTable(ops),
    '',
    MARKER_END,
  ].join('\n')
}

function spliceIntoWhitepaper(whitepaper: string, generated: string): string {
  const beginIdx = whitepaper.indexOf(MARKER_BEGIN)
  const endIdx = whitepaper.indexOf(MARKER_END)

  if (beginIdx === -1 || endIdx === -1) {
    // First run: locate the existing "Compliance API" subsection inside
    // Appendix A and replace its table with our generated block.
    const headingMatch = whitepaper.match(
      /\n### Compliance API \(API key authentication[^\n]*\)\n[\s\S]*?\n(?=\n### |\n## |\n---|$)/,
    )
    if (!headingMatch) {
      throw new Error(
        'regenerate-appendix: could not locate "Compliance API" heading inside Appendix A on first run',
      )
    }
    const before = whitepaper.slice(0, headingMatch.index!)
    const after = whitepaper.slice(headingMatch.index! + headingMatch[0]!.length)
    const replacement =
      '\n### Compliance API (API key authentication — Pro and Enterprise tiers)\n\n' +
      '`Authorization: Bearer cs_live_xxxxxxxxxxxxxxxxxxxxxxxx`\n\n' +
      generated +
      '\n\n' +
      '**Rate limits:** Starter 100/hr · Growth 1,000/hr · Pro 10,000/hr · Enterprise custom\n'
    return before + replacement + after
  }

  // Subsequent runs: just splice between markers.
  return whitepaper.slice(0, beginIdx) + generated + whitepaper.slice(endIdx + MARKER_END.length)
}

async function main() {
  const checkOnly = process.argv.includes('--check')

  const openapi = await readFile(OPENAPI_SRC, 'utf8')
  const ops = parseOperations(openapi)
  if (ops.length === 0) {
    console.error('regenerate-appendix: parsed 0 operations from openapi.yaml — parser likely broken')
    process.exit(1)
  }

  const whitepaper = await readFile(WHITEPAPER, 'utf8')
  const generated = generateBlock(ops)
  const next = spliceIntoWhitepaper(whitepaper, generated)

  if (next === whitepaper) {
    console.log(`regenerate-appendix: no change (${ops.length} operations).`)
    return
  }

  if (checkOnly) {
    console.error(
      `regenerate-appendix: drift detected — Appendix A is out of sync with openapi.yaml.\n` +
        `  Run \`bunx tsx scripts/regenerate-whitepaper-appendix.ts\` and commit the result.`,
    )
    process.exit(1)
  }

  await writeFile(WHITEPAPER, next, 'utf8')
  console.log(`regenerate-appendix: wrote ${ops.length} operations to ${path.relative(REPO_ROOT, WHITEPAPER)}.`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
