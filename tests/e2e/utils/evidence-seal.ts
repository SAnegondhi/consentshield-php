import { createHash } from 'node:crypto'
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

// Seal format (written by evidence.ts finalize()):
//
//   # ConsentShield E2E evidence seal — schema 1.0
//   # run_id=... commit=... finalized=...
//   #
//   algorithm: sha256
//   seal: <hex>
//
//   # Ledger (one line per archive file, sorted):
//   <sha256>  <relpath>
//   <sha256>  <relpath>
//   ...
//
// The seal is sha256(ledger). Recomputing the ledger from the run directory
// and comparing to the stored seal is how a partner verifies no file was
// tampered with.

export interface SealVerification {
  ok: boolean
  runDir: string
  expected: string
  actual: string
  ledgerLines: number
  mismatches: Array<{ path: string; stored?: string; actual?: string }>
}

export function verifySeal(runDir: string): SealVerification {
  const sealPath = join(runDir, 'seal.txt')
  if (!existsSync(sealPath)) {
    throw new Error(`seal.txt missing at ${sealPath}`)
  }
  const sealFile = readFileSync(sealPath, 'utf8')

  const stored = parseSeal(sealFile)
  const live = computeLedger(runDir)

  // Compare line-by-line so a mismatch tells us *which* file changed.
  const mismatches: SealVerification['mismatches'] = []
  const storedMap = new Map(stored.entries)
  const liveMap = new Map(live.entries)
  for (const [path, storedHash] of storedMap) {
    const actualHash = liveMap.get(path)
    if (!actualHash) {
      mismatches.push({ path, stored: storedHash, actual: undefined })
    } else if (actualHash !== storedHash) {
      mismatches.push({ path, stored: storedHash, actual: actualHash })
    }
  }
  for (const [path, actualHash] of liveMap) {
    if (!storedMap.has(path)) {
      mismatches.push({ path, stored: undefined, actual: actualHash })
    }
  }

  return {
    ok: stored.seal === live.seal && mismatches.length === 0,
    runDir,
    expected: stored.seal,
    actual: live.seal,
    ledgerLines: stored.entries.length,
    mismatches
  }
}

interface ParsedSeal {
  algorithm: string
  seal: string
  entries: Array<[string, string]>
}

function parseSeal(contents: string): ParsedSeal {
  const lines = contents.split(/\r?\n/)
  let algorithm = ''
  let seal = ''
  const entries: Array<[string, string]> = []
  let inLedger = false
  for (const raw of lines) {
    if (raw.startsWith('algorithm:')) {
      algorithm = raw.slice('algorithm:'.length).trim()
    } else if (raw.startsWith('seal:')) {
      seal = raw.slice('seal:'.length).trim()
    } else if (raw.startsWith('# Ledger')) {
      inLedger = true
    } else if (inLedger && raw.trim() !== '' && !raw.startsWith('#')) {
      const m = raw.match(/^([a-f0-9]+)\s\s(.+)$/)
      if (m) entries.push([m[2], m[1]])
    }
  }
  if (!algorithm || !seal) {
    throw new Error('seal.txt missing algorithm: or seal: line')
  }
  if (algorithm !== 'sha256') {
    throw new Error(`unsupported seal algorithm: ${algorithm}`)
  }
  return { algorithm, seal, entries }
}

interface ComputedLedger {
  seal: string
  entries: Array<[string, string]>
}

function computeLedger(runDir: string): ComputedLedger {
  const ledgerLines: string[] = []
  const entries: Array<[string, string]> = []
  walk(runDir).forEach((abs) => {
    const rel = relative(runDir, abs).replace(/\\/g, '/')
    if (rel === 'seal.txt') return
    const hash = sha256(readFileSync(abs))
    entries.push([rel, hash])
    ledgerLines.push(`${hash}  ${rel}`)
  })
  ledgerLines.sort()
  entries.sort((a, b) => a[0].localeCompare(b[0]))
  const ledger = ledgerLines.join('\n') + '\n'
  return { seal: sha256(Buffer.from(ledger, 'utf8')), entries }
}

function walk(dir: string): string[] {
  const out: string[] = []
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    const st = statSync(p)
    if (st.isDirectory()) out.push(...walk(p))
    else out.push(p)
  }
  return out
}

function sha256(body: Buffer): string {
  return createHash('sha256').update(body).digest('hex')
}
