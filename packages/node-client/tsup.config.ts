// ADR-1006 Phase 1 Sprint 1.4 — dual ESM+CJS build for npm publication.
//
// Why tsup: zero-config dual emission, .d.ts emission via the rollup-dts
// integration, sourcemaps, treeshake. Produces:
//   dist/index.mjs    + dist/index.d.mts   (import path)
//   dist/index.cjs    + dist/index.d.cts   (require path)
//   dist/index.d.ts                         (default types alias for older
//                                             tooling that ignores the
//                                             conditional exports map)
//
// The package consumes only Node 18+ globals (fetch, AbortController,
// crypto). No bundled deps.

import { defineConfig } from 'tsup'

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm', 'cjs'],
  dts: true,
  sourcemap: true,
  clean: true,
  treeshake: true,
  minify: false,
  splitting: false,
  target: 'node18',
  outExtension: ({ format }) => ({ js: format === 'esm' ? '.mjs' : '.cjs' }),
})
