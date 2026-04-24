/**
 * ADR-1015 Phase 1 Sprint 1.2 — copy openapi.yaml into marketing/public.
 *
 * The single source of truth for the v1 API spec lives at
 * app/public/openapi.yaml (published by app/ at runtime). The Scalar
 * playground on the marketing site needs the same YAML at its own
 * public URL so the renderer can fetch it on the client.
 *
 * Runs at `prebuild` time and writes:
 *   marketing/public/openapi.yaml
 *
 * If the source is missing, exits with a non-zero code so the build
 * fails loudly rather than silently shipping an empty playground.
 */

import { mkdir, readFile, writeFile, stat } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const here = path.dirname(fileURLToPath(import.meta.url))
const SRC = path.resolve(here, '..', '..', 'app', 'public', 'openapi.yaml')
const DEST_DIR = path.resolve(here, '..', 'public')
const DEST = path.join(DEST_DIR, 'openapi.yaml')

async function main() {
  try {
    const info = await stat(SRC)
    if (!info.isFile()) {
      console.error(`copy-openapi: expected file at ${SRC}`)
      process.exit(1)
    }
  } catch (err) {
    console.error(`copy-openapi: source missing at ${SRC}`)
    console.error(err)
    process.exit(1)
  }

  await mkdir(DEST_DIR, { recursive: true })
  const contents = await readFile(SRC)
  await writeFile(DEST, contents)
  console.log(
    `copy-openapi: copied ${contents.byteLength} bytes from ${path.relative(process.cwd(), SRC)} → ${path.relative(process.cwd(), DEST)}`,
  )
}

void main()
